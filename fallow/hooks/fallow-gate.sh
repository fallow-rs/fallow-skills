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
#   registered its own gate for this session, this script does not audit the
#   session tree again. That gate audits only the session tree, so this script
#   still audits every other target.
# - It runs only in a project that chose fallow (a fallow config file or a
#   `fallow` dependency in package.json). It always audits the session tree,
#   plus each opted-in tree that a git commit or push targets. Only a command
#   on a short allowlist with a certain target (git -C <dir> commit, or
#   cd <dir> && git push, with literal words and inert options) audits the
#   target alone.
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

# The gate always audits the session directory, except for a command on a
# short allowlist where the target is certain. Then it audits only the target.
# For every other git commit or push it audits the session directory and
# every target that it can resolve, and a fail verdict in any of them blocks.

# Appends path $2 to directory $1. An absolute $2 replaces $1.
join_path() {
  case "$2" in
    /*) printf '%s' "$2" ;;
    *) printf '%s' "${1:+$1/}$2" ;;
  esac
}

# Prints the physical path of directory $1, relative to the session
# directory. Returns 1 when $1 is not a directory.
resolve_dir() {
  local dir="$1"
  case "$dir" in
    /*) ;;
    *) dir="$START/$dir" ;;
  esac
  (CDPATH='' cd -- "$dir" 2>/dev/null && pwd -P)
}

# Loose scan: the original word-splitting detector. It splits $1 at control
# operators and at blanks, and ignores quotes. Git-level options between `git`
# and the subcommand (git -c k=v commit, git -C dir push, git --no-pager
# commit, git --git-dir=/x push) still count, while subcommand lookalikes in
# arguments (git log commit-message.txt) do not. See issue #2106. It adds the
# number of git commit and push commands to LOOSE_WRITES. It adds each
# directory that a `cd`, -C, --work-tree or --git-dir names to TARGETS.
LOOSE_WRITES=0
TARGETS=()
scan_loose() {
  local cmd="$1" segment dir dir_value
  # Control operators separate simple commands; each becomes its own line.
  while IFS= read -r segment; do
    # Intentional word splitting; globbing is disabled by the caller.
    # shellcheck disable=SC2086
    set -- $segment
    if [ "${1:-}" = cd ] && [ "$#" -ge 2 ]; then
      TARGETS+=("$2")
    fi
    while [ "$#" -gt 0 ]; do
      if [ "$1" != "git" ]; then
        shift
        continue
      fi
      shift
      dir=""
      while [ "$#" -gt 0 ]; do
        case "$1" in
          commit | push)
            LOOSE_WRITES=$((LOOSE_WRITES + 1))
            [ -n "$dir" ] && TARGETS+=("$dir")
            shift
            break
            ;;
          -C)
            [ "$#" -gt 1 ] && dir="$(join_path "$dir" "$2")"
            shift
            [ "$#" -gt 0 ] && shift
            ;;
          --work-tree | --git-dir)
            [ "$#" -gt 1 ] && TARGETS+=("$(join_path "$dir" "${2%/.git}")")
            shift
            [ "$#" -gt 0 ] && shift
            ;;
          --work-tree=* | --git-dir=*)
            dir_value="${1#*=}"
            TARGETS+=("$(join_path "$dir" "${dir_value%/.git}")")
            shift
            ;;
          -c | --namespace | --config-env | --super-prefix | --exec-path | --list-cmds | --attr-source)
            # Global option whose value arrives as the next word.
            shift
            [ "$#" -gt 0 ] && shift
            ;;
          -*)
            # Value-less global option (--no-pager) or inline-value form
            # (-cuser.name=x).
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
}

# The allowlist. ALLOWED_DIR is set to the target when the whole command is
# one of these, with spaces or tabs between the words:
#   git [-C <dir>]... (commit|push) <args>
#   cd <dir> && git (commit|push) <args>
# <dir> is a plain word, or one pair of quotes around a plain word that can
# also hold spaces. A plain word holds only letters, digits and
# `- _ . / = : , @ + %`. A `cd` directory starts with `/`, `./` or `../` (or
# is `.` or `..`), so CDPATH cannot move it. <args> are plain words, and the
# options in them are only -m, --message, -S, -q, -a, --amend, --no-edit and
# -u. The word after -m or --message can be a quoted message ('...', or "..."
# without $, ` or \). Anything else does not match: another operator, a
# newline outside the message, a substitution, a variable, a glob, a tilde,
# git -c, an option such as -F, --template, --exec or --receive-pack, `--`,
# or an environment prefix. The caller also requires that the target is a
# directory inside a git work tree.
ALLOWED_DIR=""
SAFE_CHARS='A-Za-z0-9_./=:,@+%-'
DIR_RE="^([${SAFE_CHARS%-}][${SAFE_CHARS}]*|'[ ${SAFE_CHARS}]+'|\"[ ${SAFE_CHARS}]+\")"
WORD_RE="^[${SAFE_CHARS}]+"
MSG_RE='^('"'"'[^'"'"']*'"'"'|"[^"$`\\]*")'
BLANK_RE='^[ 	]+'
match_allowlist() {
  # Byte-wise ranges, so [A-Za-z] matches no letter outside ASCII.
  local LC_ALL=C
  local rest="$1" dir="" word prev=""
  # Takes the next blanks, then the next token that matches $1, into word.
  take() {
    [[ "$rest" =~ $BLANK_RE ]] && rest="${rest:${#BASH_REMATCH[0]}}"
    [[ "$rest" =~ $1 ]] || return 1
    word="${BASH_REMATCH[0]}"
    rest="${rest:${#word}}"
  }
  # Removes one pair of quotes around a directory.
  unquote() {
    case "$word" in
      \'*\' | \"*\") word="${word:1:${#word}-2}" ;;
    esac
  }
  if take '^cd[ 	]'; then
    take "$DIR_RE" || return 1
    unquote
    case "$word" in
      / | /* | . | .. | ./* | ../*) dir="$word" ;;
      *) return 1 ;;
    esac
    take '^&&' || return 1
  fi
  take '^git([ 	]|$)' || return 1
  if [ -z "$dir" ]; then
    while take '^-C[ 	]'; do
      take "$DIR_RE" || return 1
      unquote
      dir="$(join_path "$dir" "$word")"
    done
  fi
  take '^(commit|push)([ 	]|$)' || return 1
  while :; do
    [[ "$rest" =~ $BLANK_RE ]] && rest="${rest:${#BASH_REMATCH[0]}}"
    [ -n "$rest" ] || break
    case "$prev" in
      -m | --message)
        take "$MSG_RE" || take "$WORD_RE" || return 1
        ;;
      *)
        take "$WORD_RE" || return 1
        case "$word" in
          -m | --message | -S | -q | -a | --amend | --no-edit | -u) ;;
          -*) return 1 ;;
        esac
        ;;
    esac
    # The next word must start after a blank.
    case "${rest:0:1}" in
      '' | ' ' | '	') ;;
      *) return 1 ;;
    esac
    prev="$word"
  done
  ALLOWED_DIR="${dir:-.}"
}

# Returns 0 when physical directory $1 is inside a git work tree: a parent
# holds a .git entry, and $1 is not inside a .git directory.
in_work_tree() {
  local dir="$1"
  case "$dir/" in
    */.git/*) return 1 ;;
  esac
  until [ -e "$dir/.git" ]; do
    [ "$dir" != / ] || return 1
    dir="$(dirname "$dir")"
  done
}

# Longest command, in characters, that the allowlist reads.
ALLOWLIST_MAX=16384

# Quotes, backslashes, substitutions and line continuations can hide a git
# word (g\it, "com"mit, git -C "$(pwd)" commit). The floor also counts a copy
# of the command without these characters and with its lines joined.
# shellcheck disable=SC2016
FLAT="$(printf '%s' "$CMD" | tr -d '\\"'"'"'$()`{}' | tr '\n' ' ')"
set -f
case "$FLAT" in
  *git*commit* | *git*push*)
    scan_loose "$CMD"
    scan_loose "$FLAT"
    if [ "${#CMD}" -le "$ALLOWLIST_MAX" ]; then
      match_allowlist "$CMD" || ALLOWED_DIR=""
    fi
    ;;
esac
set +f

if [ "$LOOSE_WRITES" -eq 0 ] && [ -z "$ALLOWED_DIR" ]; then
  if [ -n "${FALLOW_GATE_DEBUG:-}" ]; then
    echo "fallow plugin gate: not a git commit/push, skipping audit." >&2
  fi
  exit 0
fi

# Each directory that exists is a start for the opted-in walk. An allowlisted
# command whose target is not a directory in a git work tree audits the
# session directory.
STARTS=()
if [ -n "$ALLOWED_DIR" ] && resolved="$(resolve_dir "$ALLOWED_DIR")" && in_work_tree "$resolved"; then
  STARTS+=("$resolved")
else
  STARTS+=("$(resolve_dir "$START" || printf '%s' "$START")")
  if [ "${#TARGETS[@]}" -gt 0 ]; then
    for target in "${TARGETS[@]}"; do
      case "$target" in
        \'*\' | \"*\") target="${target:1:${#target}-2}" ;;
      esac
      if resolved="$(resolve_dir "$target")"; then
        STARTS+=("$resolved")
      fi
    done
  fi
fi

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
# the audit runs once per tree. Such a gate runs from the session directory
# and audits only the session tree. It does not cover another target, and a
# gate registered inside another tree does not run for this session. So the
# plugin defers only for the session root, and only when a gate that this
# session loads is registered. Defer only when the registered script also
# exists. A stale settings entry must not turn off both gates.
registers_gate() {
  local settings="$1" script="$2"
  [ -f "$settings" ] && [ -f "$script" ] && grep -q 'fallow-gate\.sh' "$settings" 2>/dev/null
}
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$START}"
SESSION_ROOT="$(find_root "$(resolve_dir "$START" || printf '%s' "$START")" || true)"
covered_by_installed_gate() {
  local root="$1" pair settings script
  [ -n "$SESSION_ROOT" ] && [ "$root" = "$SESSION_ROOT" ] || return 1
  for pair in \
    "$PROJECT_DIR/.claude/settings.json|$PROJECT_DIR/.claude/hooks/fallow-gate.sh" \
    "$PROJECT_DIR/.claude/settings.local.json|$PROJECT_DIR/.claude/hooks/fallow-gate.sh" \
    "$root/.claude/settings.json|$root/.claude/hooks/fallow-gate.sh" \
    "$root/.claude/settings.local.json|$root/.claude/hooks/fallow-gate.sh" \
    "$root/.codex/hooks.json|$root/.codex/hooks/fallow-gate.sh" \
    "$HOME/.codex/hooks.json|$HOME/.codex/hooks/fallow-gate.sh" \
    "$HOME/.claude/settings.json|$HOME/.claude/hooks/fallow-gate.sh"; do
    settings="${pair%%|*}"
    script="${pair#*|}"
    if registers_gate "$settings" "$script"; then
      if [ -n "${FALLOW_GATE_DEBUG:-}" ]; then
        echo "fallow plugin gate: $settings registers a fallow gate for $root, deferring to it." >&2
      fi
      return 0
    fi
  done
  return 1
}

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
  if covered_by_installed_gate "$root"; then
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
