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
#   `fallow` dependency in package.json), and it audits the nearest such
#   directory above the directory that the git command targets (git -C dir,
#   --work-tree, --git-dir, or an earlier cd), else above the session
#   directory.
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
# package.json. The walk starts at the directory that the git command targets,
# else at the `cwd` of the hook input (the session directory). It goes up to
# the nearest directory that matches, and stops at the first .git entry. The
# audit then runs in that directory.
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

# The tokenizer splits CMD into WORDS. Quotes and backslashes group characters
# into one word and are removed. A control operator outside quotes (; | & ( )
# or a newline) ends a simple command and is stored as the word SEP. A line
# without quotes, backslashes or operators takes the fast path of plain word
# splitting. The tokenizer stops after the first line that completes a git
# commit or push, so a long commit message costs little.
SEP=$'\x1f'
WORDS=()
tokenize() {
  local line rest word="" in_word=0 quote="" joined part
  local -a plain
  flush() {
    if [ "$in_word" -eq 1 ]; then
      WORDS+=("$word")
    fi
    word=""
    in_word=0
  }
  while IFS= read -r line; do
    if [ -z "$quote" ] && [ "$in_word" -eq 0 ]; then
      case "$line" in
        *[\'\"\\\;\|\&\(\)]*) ;;
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
      elif [ "$quote" = '"' ]; then
        while :; do
          part="${rest%%[\"\\\\]*}"
          word+="$part"
          rest="${rest:${#part}}"
          case "${rest:0:1}" in
            '"')
              rest="${rest:1}"
              quote=""
              break
              ;;
            \\)
              if [ "${#rest}" -eq 1 ]; then
                joined=1
                break
              fi
              word+="${rest:1:1}"
              rest="${rest:2}"
              ;;
            *)
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
        ';' | '|' | '&' | '(' | ')')
          flush
          WORDS+=("$SEP")
          rest="${rest:1}"
          ;;
        [[:space:]])
          flush
          rest="${rest:1}"
          ;;
        "'" | '"')
          in_word=1
          quote="${rest:0:1}"
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
      case "$line" in
        *git*commit* | *git*push*)
          find_git_write && return 0
          ;;
      esac
    fi
  done <<<"$1"
  flush
  find_git_write || true
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

# Sets GIT_WRITE=1 when a simple command in WORDS runs git commit or git push.
# The scan reads options between `git` and the subcommand (git -c k=v commit,
# git -C dir push, git --no-pager commit, git --git-dir=/x push), while
# subcommand lookalikes in arguments (git log commit-message.txt) do not count.
# See issue #2106. TARGET becomes the directory that the first such git command
# works in, relative to the session directory: an earlier `cd`, then -C, then
# --work-tree or the parent of a --git-dir that ends in .git. TARGET stays
# empty when the command names no directory.
find_git_write() {
  local i=0 n="${#WORDS[@]}" first=1 cd_dir="" dir tree gitdir word
  GIT_WRITE=0
  TARGET=""
  while [ "$i" -lt "$n" ]; do
    word="${WORDS[$i]}"
    i=$((i + 1))
    if [ "$word" = "$SEP" ]; then
      first=1
      continue
    fi
    if [ "$first" -eq 1 ] && [ "$word" = cd ]; then
      first=0
      if [ "$i" -lt "$n" ] && [ "${WORDS[$i]}" != "$SEP" ]; then
        cd_dir="$(join_path "$cd_dir" "${WORDS[$i]}")"
        i=$((i + 1))
      fi
      continue
    fi
    first=0
    [ "$word" = git ] || continue
    dir="$cd_dir"
    tree=""
    gitdir=""
    while [ "$i" -lt "$n" ]; do
      word="${WORDS[$i]}"
      i=$((i + 1))
      case "$word" in
        commit | push)
          GIT_WRITE=1
          if [ -n "$tree" ]; then
            dir="$(join_path "$dir" "$tree")"
          elif [ -n "$gitdir" ]; then
            gitdir="$(join_path "$dir" "$gitdir")"
            gitdir="${gitdir%/}"
            case "$gitdir" in
              .git) dir="." ;;
              */.git) dir="${gitdir%/.git}" ;;
              *) dir="$gitdir" ;;
            esac
          fi
          TARGET="$dir"
          return 0
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
        "$SEP")
          first=1
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
  return 1
}

