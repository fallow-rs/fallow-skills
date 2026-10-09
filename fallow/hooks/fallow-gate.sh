#!/usr/bin/env bash
set -euo pipefail

# Fallow plugin commit and push gate for Claude Code (PreToolUse, Bash).
#
# This script follows the gate that `fallow agent install` writes to
# .claude/hooks/fallow-gate.sh (crates/cli/src/setup_hooks/fallow-gate.sh in
# fallow-rs/fallow). It runs the same audit command:
#
#   fallow audit --format json --quiet --explain --gate-marker agent
#
# Differences from the installed gate:
# - When `fallow agent install` or `fallow hooks install --target agent`
#   already registered its own gate for this project or user, this script
#   does nothing, so the audit runs once.
# - It runs only in a project that chose fallow (a fallow config file or a
#   `fallow` dependency in package.json). For each git commit or push it
#   audits the nearest such directory above the directory that the write
#   targets (git -C dir, --work-tree, --git-dir, or an earlier cd). It also
#   audits the session directory for a write without a target and for any
#   command it cannot follow, so a parse difference never skips an audit.
# - Codex also loads this hook from the plugin. It defers to a gate that
#   `fallow agent install` registered for Claude Code or for Codex.
# - A missing fallow binary, a missing jq or a fallow binary below the version
#   floor allows the command and prints a clear notice on stderr.
#
# Requires bash and jq. On Windows run via git-bash or WSL.
# Blocks git commit and git push when fallow audit returns verdict fail.
# Runtime errors fail open with a single stderr notice so skips stay visible.
# Set FALLOW_GATE_DEBUG=1 to also log skipped commands.
# Set FALLOW_PLUGIN_GATE=off to turn this plugin gate off.
#
# Version floor (FALLOW_GATE_MIN_VERSION, default 2.85.0). The gate passes
# --gate-marker agent (added in v2.85.0). Older binaries reject the flag, so
# the gate allows the command with a notice. Set the env var to the empty
# string to disable the floor.

if [ "${FALLOW_PLUGIN_GATE:-}" = "off" ]; then
  exit 0
fi

INPUT="$(cat)"

# The plugin is installed for the user, not for one project, so the gate runs
# only in a project that chose fallow: a fallow config file, or `fallow` in the
# dependencies, devDependencies, optionalDependencies or peerDependencies of
# package.json. Each walk starts at a directory that a git write targets, or
# at the `cwd` of the hook input (the session directory). It goes up to the
# nearest directory that matches, and stops at the first .git entry. The audit
# then runs in that directory.
HAVE_JQ=0
command -v jq >/dev/null 2>&1 && HAVE_JQ=1
opted_in() {
  local dir="$1" name
  for name in .fallowrc.json .fallowrc.jsonc fallow.toml .fallow.toml; do
    [ -f "$dir/$name" ] && return 0
  done
  [ -f "$dir/package.json" ] || return 1
  if [ "$HAVE_JQ" -eq 1 ]; then
    jq -e '[.dependencies, .devDependencies, .optionalDependencies, .peerDependencies] | map(select(type == "object" and has("fallow"))) | length > 0' \
      "$dir/package.json" >/dev/null 2>&1
  else
    grep -Eq '"fallow"[[:space:]]*:[[:space:]]*"[~^<>=0-9*.a-z:/-]' "$dir/package.json" 2>/dev/null
  fi
}
START=""
CMD=""
if [ "$HAVE_JQ" -eq 1 ]; then
  START="$(jq -r '.cwd // empty' <<<"$INPUT" 2>/dev/null || true)"
  CMD="$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null || true)"
fi
[ -n "$START" ] && [ -d "$START" ] || START="$PWD"

# Prints the nearest opted-in directory at or above $1. The walk stops at the
# first .git entry. Returns 1 when no directory opts in.
find_root() {
  local dir="$1"
  until opted_in "$dir"; do
    if [ -e "$dir/.git" ] || [ "$dir" = / ]; then
      return 1
    fi
    dir="$(dirname "$dir")"
  done
  printf '%s' "$dir"
}

if [ "$HAVE_JQ" -eq 0 ]; then
  # Without jq the gate cannot parse the command. Print the notice only in an
  # opted-in project and only for input that can be a git commit or push.
  find_root "$START" >/dev/null || exit 0
  case "$INPUT" in
    *git*commit* | *git*push*)
      echo "fallow plugin gate: jq is not on PATH. The commit or push continues without a fallow audit. Install jq to turn the gate on." >&2
      ;;
  esac
  exit 0
fi

# The gate reads the command twice. The loose scan is the original
# word-splitting detector: it counts git commit and git push words and ignores
# quotes. The strict scan tokenizes like the shell and finds the directory of
# each git write. The gate audits only the targets when the strict scan
# understands the whole command. In every other case it also audits the
# session directory, so a parse difference never skips an audit.

# Loose scan. Prints how many git commit or push commands $1 holds when the
# command is split at control operators and at blanks. Git-level options
# between `git` and the subcommand (git -c k=v commit, git -C dir push,
# git --no-pager commit, git --git-dir=/x push) still count, while subcommand
# lookalikes in arguments (git log commit-message.txt) do not. See issue #2106.
count_loose_writes() {
  local cmd="$1" segment count=0
  # Control operators separate simple commands; each becomes its own line.
  while IFS= read -r segment; do
    # Intentional word splitting; globbing is disabled by the caller.
    # shellcheck disable=SC2086
    set -- $segment
    while [ "$#" -gt 0 ]; do
      if [ "$1" != "git" ]; then
        shift
        continue
      fi
      shift
      while [ "$#" -gt 0 ]; do
        case "$1" in
          commit | push)
            count=$((count + 1))
            shift
            break
            ;;
          -c | -C | --git-dir | --work-tree | --namespace | --config-env | --super-prefix | --exec-path | --list-cmds | --attr-source)
            # Global option whose value arrives as the next word.
            shift
            [ "$#" -gt 0 ] && shift
            ;;
          -*)
            # Value-less global option (--no-pager) or inline-value form
            # (--git-dir=/x, -cuser.name=x).
            shift
            ;;
          *)
            # A different subcommand; resume scanning for a later `git` word.
            break
            ;;
        esac
      done
    done
  done < <(printf '%s\n' "$cmd" | tr ';|&()' '\n\n\n\n\n')
  printf '%s' "$count"
}