GIT_WRITE=0
TARGET=""
case "$CMD" in
  *git*commit* | *git*push*)
    set -f
    tokenize "$CMD"
    set +f
    ;;
esac

# A git write that names another directory (git -C other commit, cd other &&
# git push) audits that directory, not the session directory. A target that
# is not a directory leaves the walk at the session directory.
WALK_FROM="$START"
if [ -n "$TARGET" ]; then
  case "$TARGET" in
    /*) ;;
    *) TARGET="$START/$TARGET" ;;
  esac
  if RESOLVED="$(CDPATH='' cd -- "$TARGET" 2>/dev/null && pwd -P)"; then
    WALK_FROM="$RESOLVED"
    if [ -n "${FALLOW_GATE_DEBUG:-}" ]; then
      echo "fallow plugin gate: the command targets $WALK_FROM." >&2
    fi
  fi
fi

ROOT="$WALK_FROM"
until opted_in "$ROOT"; do
  if [ -e "$ROOT/.git" ] || [ "$ROOT" = / ]; then
    if [ -n "${FALLOW_GATE_DEBUG:-}" ]; then
      echo "fallow plugin gate: no fallow config or dependency in this project, skipping." >&2
    fi
    exit 0
  fi
  ROOT="$(dirname "$ROOT")"
done
cd "$ROOT"

if [ "$HAVE_JQ" -eq 0 ]; then
  # Without jq the gate cannot parse the command. Print the notice only for
  # input that can be a git commit or push, not for every Bash command.
  case "$INPUT" in
    *git*commit* | *git*push*)
      echo "fallow plugin gate: jq is not on PATH. The commit or push continues without a fallow audit. Install jq to turn the gate on." >&2
      ;;
  esac
  exit 0
fi

if [ "$GIT_WRITE" -eq 0 ]; then
  if [ -n "${FALLOW_GATE_DEBUG:-}" ]; then
    echo "fallow plugin gate: not a git commit/push, skipping audit." >&2
  fi
  exit 0
fi

# Defer to a gate that fallow already registered for Claude Code or Codex, so
# the audit runs once per command. Defer only when the registered script also
# exists. A stale settings entry must not turn off both gates.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$ROOT}"
registers_gate() {
  local settings="$1" script="$2"
  [ -f "$settings" ] && [ -f "$script" ] && grep -q 'fallow-gate\.sh' "$settings" 2>/dev/null
}
for pair in \
  "$PROJECT_DIR/.claude/settings.json|$PROJECT_DIR/.claude/hooks/fallow-gate.sh" \
  "$PROJECT_DIR/.claude/settings.local.json|$PROJECT_DIR/.claude/hooks/fallow-gate.sh" \
  "$ROOT/.claude/settings.json|$ROOT/.claude/hooks/fallow-gate.sh" \
  "$ROOT/.claude/settings.local.json|$ROOT/.claude/hooks/fallow-gate.sh" \
  "$ROOT/.codex/hooks.json|$ROOT/.codex/hooks/fallow-gate.sh" \
  "$HOME/.codex/hooks.json|$HOME/.codex/hooks/fallow-gate.sh" \
  "$HOME/.claude/settings.json|$HOME/.claude/hooks/fallow-gate.sh"; do
  settings="${pair%%|*}"
  script="${pair#*|}"
  if registers_gate "$settings" "$script"; then
    if [ -n "${FALLOW_GATE_DEBUG:-}" ]; then
      echo "fallow plugin gate: $settings registers a fallow gate, deferring to it." >&2
    fi
    exit 0
  fi
done

# A real installed Git hook keeps its caller's PATH and does not add
# node_modules/.bin, so a project-local install is invisible to `command -v`.
# The arms below cover the layouts a project-local install can take, in the
# order they are cheapest to probe. Keep them in step with the Lefthook job
# `fallow init --hooks` prints: the two must resolve the same installs.
if command -v fallow >/dev/null 2>&1; then
  RUNNER=(fallow)
  BIN_DESC="$(command -v fallow)"
elif [ -x ./node_modules/.bin/fallow ]; then
  RUNNER=(./node_modules/.bin/fallow)
  BIN_DESC="./node_modules/.bin/fallow"
elif command -v yarn >/dev/null 2>&1 && YARN_BIN="$(yarn bin fallow 2>/dev/null)" && [ -n "$YARN_BIN" ]; then
  # Yarn Plug'n'Play has no node_modules/.bin at all, so neither the launcher
  # check above nor npx can see the install.
  RUNNER=(yarn exec fallow --)
  BIN_DESC="yarn exec fallow"
elif command -v npx >/dev/null 2>&1 && VER_PROBE="$(npx --no-install fallow --version 2>/dev/null || true)" && [[ "$VER_PROBE" == fallow* ]]; then
  RUNNER=(npx --no-install fallow)
  BIN_DESC="npx --no-install fallow"
else
  {
    echo "fallow plugin gate: the fallow binary is not installed (tried PATH, node_modules/.bin, yarn and npx --no-install)."
    echo "fallow plugin gate: the commit or push continues without a fallow audit."
    echo "fallow plugin gate: install fallow (npm install -D fallow) to turn the gate on, or set FALLOW_PLUGIN_GATE=off to hide this notice."
  } >&2
  exit 0
fi

VERSION_RAW="$("${RUNNER[@]}" --version 2>/dev/null || true)"
VERSION="${VERSION_RAW#fallow }"
VERSION="${VERSION%% *}"

MIN_VERSION="${FALLOW_GATE_MIN_VERSION-2.85.0}"
if [ -n "$MIN_VERSION" ] && [ -n "$VERSION" ]; then
  LOWER="$(printf '%s\n%s\n' "$MIN_VERSION" "$VERSION" | sort -V | head -n1)"
  if [ "$LOWER" != "$MIN_VERSION" ]; then
    {
      echo "fallow plugin gate: $BIN_DESC is fallow $VERSION, below the required $MIN_VERSION."
      echo "fallow plugin gate: the commit or push continues without a fallow audit."
      echo "fallow plugin gate: upgrade fallow (npm install -D fallow@latest or cargo install fallow-cli) to turn the gate on."
    } >&2
    exit 0
  fi
fi

TMP_JSON="$(mktemp)"
TMP_ERR="$(mktemp)"
cleanup() {
  rm -f "$TMP_JSON" "$TMP_ERR"
}
trap cleanup EXIT

if "${RUNNER[@]}" audit --format json --quiet --explain --gate-marker agent >"$TMP_JSON" 2>"$TMP_ERR"; then
  STATUS=0
else
  STATUS=$?
fi

VERDICT="$(jq -r '.verdict // empty' <"$TMP_JSON" 2>/dev/null || true)"
IS_ERROR="$(jq -r '.error // false' <"$TMP_JSON" 2>/dev/null || echo false)"

if [ "$VERDICT" = "fail" ]; then
  echo "fallow plugin gate: blocked by fallow ${VERSION:-unknown} at $BIN_DESC" >&2
  cat "$TMP_JSON" >&2
  exit 2
fi

if [ "$STATUS" -eq 2 ] || [ "$IS_ERROR" = "true" ]; then
  MSG="$(jq -r '.message // empty' <"$TMP_JSON" 2>/dev/null || true)"
  if [ -n "$MSG" ]; then
    echo "fallow plugin gate: fallow audit runtime error ($MSG), skipping." >&2
  else
    echo "fallow plugin gate: fallow audit runtime error, skipping." >&2
  fi
  exit 0
fi

if [ "$STATUS" -ne 0 ]; then
  ERR_LINE="$(sed -n '1p' "$TMP_ERR" 2>/dev/null || true)"
  if [ -n "$ERR_LINE" ]; then
    echo "fallow plugin gate: fallow audit exited $STATUS ($ERR_LINE), skipping." >&2
  else
    echo "fallow plugin gate: fallow audit exited $STATUS, skipping." >&2
  fi
  exit 0
fi

exit 0