# Strict scan, step 1. The tokenizer splits CMD into WORDS. Quotes ('', "",
# $'') and backslashes group characters into one word and are removed. `;`,
# `&&` and a newline end a simple command and become the word SEP. `|`, `||`,
# `&`, `(` and `)` also end a simple command and become the word WEAK, because
# a `cd` before them does not reliably change the directory of what follows.
# The body of a here-document is not tokenized. Body text that names a git
# commit or push sets UNSURE. A line without quotes, backslashes or operators
# takes the fast path of plain word splitting.
SEP=$'\x1f'
WEAK=$'\x1e'
WORDS=()
UNSURE=0
tokenize() {
  local line rest word="" in_word=0 lead_quoted=0 quote="" joined part
  local line_start w body_end="" body_strip=0
  local -a plain heredocs
  heredocs=()
  flush() {
    if [ "$in_word" -eq 1 ]; then
      WORDS+=("$word")
      if [ "$lead_quoted" -eq 0 ]; then
        case "$word" in
          "<<<"*) ;;
          "<<-") heredocs+=("-") ;;
          "<<") heredocs+=("+") ;;
          "<<-"*) heredocs+=("-${word#<<-}") ;;
          "<<"*) heredocs+=("+${word#<<}") ;;
        esac
      fi
    fi
    word=""
    in_word=0
    lead_quoted=0
  }
  start_quote() {
    [ "$in_word" -eq 1 ] || lead_quoted=1
    in_word=1
  }
  while IFS= read -r line; do
    if [ -n "$body_end" ]; then
      w="$line"
      if [ "$body_strip" -eq 1 ]; then
        while [ "${w:0:1}" = $'\t' ]; do w="${w:1}"; done
      fi
      if [ "$w" = "$body_end" ]; then
        body_end=""
        if [ "${#heredocs[@]}" -gt 0 ]; then
          body_end="${heredocs[0]:1}"
          [ "${heredocs[0]:0:1}" = "-" ] && body_strip=1 || body_strip=0
          heredocs=("${heredocs[@]:1}")
        fi
      else
        case "$line" in
          *git*commit* | *git*push*) UNSURE=1 ;;
        esac
      fi
      continue
    fi
    line_start="${#WORDS[@]}"
    if [ -z "$quote" ] && [ "$in_word" -eq 0 ]; then
      case "$line" in
        *[\'\"\\\;\|\&\(\)\<]*) ;;
        *)
          # Intentional word splitting; globbing is disabled by the caller.
          # shellcheck disable=SC2206
          plain=($line)
          if [ "${#plain[@]}" -gt 0 ]; then
            WORDS+=("${plain[@]}")
          fi
          WORDS+=("$SEP")
          continue
          ;;
      esac
    fi
    rest="$line"
    joined=0
    while :; do
      if [ "$quote" = "'" ]; then
        if [[ "$rest" == *"'"* ]]; then
          word+="${rest%%\'*}"
          rest="${rest#*\'}"
          quote=""
        else
          word+="$rest"$'\n'
          break
        fi
      elif [ -n "$quote" ]; then
        # A double quote, or ANSI-C quoting ($'...') where a backslash
        # escapes any character, including a single quote.
        while :; do
          if [ "$quote" = '"' ]; then
            part="${rest%%[\"\\\\]*}"
          else
            part="${rest%%[\'\\\\]*}"
          fi
          word+="$part"
          rest="${rest:${#part}}"
          case "${rest:0:1}" in
            \\)
              if [ "${#rest}" -eq 1 ]; then
                joined=1
                break
              fi
              word+="${rest:1:1}"
              rest="${rest:2}"
              ;;
            '')
              break
              ;;
            *)
              rest="${rest:1}"
              quote=""
              break
              ;;
          esac
        done
        if [ -n "$quote" ]; then
          [ "$joined" -eq 1 ] || word+=$'\n'
          break
        fi
      fi
      [ -n "$rest" ] || break
      case "${rest:0:1}" in
        ';')
          flush
          WORDS+=("$SEP")
          rest="${rest:1}"
          ;;
        '&')
          if [ "${rest:1:1}" = '&' ]; then
            flush
            WORDS+=("$SEP")
            rest="${rest:2}"
          elif [ "${rest:1:1}" = '>' ] || { [ "$in_word" -eq 1 ] && [[ "$word" == *[\<\>] ]]; }; then
            # A redirection such as 2>&1 or &>file, not an operator.
            in_word=1
            word+='&'
            rest="${rest:1}"
          else
            flush
            WORDS+=("$WEAK")
            rest="${rest:1}"
          fi
          ;;
        '|' | '(' | ')')
          flush
          WORDS+=("$WEAK")
          rest="${rest:1}"
          ;;
        [[:space:]])
          flush
          rest="${rest:1}"
          ;;
        "'")
          if [ "$in_word" -eq 1 ] && [ "${word: -1}" = '$' ]; then
            quote='$'
          else
            quote="'"
          fi
          start_quote
          rest="${rest:1}"
          ;;
        '"')
          quote='"'
          start_quote
          rest="${rest:1}"
          ;;
        \\)
          in_word=1
          if [ "${#rest}" -eq 1 ]; then
            joined=1
            break
          fi
          word+="${rest:1:1}"
          rest="${rest:2}"
          ;;
        *)
          in_word=1
          part="${rest%%[[:space:]\"\'\\\\;|&()]*}"
          word+="$part"
          rest="${rest:${#part}}"
          ;;
      esac
    done
    if [ -z "$quote" ] && [ "$joined" -eq 0 ]; then
      flush
      WORDS+=("$SEP")
      # A here-document operator with the delimiter in the next word.
      for ((w = line_start; w < ${#WORDS[@]}; w++)); do
        case "${WORDS[$w]}" in
          "<<" | "<<-")
            if [ "${#heredocs[@]}" -gt 0 ]; then
              case "${heredocs[${#heredocs[@]} - 1]}" in
                + | -) heredocs[${#heredocs[@]} - 1]+="${WORDS[$((w + 1))]-}" ;;
              esac
            fi
            ;;
        esac
      done
      if [ "${#heredocs[@]}" -gt 0 ]; then
        body_end="${heredocs[0]:1}"
        [ "${heredocs[0]:0:1}" = "-" ] && body_strip=1 || body_strip=0
        heredocs=("${heredocs[@]:1}")
      fi
    fi
  done <<<"$1"
  flush
}

# Appends path $2 to directory $1. An absolute $2 replaces $1, and a leading
# ~ becomes $HOME.
join_path() {
  local base="$1" path="$2"
  case "$path" in
    \~) path="$HOME" ;;
    \~/*) path="$HOME/${path#\~/}" ;;
  esac
  case "$path" in
    /*) printf '%s' "$path" ;;
    *) printf '%s' "${base:+$base/}$path" ;;
  esac
}

# Strict scan, step 2. Reads WORDS and records each git commit or push. The
# directory of a write is the result of earlier `cd` commands, then -C, then
# --work-tree and the parent of a --git-dir that ends in .git. TARGETS holds
# these directories relative to the session directory. STRICT_WRITES counts
# the writes. A write without a directory sets NEED_SESSION. A form that the
# scan cannot follow sets UNSURE: a word that holds git command text (sh -c,
# eval, quoted text), a GIT_ environment variable, a `cd` with an option or
# without a directory, pushd or popd, and a `cd` before a WEAK operator.
TARGETS=()
STRICT_WRITES=0
NEED_SESSION=0
scan_writes() {
  local i=0 n="${#WORDS[@]}" first=1 cd_dir="" weak_after_cd=0 dir tree gitdir word
  while [ "$i" -lt "$n" ]; do
    word="${WORDS[$i]}"
    i=$((i + 1))
    case "$word" in
      "$SEP")
        first=1
        continue
        ;;
      "$WEAK")
        first=1
        [ -n "$cd_dir" ] && weak_after_cd=1
        continue
        ;;
      *GIT_*)
        UNSURE=1
        ;;
      *git*)
        # Shell text inside one word, such as the script of sh -c or eval.
        case "$word" in
          *[[:space:]\;\|\&\(\)\`\$]*)
            case "$word" in
              *commit* | *push*) UNSURE=1 ;;
            esac
            ;;
        esac
        ;;
    esac
    if [ "$first" -eq 1 ]; then
      first=0
      case "$word" in
        cd)
          if [ "$i" -lt "$n" ]; then
            case "${WORDS[$i]}" in
              "$SEP" | "$WEAK" | -*) UNSURE=1 ;;
              *)
                cd_dir="$(join_path "$cd_dir" "${WORDS[$i]}")"
                i=$((i + 1))
                ;;
            esac
          else
            UNSURE=1
          fi
          continue
          ;;
        pushd | popd | chdir | builtin)
          UNSURE=1
          ;;
      esac
    fi
    [ "$word" = git ] || continue
    dir="$cd_dir"
    tree=""
    gitdir=""
    while [ "$i" -lt "$n" ]; do
      word="${WORDS[$i]}"
      i=$((i + 1))
      case "$word" in
        commit | push)
          STRICT_WRITES=$((STRICT_WRITES + 1))
          [ "$weak_after_cd" -eq 1 ] && UNSURE=1
          if [ -n "$gitdir" ]; then
            gitdir="$(join_path "$dir" "$gitdir")"
            gitdir="${gitdir%/}"
            case "$gitdir" in
              .git) TARGETS+=(".") ;;
              */.git) TARGETS+=("${gitdir%/.git}") ;;
              *) TARGETS+=("$gitdir") ;;
            esac
          fi
          if [ -n "$tree" ]; then
            TARGETS+=("$(join_path "$dir" "$tree")")
          elif [ -z "$gitdir" ]; then
            if [ -n "$dir" ]; then
              TARGETS+=("$dir")
            else
              NEED_SESSION=1
            fi
          fi
          break
          ;;
        -C)
          [ "$i" -lt "$n" ] && dir="$(join_path "$dir" "${WORDS[$i]}")"
          i=$((i + 1))
          ;;
        --work-tree)
          [ "$i" -lt "$n" ] && tree="${WORDS[$i]}"
          i=$((i + 1))
          ;;
        --work-tree=*)
          tree="${word#--work-tree=}"
          ;;
        --git-dir)
          [ "$i" -lt "$n" ] && gitdir="${WORDS[$i]}"
          i=$((i + 1))
          ;;
        --git-dir=*)
          gitdir="${word#--git-dir=}"
          ;;
        -c | --namespace | --config-env | --super-prefix | --exec-path | --list-cmds | --attr-source)
          # Global option whose value arrives as the next word.
          i=$((i + 1))
          ;;
        "$SEP" | "$WEAK")
          i=$((i - 1))
          break
          ;;
        -*)
          # Value-less global option (--no-pager) or inline-value form
          # (--namespace=x, -cuser.name=x).
          ;;
        *)
          # A different subcommand; resume scanning for a later `git` word.
          break
          ;;
      esac
    done
  done
}

# Longest command, in characters, that the strict scan reads.
STRICT_SCAN_MAX=16384

# Quotes and backslashes can split a word (g\it, "com"mit), so the quick
# check reads the command without them.
LOOSE_WRITES=0
case "$(printf '%s' "$CMD" | tr -d '\\"'"'")" in
  *git*commit* | *git*push*)
    set -f
    LOOSE_WRITES="$(count_loose_writes "$CMD")"
    if [ "${#CMD}" -le "$STRICT_SCAN_MAX" ]; then
      tokenize "$CMD"
      scan_writes
    else
      # The strict scan costs too much time on a very long command. Audit the
      # session directory, as the gate did before it read targets.
      UNSURE=1
    fi
    set +f
    ;;
esac

if [ "$STRICT_WRITES" -eq 0 ] && [ "$LOOSE_WRITES" -eq 0 ] && [ "$UNSURE" -eq 0 ]; then
  if [ -n "${FALLOW_GATE_DEBUG:-}" ]; then
    echo "fallow plugin gate: not a git commit/push, skipping audit." >&2
  fi
  exit 0
fi
if [ "$UNSURE" -eq 1 ] || [ "$LOOSE_WRITES" -gt "$STRICT_WRITES" ]; then
  NEED_SESSION=1
fi

# Each target directory that exists is a start for the opted-in walk. A target
# that is not a directory falls back to the session directory.
STARTS=()
if [ "${#TARGETS[@]}" -gt 0 ]; then
  for target in "${TARGETS[@]}"; do
    case "$target" in
      /*) ;;
      *) target="$START/$target" ;;
    esac
    if resolved="$(CDPATH='' cd -- "$target" 2>/dev/null && pwd -P)"; then
      STARTS+=("$resolved")
    else
      NEED_SESSION=1
    fi
  done
fi
[ "$NEED_SESSION" -eq 1 ] && STARTS+=("$START")

ROOTS=()
for start in ${STARTS[@]+"${STARTS[@]}"}; do
  root="$(find_root "$start")" || continue
  seen=0
  if [ "${#ROOTS[@]}" -gt 0 ]; then
    for known in "${ROOTS[@]}"; do
      [ "$known" = "$root" ] && seen=1
    done
  fi
  [ "$seen" -eq 1 ] || ROOTS+=("$root")
done
if [ "${#ROOTS[@]}" -eq 0 ]; then
  if [ -n "${FALLOW_GATE_DEBUG:-}" ]; then
    echo "fallow plugin gate: no fallow config or dependency in this project, skipping." >&2
  fi
  exit 0
fi

# Defer to a gate that fallow already registered for Claude Code or Codex, so
# the audit runs once per command. Defer only when the registered script also
# exists. A stale settings entry must not turn off both gates.
registers_gate() {
  local settings="$1" script="$2"
  [ -f "$settings" ] && [ -f "$script" ] && grep -q 'fallow-gate\.sh' "$settings" 2>/dev/null
}
defers_to() {
  local pair settings script
  for pair in "$@"; do
    settings="${pair%%|*}"
    script="${pair#*|}"
    if registers_gate "$settings" "$script"; then
      if [ -n "${FALLOW_GATE_DEBUG:-}" ]; then
        echo "fallow plugin gate: $settings registers a fallow gate, deferring to it." >&2
      fi
      return 0
    fi
  done
  return 1
}
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$START}"
if defers_to \
  "$PROJECT_DIR/.claude/settings.json|$PROJECT_DIR/.claude/hooks/fallow-gate.sh" \
  "$PROJECT_DIR/.claude/settings.local.json|$PROJECT_DIR/.claude/hooks/fallow-gate.sh" \
  "$HOME/.codex/hooks.json|$HOME/.codex/hooks/fallow-gate.sh" \
  "$HOME/.claude/settings.json|$HOME/.claude/hooks/fallow-gate.sh"; then
  exit 0
fi

TMP_JSON="$(mktemp)"
TMP_ERR="$(mktemp)"
cleanup() {
  rm -f "$TMP_JSON" "$TMP_ERR"
}
trap cleanup EXIT

# Audits the current directory. Returns 2 when fallow audit returns verdict
# fail, else 0.
audit_here() {
  local runner_desc version_raw version min_version lower status verdict is_error msg err_line
  local -a runner
  # A real installed Git hook keeps its caller's PATH and does not add
  # node_modules/.bin, so a project-local install is invisible to `command -v`.
  # The arms below cover the layouts a project-local install can take, in the
  # order they are cheapest to probe. Keep them in step with the Lefthook job
  # `fallow init --hooks` prints: the two must resolve the same installs.
  if command -v fallow >/dev/null 2>&1; then
    runner=(fallow)
    runner_desc="$(command -v fallow)"
  elif [ -x ./node_modules/.bin/fallow ]; then
    runner=(./node_modules/.bin/fallow)
    runner_desc="./node_modules/.bin/fallow"
  elif command -v yarn >/dev/null 2>&1 && YARN_BIN="$(yarn bin fallow 2>/dev/null)" && [ -n "$YARN_BIN" ]; then
    # Yarn Plug'n'Play has no node_modules/.bin at all, so neither the launcher
    # check above nor npx can see the install.
    runner=(yarn exec fallow --)
    runner_desc="yarn exec fallow"
  elif command -v npx >/dev/null 2>&1 && VER_PROBE="$(npx --no-install fallow --version 2>/dev/null || true)" && [[ "$VER_PROBE" == fallow* ]]; then
    runner=(npx --no-install fallow)
    runner_desc="npx --no-install fallow"
  else
    {
      echo "fallow plugin gate: the fallow binary is not installed (tried PATH, node_modules/.bin, yarn and npx --no-install)."
      echo "fallow plugin gate: the commit or push continues without a fallow audit."
      echo "fallow plugin gate: install fallow (npm install -D fallow) to turn the gate on, or set FALLOW_PLUGIN_GATE=off to hide this notice."
    } >&2
    return 0
  fi

  version_raw="$("${runner[@]}" --version 2>/dev/null || true)"
  version="${version_raw#fallow }"
  version="${version%% *}"

  min_version="${FALLOW_GATE_MIN_VERSION-2.85.0}"
  if [ -n "$min_version" ] && [ -n "$version" ]; then
    lower="$(printf '%s\n%s\n' "$min_version" "$version" | sort -V | head -n1)"
    if [ "$lower" != "$min_version" ]; then
      {
        echo "fallow plugin gate: $runner_desc is fallow $version, below the required $min_version."
        echo "fallow plugin gate: the commit or push continues without a fallow audit."
        echo "fallow plugin gate: upgrade fallow (npm install -D fallow@latest or cargo install fallow-cli) to turn the gate on."
      } >&2
      return 0
    fi
  fi

  if "${runner[@]}" audit --format json --quiet --explain --gate-marker agent >"$TMP_JSON" 2>"$TMP_ERR"; then
    status=0
  else
    status=$?
  fi

  verdict="$(jq -r '.verdict // empty' <"$TMP_JSON" 2>/dev/null || true)"
  is_error="$(jq -r '.error // false' <"$TMP_JSON" 2>/dev/null || echo false)"

  if [ "$verdict" = "fail" ]; then
    echo "fallow plugin gate: blocked by fallow ${version:-unknown} at $runner_desc in $PWD" >&2
    cat "$TMP_JSON" >&2
    return 2
  fi

  if [ "$status" -eq 2 ] || [ "$is_error" = "true" ]; then
    msg="$(jq -r '.message // empty' <"$TMP_JSON" 2>/dev/null || true)"
    if [ -n "$msg" ]; then
      echo "fallow plugin gate: fallow audit runtime error ($msg), skipping." >&2
    else
      echo "fallow plugin gate: fallow audit runtime error, skipping." >&2
    fi
    return 0
  fi

  if [ "$status" -ne 0 ]; then
    err_line="$(sed -n '1p' "$TMP_ERR" 2>/dev/null || true)"
    if [ -n "$err_line" ]; then
      echo "fallow plugin gate: fallow audit exited $status ($err_line), skipping." >&2
    else
      echo "fallow plugin gate: fallow audit exited $status, skipping." >&2
    fi
  fi
  return 0
}

for root in "${ROOTS[@]}"; do
  if defers_to \
    "$root/.claude/settings.json|$root/.claude/hooks/fallow-gate.sh" \
    "$root/.claude/settings.local.json|$root/.claude/hooks/fallow-gate.sh" \
    "$root/.codex/hooks.json|$root/.codex/hooks/fallow-gate.sh"; then
    continue
  fi
  if [ -n "${FALLOW_GATE_DEBUG:-}" ]; then
    echo "fallow plugin gate: auditing $root." >&2
  fi
  cd "$root"
  if ! audit_here; then
    exit 2
  fi
done

exit 0
