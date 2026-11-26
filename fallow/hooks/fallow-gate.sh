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
#   on a short allowlist (git -C <dir> commit, or cd <dir> && git push, with
#   literal words and inert options) audits the target alone, and only when
#   git reports that the target is another repository than the session's. A
#   push from a linked worktree of the session repository also audits the
#   target alone when git shows that the push cannot send the session branch.
# - Codex also loads this hook from the plugin. It defers to a gate that
#   `fallow agent install` registered for Claude Code or for Codex.
# - The gate runs the first `fallow` in an absolute PATH entry that has no
#   node_modules component and is outside the session tree, the tree of each
#   write target and the tree of each audited directory. The physical path of
#   that fallow is also outside these trees. It does not run a project-local
#   launcher, yarn, npx or a version-manager shim (a directory named shims, a
#   Volta bin directory, the shim directory of VOLTA_HOME, ASDF_DATA_DIR or
#   MISE_DATA_DIR, or a program named volta-shim), because a shim can run the
#   fallow that the project installs. The helpers (jq, git, sed and the
#   others) come only from the PATH entries that the same rules keep. jq
#   parses the hook input before the gate knows the write targets, and tr
#   and awk read a command outside the allowlist before the gate finds the
#   targets. A session or target directory that is `/`, or HOME outside git,
#   excludes only that directory, so the user tools below HOME stay in use.
#   A target or audit root that is HOME also excludes only HOME itself.
# - When the tree of a write target or of an audited directory holds the
#   only trusted fallow or git, the gate blocks the command (exit 2) before
#   any audit and names the target. Without that tree the fallow or git is
#   trusted, so the gate cannot allow the command with no audit.
# - A missing trusted fallow binary, a missing jq or a fallow binary below the
#   version floor allows the command and prints a clear notice on stderr.
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

# Most Bash commands are not a git commit or push. The prefilter reads the
# hook input with shell builtins only and exits when the input cannot hold
# one. text_can_write below gives the rule. An input longer than
# PREFILTER_MAX bytes goes to the full check, because the removal is slow on
# a long input in bash 3.2.
PREFILTER_MAX=2048
# A hook runner can give a socket as stdin. On macOS, /dev/stdin opens a
# socket, and the read through it is fast. On Linux, /dev/stdin cannot open a
# socket, so the gate reads file descriptor 0 with the read builtin: in blocks
# with bash 5 or later, else up to each NUL byte. Each form drops a NUL byte
# and keeps the text after it.
INPUT=""
chunk=""
case "${OSTYPE:-}" in
  darwin*)
    { INPUT="$(</dev/stdin)"; } 2>/dev/null || INPUT=""
    ;;
  *)
    if [ "${BASH_VERSINFO[0]:-0}" -ge 5 ]; then
      while IFS= read -r -N 65536 chunk 2>/dev/null || [ -n "$chunk" ]; do
        INPUT+="$chunk"
        chunk=""
      done
    else
      while IFS= read -r -d '' chunk 2>/dev/null; do
        INPUT+="$chunk"
      done
      INPUT+="$chunk"
    fi
    ;;
esac
# Returns 0 when the text $1 can hold a git commit or push. The function
# removes quotes and backslashes, and for a flat copy also the other
# characters that can hide a word (`$`, parentheses, braces and backticks).
# The text can hold a write when, in any letter case, it has a `commit` or
# `push` word, or `git` before an expansion, a brace, a glob or a backquote.
# A program name from an expansion or a glob (`$G commit`, `g?t push`) still
# has the `commit` or `push` word. A git subcommand with a brace or a glob
# (`git c{o,}mmit`, `git c?mmit`) has `git` before it. A JSON \u escape can
# hide a word, so a text with one can always hold a write.
text_can_write() {
  local LC_ALL=C text="$1" flat hit=1
  case "$text" in
    *'\u'*) return 0 ;;
  esac
  text="${text//\\/}"
  text="${text//\"/}"
  text="${text//\'/}"
  flat="${text//\$/}"
  flat="${flat//\(/}"
  flat="${flat//\)/}"
  flat="${flat//\`/}"
  flat="${flat//\{/}"
  flat="${flat//\}/}"
  shopt -s nocasematch
  case "$flat" in
    *commit* | *push* | *git*[\?\*\[]*) hit=0 ;;
    *)
      case "$text" in
        *git*[\$\{\`\?\*\[]*) hit=0 ;;
      esac
      ;;
  esac
  shopt -u nocasematch
  return "$hit"
}
prefilter_can_write() {
  [ "${#1}" -le "$PREFILTER_MAX" ] || return 0
  text_can_write "$1"
}
if ! prefilter_can_write "$INPUT"; then
  if [ -n "${FALLOW_GATE_DEBUG:-}" ]; then
    echo "fallow plugin gate: not a git commit/push, skipping audit." >&2
  fi
  exit 0
fi

# PATH rules. The gate runs a program, a helper such as jq or git or the
# fallow audit, only from an absolute PATH entry. The entry has no
# node_modules component, before or after links, and it is not inside an
# excluded tree: the session tree, the tree of each target of the git write,
# and the tree of each audited directory. The tree of a directory is the
# union of its git work tree top and the nearest directory with a .git
# entry. Path comparisons ignore letter case. These functions use shell
# builtins and no subshell, so the gate filters PATH before each new tree
# can run a program. An EXCLUDED entry that starts with `=` excludes only
# that one directory, not the directories below it.
#
# The gate keeps two lists of the trees that it adds. BASE_TREES holds the
# trees of the process directory and of the session. TARGET_TREES holds the
# trees of each command target and audit root, and TARGET_LABELS holds the
# target word or root for each entry. When the target trees remove a fallow
# or a git that the base trees keep, the gate blocks the command and names
# the target, because it cannot audit that target.
EXCLUDED=()
ORIG_PATH="$PATH"
BASE_TREES=()
TARGET_TREES=()
TARGET_LABELS=()

# Sets RESOLVED to the physical path of directory $1, with every link
# resolved. Returns 1 when $1 is empty or is not a directory.
resolve_dir() {
  local back="$PWD"
  RESOLVED=""
  [ -n "$1" ] || return 1
  CDPATH='' cd -P -- "$1" 2>/dev/null || return 1
  RESOLVED="$PWD"
  if ! CDPATH='' cd -- "$back" 2>/dev/null; then
    echo "fallow plugin gate: cannot return to $back. The command continues without a fallow audit." >&2
    exit 0
  fi
}

# Returns 0 when path $1 has a node_modules component, in any letter case.
has_node_modules() {
  local found=1
  shopt -s nocasematch
  case "/$1/" in
    */node_modules/*) found=0 ;;
  esac
  shopt -u nocasematch
  return "$found"
}

# Returns 0 when path $1 is directory $2 or a path inside it, in any letter
# case.
inside_tree() {
  local dir="${1%/}/" tree="${2%/}/" found=1
  shopt -s nocasematch
  case "$dir" in
    "$tree"*) found=0 ;;
  esac
  shopt -u nocasematch
  return "$found"
}

# Sets ANCESTOR to the nearest directory at or above $1 that holds a .git
# entry. Returns 1 and sets ANCESTOR to $1 when no directory does, or when $1
# is not an absolute path.
git_ancestor() {
  local dir="$1"
  ANCESTOR="$1"
  case "$dir" in
    /*) ;;
    *) return 1 ;;
  esac
  while :; do
    if [ -e "$dir/.git" ]; then
      ANCESTOR="$dir"
      return 0
    fi
    [ -n "$dir" ] && [ "$dir" != / ] || return 1
    dir="${dir%/*}"
    [ -n "$dir" ] || dir=/
  done
}

# Returns 0 when paths $1 and $2 name the same directory, in any letter case.
is_same_dir() {
  inside_tree "$1" "$2" && inside_tree "$2" "$1"
}

# Returns 0 when path $1 is excluded: it is inside a tree of EXCLUDED, or it
# is the directory of an exact entry. A tree of `/` excludes nothing.
is_excluded() {
  local tree
  for tree in ${EXCLUDED[@]+"${EXCLUDED[@]}"}; do
    case "$tree" in
      /) ;;
      =*) ! is_same_dir "$1" "${tree#=}" || return 0 ;;
      *) ! inside_tree "$1" "$tree" || return 0 ;;
    esac
  done
  return 1
}

# Sets TREES to the trees of directory $1: the nearest directory with a .git
# entry, and the git top $2 when the caller knows it. Without a .git entry,
# the tree is $1 itself when $3 is `self`. A tree that is HOME or `/`, for a
# directory below it, becomes the directory itself, so a git repository of
# the home folder keeps the user tools under HOME in use. A tree that is `/`,
# or HOME without a .git entry, for that same directory, excludes only that
# one directory. When $4 is not `base` (a command target or an audit root), a
# tree that is HOME for that same directory also excludes only HOME itself.
tree_of() {
  local dir="$1" home="" tree kind="${4:-}"
  local -a found
  ! resolve_dir "$dir" || dir="$RESOLVED"
  found=()
  if git_ancestor "$dir" || [ "${3:-}" = self ]; then
    found+=("$ANCESTOR")
  fi
  if [ -n "${2:-}" ]; then
    if resolve_dir "$2"; then found+=("$RESOLVED"); else found+=("$2"); fi
  fi
  ! resolve_dir "${HOME:-}" || home="$RESOLVED"
  TREES=()
  for tree in ${found[@]+"${found[@]}"}; do
    if [ "$tree" = / ] || { [ -n "$home" ] && is_same_dir "$tree" "$home"; }; then
      if ! inside_tree "$tree" "$dir"; then
        tree="$dir"
      elif [ "$tree" = / ] || [ "$kind" != base ] || [ ! -e "$home/.git" ]; then
        tree="=$dir"
      fi
    fi
    TREES+=("$tree")
  done
}

# Adds each tree in the arguments to EXCLUDED and sets PATH to the entries
# that the rules keep. Each kept entry is its resolved directory. When no
# entry stays, PATH names a directory with no programs, because an empty PATH
# searches the current directory.
filter_path() {
  local entry dir kept=""
  local -a entries
  EXCLUDED+=(${1+"$@"})
  IFS=: read -r -a entries <<<"$PATH"
  for entry in ${entries[@]+"${entries[@]}"}; do
    case "$entry" in
      /*) ;;
      *) continue ;;
    esac
    ! has_node_modules "$entry" || continue
    resolve_dir "$entry" || continue
    dir="$RESOLVED"
    # A colon in the resolved directory would split it into other entries.
    case "$dir" in
      *:*) continue ;;
    esac
    ! has_node_modules "$dir" || continue
    ! is_excluded "$dir" || continue
    kept="${kept:+$kept:}$dir"
  done
  PATH="${kept:-/var/empty}"
}

# Adds TREES to BASE_TREES when $1 is `base`, or to TARGET_TREES with the
# label $1 for any other non-empty $1.
record_trees() {
  local tree
  [ -n "$1" ] || return 0
  for tree in ${TREES[@]+"${TREES[@]}"}; do
    if [ "$1" = base ]; then
      BASE_TREES+=("$tree")
    else
      TARGET_TREES+=("$tree")
      TARGET_LABELS+=("$1")
    fi
  done
}

# Excludes the trees of directory $1 (relative to START when not absolute),
# with the git top $2 when the caller knows it. $3 is passed to tree_of. A
# target outside every git work tree takes no write, so for a target the
# caller leaves $3 empty. $4 is passed to tree_of and record_trees. A path with `..` after
# a link names one directory for a logical cd and another for a physical cd,
# so the gate excludes the trees of both.
exclude_dir() {
  local dir="$1" back="$PWD" logical="" mode="${3:-}" kind="${4:-}"
  case "$dir" in
    /*) ;;
    *) dir="$START/$dir" ;;
  esac
  if CDPATH='' cd -L -- "$dir" 2>/dev/null; then
    ! CDPATH='' cd -P -- . 2>/dev/null || logical="$PWD"
    if ! CDPATH='' cd -- "$back" 2>/dev/null; then
      echo "fallow plugin gate: cannot return to $back. The command continues without a fallow audit." >&2
      exit 0
    fi
  fi
  tree_of "$dir" "${2:-}" "$mode" "$kind"
  record_trees "$kind"
  filter_path ${TREES[@]+"${TREES[@]}"}
  if [ -n "$logical" ]; then
    tree_of "$logical" "" "$mode" "$kind"
    record_trees "$kind"
    filter_path ${TREES[@]+"${TREES[@]}"}
  fi
}

# Excludes the trees of a location from git_location: the work tree
# directory on line 3, with the work tree top on line 1. The location is a
# command target.
exclude_location() {
  local top gitdir dir
  {
    IFS= read -r top || true
    IFS= read -r gitdir || true
    IFS= read -r dir || true
  } <<<"$1"
  [ -z "$dir" ] || exclude_dir "$dir" "$top" "" "$dir"
}

# The hook input is not parsed yet, so the first tree is the one of the
# process directory.
START="$PWD"
exclude_dir "$PWD" "" self base

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
# A relative cwd is relative to the process directory.
case "$START" in
  '' | /*) ;;
  *) START="$PWD/$START" ;;
esac
[ -n "$START" ] && [ -d "$START" ] || START="$PWD"
# The process directory is already excluded.
[ "$START" = "$PWD" ] || exclude_dir "$START" "" self base
# The git that the gate uses when no command target removes it. The lookup
# runs no program.
BASE_GIT_DIR=""
if BASE_GIT="$(command -v git 2>/dev/null)"; then
  case "$BASE_GIT" in
    /*) BASE_GIT_DIR="${BASE_GIT%/*}" ;;
  esac
fi

# Prints the nearest opted-in directory at or above $1. Without $2 the walk
# stops at the first .git entry. With $2 it stops after directory $2, the top
# of the work tree that git reported. Returns 1 when no directory opts in.
find_root() {
  local dir="$1" stop="${2:-}"
  until opted_in "$dir"; do
    if [ -n "$stop" ]; then
      [ "$dir" != "$stop" ] || return 1
    elif [ -e "$dir/.git" ]; then
      return 1
    fi
    [ "$dir" != / ] || return 1
    dir="$(dirname "$dir")"
  done
  printf '%s' "$dir"
}

if [ "$HAVE_JQ" -eq 0 ]; then
  # Without jq the gate cannot parse the command. Print the notice only in an
  # opted-in project and only for input that can be a git commit or push.
  find_root "$START" >/dev/null || exit 0
  if text_can_write "$INPUT"; then
    echo "fallow plugin gate: jq is not on PATH. The commit or push continues without a fallow audit. Install jq to turn the gate on." >&2
  fi
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

# Every git call of the gate sets safe.bareRepository=explicit, so git uses a
# bare repository only when the command names it.
gate_git() {
  git -c safe.bareRepository=explicit "$@"
}

# Prints the physical path of directory $1. Returns 1 when it is not one.
physical() {
  (CDPATH='' cd -P -- "$1" 2>/dev/null && pwd -P)
}

# Runs git rev-parse in a subshell, from the session directory, after the
# move that git_location describes.
git_rev_parse() (
  local mode="$1"
  shift
  CDPATH='' cd -- "$START" 2>/dev/null || exit 1
  case "$mode" in
    cd-L) CDPATH='' cd -L -- "$1" 2>/dev/null || exit 1 ;;
    cd-P) CDPATH='' cd -P -- "$1" 2>/dev/null || exit 1 ;;
  esac
  if [ "$mode" = -C ]; then
    gate_git "$@" rev-parse --show-toplevel --absolute-git-dir --show-prefix --path-format=absolute --git-common-dir 2>/dev/null
  else
    gate_git rev-parse --show-toplevel --absolute-git-dir --show-prefix --path-format=absolute --git-common-dir 2>/dev/null
  fi
)

# Prints four lines for the repository that git uses when it runs from the
# session directory: the top of the work tree, the absolute git directory, the
# work tree directory where git runs, and the common git directory that linked
# worktrees share with their main worktree. The first argument names how git
# gets there: `-C` followed by git -C arguments, `cd-L <dir>` or `cd-P <dir>`
# for a logical or physical shell cd, or `none`. Returns 1 when git reports no
# work tree.
git_location() {
  local mode="$1" out top gitdir prefix common
  shift
  out="$(git_rev_parse "$mode" "$@")" || return 1
  {
    IFS= read -r top || true
    IFS= read -r gitdir || true
    IFS= read -r prefix || true
    IFS= read -r common || true
  } <<<"$out"
  [ -n "$top" ] && [ -n "$gitdir" ] && [ -n "$common" ] || return 1
  top="$(physical "$top")" || return 1
  gitdir="$(physical "$gitdir")" || return 1
  common="$(physical "$common")" || return 1
  printf '%s\n%s\n%s\n%s\n' "$top" "$gitdir" "$top${prefix:+/${prefix%/}}" "$common"
}

# Loose scan: the original word-splitting detector, in one awk pass so a long
# command costs linear time. It splits each input at control operators and at
# blanks, and ignores quotes. Git-level options between `git` and the
# subcommand (git -c k=v commit, git -C dir push, git --no-pager commit,
# git --git-dir=/x push) still count, while subcommand lookalikes in arguments
# (git log commit-message.txt) do not. See issue #2106. A git word is `git` in
# any letter case, with or without the `.exe` suffix of Git for Windows, as a
# name or as the last part of a path. A file system that ignores letter case
# runs git for `GIT` too. A subcommand with an expansion, a brace or a glob
# (`git c{o,}mmit`, `git co${x}mit`) counts as a write, because the shell can
# make it `commit` or `push`. It sets LOOSE_WRITES to the number of git commit
# and push commands. It adds each directory that a `cd`, -C, --work-tree or
# --git-dir names to TARGETS.
LOOSE_WRITES=0
TARGETS=()
# shellcheck disable=SC2016
LOOSE_SCAN='
function join(base, path) {
  if (path ~ /^\// || base == "") return path
  return base "/" path
}
function is_git(word) {
  word = tolower(word)
  sub(/^.*\//, "", word)
  sub(/\.exe$/, "", word)
  return word == "git"
}
{
  state = "find"; first = 1; dir = ""
  for (i = 1; i <= NF; i++) {
    w = $i
    if (state == "find") {
      if (is_git(w)) { state = "options"; dir = "" }
      else if (w == "cd" && first) state = "cd"
      first = 0
      continue
    }
    if (state == "cd") { print "T " w; state = "find"; continue }
    if (state == "value") { state = "options"; continue }
    if (state == "C") { dir = join(dir, w); state = "options"; continue }
    if (state == "tree") { sub(/\/\.git$/, "", w); print "T " join(dir, w); state = "options"; continue }
    if (w == "commit" || w == "push" || w ~ /[$`{?*\[]/) {
      writes++
      if (dir != "") print "T " dir
      state = "find"
      continue
    }
    if (w == "-C") { state = "C"; continue }
    if (w == "--work-tree" || w == "--git-dir") { state = "tree"; continue }
    if (w ~ /^--(work-tree|git-dir)=/) {
      sub(/^[^=]*=/, "", w); sub(/\/\.git$/, "", w); print "T " join(dir, w)
      continue
    }
    if (w == "-c" || w == "--namespace" || w == "--config-env" || w == "--super-prefix" || w == "--exec-path" || w == "--list-cmds" || w == "--attr-source") {
      state = "value"
      continue
    }
    if (w ~ /^-/) continue
    # A different subcommand; this word can still start a later git.
    state = "find"
    if (is_git(w)) { state = "options"; dir = "" }
  }
}
END { print "W " (writes + 0) }
'
scan_loose() {
  local out line result=0
  # A missing or failing awk must not hide a write. Without the result line,
  # the gate counts the command as a write.
  if out="$(printf '%s\n' "$@" | tr ';|&()' '\n\n\n\n\n' | LC_ALL=C awk "$LOOSE_SCAN" 2>/dev/null)"; then
    while IFS= read -r line; do
      case "$line" in
        "W "*)
          LOOSE_WRITES="${line#W }"
          result=1
          ;;
        "T "*) TARGETS+=("${line#T }") ;;
      esac
    done <<<"$out"
  fi
  case "$LOOSE_WRITES" in
    '' | *[!0-9]*) result=0 ;;
  esac
  if [ "$result" -eq 0 ]; then
    LOOSE_WRITES=1
  fi
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
# -u. A push also accepts --set-upstream, --force-with-lease and
# --force-if-includes, as exact words. ALLOWED_ARGS holds the <args>.
# The word after -m or --message can be a quoted message ('...', or "..."
# without $, ` or \). Anything else does not match: another operator, a
# newline outside the message, a substitution, a variable, a glob, a tilde,
# git -c, an option such as -F, --template, --exec or --receive-pack, `--`,
# or an environment prefix. The caller also requires that the target is a
# directory inside a git work tree.
ALLOWED_DIR=""
ALLOWED_MODE=""
ALLOWED_SUBCOMMAND=""
ALLOWED_DIRS=()
ALLOWED_ARGS=()
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
    ALLOWED_MODE="cd"
    ALLOWED_DIRS=("$word")
    take '^&&' || return 1
  fi
  take '^git([ 	]|$)' || return 1
  if [ -z "$dir" ]; then
    ALLOWED_MODE=-C
    while take '^-C[ 	]'; do
      take "$DIR_RE" || return 1
      unquote
      dir="$(join_path "$dir" "$word")"
      ALLOWED_DIRS+=(-C "$word")
    done
  fi
  take '^(commit|push)([ 	]|$)' || return 1
  ALLOWED_SUBCOMMAND="${word%%[ 	]*}"
  while :; do
    [[ "$rest" =~ $BLANK_RE ]] && rest="${rest:${#BASH_REMATCH[0]}}"
    [ -n "$rest" ] || break
    case "$prev" in
      -m | --message)
        take "$MSG_RE" || take "$WORD_RE" || return 1
        ALLOWED_ARGS+=("$word")
        # The message is a value, so the next word is an option again.
        word=""
        ;;
      *)
        take "$WORD_RE" || return 1
        case "$word" in
          -m | --message | -S | -q | -a | --amend | --no-edit | -u) ;;
          --set-upstream | --force-with-lease | --force-if-includes)
            [ "$ALLOWED_SUBCOMMAND" = push ] || return 1
            ;;
          -*) return 1 ;;
        esac
        ALLOWED_ARGS+=("$word")
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

# Longest command, in characters, that the allowlist reads.
ALLOWLIST_MAX=16384

# Sets HOME_FORM to the path that target $1 names when the shell expands its
# last ~, $HOME or ${HOME} component to HOME, or to the empty string when $1
# has no such component or HOME is not set. The loose scan joins a -C word to
# the path of an earlier -C, so the component can follow other components.
home_form() {
  local head="$1" tail="" part
  HOME_FORM=""
  [ -n "${HOME:-}" ] || return 0
  while :; do
    part="${head##*/}"
    # shellcheck disable=SC2016
    case "$part" in
      \~ | '$HOME' | '${HOME}')
        HOME_FORM="${HOME%/}$tail"
        HOME_FORM="${HOME_FORM:-/}"
        return 0
        ;;
    esac
    [ "$head" != "$part" ] || return 0
    tail="/$part$tail"
    head="${head%/*}"
  done
}

# Quotes, backslashes, substitutions and line continuations can hide a git
# word (g\it, "com"mit, git -C "$(pwd)" commit). The floor also counts a copy
# of the command without these characters and with its lines joined. QUOTELESS
# drops only the quotes and backslashes and joins the lines. The two copies
# follow the rule of text_can_write, with tr in place of the slow removal of
# bash 3.2 on a long command.
QUOTELESS="$(printf '%s' "$CMD" | tr -d '\\"'"'"'' | tr '\n' ' ')"
# shellcheck disable=SC2016
FLAT="$(printf '%s' "$QUOTELESS" | tr -d '$()`{}')"
CAN_WRITE=0
shopt -s nocasematch
case "$FLAT" in
  *commit* | *push* | *git*[\?\*\[]*) CAN_WRITE=1 ;;
  *)
    case "$QUOTELESS" in
      *git*[\$\{\`\?\*\[]*) CAN_WRITE=1 ;;
    esac
    ;;
esac
shopt -u nocasematch
set -f
case "$CAN_WRITE" in
  1)
    # The allowlist match uses only builtins, so the gate excludes its target
    # before the loose scan starts awk.
    if [ "${#CMD}" -le "$ALLOWLIST_MAX" ]; then
      match_allowlist "$CMD" || ALLOWED_DIR=""
    fi
    [ -z "$ALLOWED_DIR" ] || exclude_dir "$ALLOWED_DIR" "" "" "$ALLOWED_DIR"
    if [ "$FLAT" = "$CMD" ]; then
      scan_loose "$CMD"
    else
      scan_loose "$CMD" "$FLAT"
    fi
    # A program name or a word with an expansion, a brace, a glob or a
    # backquote (`$G commit`, `g?t push`) can run git, so a command with such a
    # word and a `commit` or `push` word counts as a write. The trusted fallow
    # then audits the session.
    case "$CMD" in
      *[\$\{\`\?\*\[]*)
        shopt -s nocasematch
        case "$FLAT" in
          *commit* | *push*) [ "$LOOSE_WRITES" -gt 0 ] || LOOSE_WRITES=1 ;;
        esac
        shopt -u nocasematch
        ;;
    esac
    # The gate excludes each target before its first git call. The later
    # target loop reads the unquoted words.
    if [ "${#TARGETS[@]}" -gt 0 ]; then
      for i in "${!TARGETS[@]}"; do
        target="${TARGETS[$i]}"
        case "$target" in
          \'*\' | \"*\") target="${target:1:${#target}-2}" ;;
        esac
        TARGETS[i]="$target"
        exclude_dir "$target" "" "" "$target"
        # The gate keeps the literal target and adds the HOME form, because
        # the shell expands ~ in some words and not in others.
        home_form "$target"
        if [ -n "$HOME_FORM" ]; then
          TARGETS+=("$HOME_FORM")
          exclude_dir "$HOME_FORM" "" "" "$HOME_FORM"
        fi
      done
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

# Returns 0 when the EXCLUDED entry $1 excludes path $2.
tree_holds() {
  local -a EXCLUDED
  EXCLUDED=("$1")
  is_excluded "$2"
}

# Sets HOLDER to the label of the first target tree that holds directory $1.
# Returns 1 when no target tree holds it.
target_holding() {
  local i
  HOLDER=""
  [ "${#TARGET_TREES[@]}" -gt 0 ] || return 1
  for i in "${!TARGET_TREES[@]}"; do
    if tree_holds "${TARGET_TREES[$i]}" "$1"; then
      HOLDER="${TARGET_LABELS[$i]}"
      return 0
    fi
  done
  return 1
}

# Blocks the command when the target trees removed the only git from PATH
# and the session or that target opts in. Without git the gate cannot find
# the trees to audit. When no tree opts in, the gate has nothing to audit.
require_git() {
  local dir
  ! command -v git >/dev/null 2>&1 || return 0
  [ -n "$BASE_GIT_DIR" ] && target_holding "$BASE_GIT_DIR" || return 0
  dir="$(join_path "$START" "$HOLDER")"
  find_root "$START" >/dev/null || find_root "$dir" >/dev/null || return 0
  {
    echo "fallow plugin gate: blocked: the only git on PATH is in $BASE_GIT_DIR, inside the tree of the command target $HOLDER."
    echo "fallow plugin gate: the gate does not run a program from a tree that the command writes to, so it cannot audit this commit or push."
    echo "fallow plugin gate: install git outside that tree, or set FALLOW_PLUGIN_GATE=off to turn the gate off."
  } >&2
  exit 2
}
require_git

# Git decides where a write lands. The gate asks git for the work tree top and
# the git directory of each target, and of the session directory. The session
# audit is skipped only for an allowlisted command whose target differs from
# the session in both top and git directory. Linked worktrees share their
# refs: a push from another worktree of the same repository can push the
# session branch. So a push with the same common git directory also audits
# the session, unless push_spares_session proves that the push cannot send
# the session branch. If git cannot answer, or the session package lies
# inside the target work tree, the session is audited.
# Each start is "<directory>|<work tree top>". An empty top means the walk
# stops at the first .git entry, as for the session.
STARTS=()
SESSION_TOP=""
SESSION_GITDIR=""
SESSION_COMMON=""
if session_location="$(git_location none)"; then
  {
    IFS= read -r SESSION_TOP || true
    IFS= read -r SESSION_GITDIR || true
    IFS= read -r _ || true
    IFS= read -r SESSION_COMMON || true
  } <<<"$session_location"
fi
# The session tree is the union of the work tree top of the session
# directory and the nearest directory with a .git entry.
exclude_dir "$START" "$SESSION_TOP" self base
SESSION_ROOT="$(find_root "$START" || true)"
SESSION_ROOT_PHYSICAL=""
[ -z "$SESSION_ROOT" ] || SESSION_ROOT_PHYSICAL="$(physical "$SESSION_ROOT" || true)"

# Returns 0 only when the allowlisted push in ALLOWED_ARGS, run in the linked
# worktree $1, cannot send the branch of the session. All of these must hold:
# - The options are only -u, -q, --set-upstream, --force-with-lease and
#   --force-if-includes.
# - The words after the options are [<repository>] [<refspec>...]. The source
#   of each refspec (without a leading + and before the first :) is not empty.
#   For each source, git rev-parse --symbolic-full-name in $1 gives the same
#   ref as for HEAD in $1, and that ref is not the session branch. A commit
#   name, `feat~0` or `@{-1}` gives no ref, so it fails.
# - A push without a refspec needs push.default (read in $1) unset or one of
#   simple, current, upstream and nothing, and no remote with a push or mirror
#   setting.
# Every other result and every git error return 1. The function runs in a
# subshell, so an error under set -u also returns 1 and the session is
# audited.
push_spares_session() (
  local target="$1" word src ref head session_ref push_default rc
  local positionals=0 refspecs=0
  if ! head="$(gate_git -C "$target" rev-parse --symbolic-full-name HEAD 2>/dev/null)"; then
    return 1
  fi
  [ -n "$head" ] || return 1
  # Exit 1 means a detached HEAD: no session branch, so no ref can match it.
  if session_ref="$(gate_git -C "$START" symbolic-ref -q HEAD 2>/dev/null)"; then
    :
  else
    rc=$?
    [ "$rc" -eq 1 ] || return 1
    session_ref=""
  fi
  [ "$head" != "$session_ref" ] || return 1
  for word in ${ALLOWED_ARGS[@]+"${ALLOWED_ARGS[@]}"}; do
    case "$word" in
      -u | -q | --set-upstream | --force-with-lease | --force-if-includes) continue ;;
      -*) return 1 ;;
    esac
    positionals=$((positionals + 1))
    # The first word is the repository.
    [ "$positionals" -gt 1 ] || continue
    refspecs=$((refspecs + 1))
    src="${word#+}"
    src="${src%%:*}"
    case "$src" in
      '' | -*) return 1 ;;
    esac
    if ! ref="$(gate_git -C "$target" rev-parse --symbolic-full-name "$src" 2>/dev/null)"; then
      return 1
    fi
    [ -n "$ref" ] && [ "$ref" = "$head" ] && [ "$ref" != "$session_ref" ] || return 1
  done
  if [ "$refspecs" -eq 0 ]; then
    # Exit 1 means that push.default is not set.
    if push_default="$(gate_git -C "$target" config --get push.default 2>/dev/null)"; then
      :
    else
      rc=$?
      [ "$rc" -eq 1 ] || return 1
      push_default=""
    fi
    case "$push_default" in
      '' | simple | current | upstream | nothing) ;;
      *) return 1 ;;
    esac
    # Exit 1 means that no remote has a push or mirror setting.
    if gate_git -C "$target" config --get-regexp '^remote\..*\.(push|mirror)$' >/dev/null 2>&1; then
      return 1
    else
      rc=$?
      [ "$rc" -eq 1 ] || return 1
    fi
  fi
  return 0
)

# Adds the location in $1 (from git_location) to STARTS. Returns 1 when the
# location shares the top or the git directory with the session, or holds the
# session package. It also returns 1 for a location that shares the common
# git directory with the session, except for a commit ($2 commit) and for a
# push ($2 push) that push_spares_session accepts.
add_target() {
  local top gitdir dir common
  {
    IFS= read -r top || true
    IFS= read -r gitdir || true
    IFS= read -r dir || true
    IFS= read -r common || true
  } <<<"$1"
  STARTS+=("$dir|$top")
  [ -n "$SESSION_TOP" ] || return 1
  [ "$top" != "$SESSION_TOP" ] && [ "$gitdir" != "$SESSION_GITDIR" ] || return 1
  if [ "${2:-}" != commit ] && [ "$common" = "$SESSION_COMMON" ]; then
    [ "${2:-}" = push ] || return 1
    push_spares_session "$dir" || return 1
  fi
  case "$SESSION_ROOT_PHYSICAL/" in
    "$top"/*) return 1 ;;
  esac
}

# The session audit stays on until every check for the target passes.
AUDIT_SESSION=1
if [ -n "$ALLOWED_DIR" ]; then
  target_alone=1
  if [ "$ALLOWED_MODE" = cd ]; then
    for mode in cd-L cd-P; do
      if location="$(git_location "$mode" "${ALLOWED_DIRS[0]}")"; then
        exclude_location "$location"
        add_target "$location" "$ALLOWED_SUBCOMMAND" || target_alone=0
      else
        target_alone=0
      fi
    done
  elif location="$(git_location -C ${ALLOWED_DIRS[@]+"${ALLOWED_DIRS[@]}"})"; then
    exclude_location "$location"
    add_target "$location" "$ALLOWED_SUBCOMMAND" || target_alone=0
  else
    target_alone=0
  fi
  if [ "$target_alone" -eq 1 ]; then
    AUDIT_SESSION=0
  fi
fi
if [ "$AUDIT_SESSION" -eq 1 ]; then
  STARTS+=("$START|")
  if [ "${#TARGETS[@]}" -gt 0 ]; then
    for target in "${TARGETS[@]}"; do
      if location="$(git_location cd-P "$target")"; then
        exclude_location "$location"
        add_target "$location" || true
      fi
    done
  fi
fi
# The work tree tops of the targets can add trees that hold the git.
require_git

# ROOTS holds the physical path of each opted-in directory to audit, once.
ROOTS=()
for start in ${STARTS[@]+"${STARTS[@]}"}; do
  root="$(find_root "${start%%|*}" "${start#*|}")" || continue
  root="$(physical "$root")" || continue
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
covered_by_installed_gate() {
  local root="$1" pair settings script
  [ -n "$SESSION_ROOT_PHYSICAL" ] && [ "$root" = "$SESSION_ROOT_PHYSICAL" ] || return 1
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

# Sets RESOLVED_FILE to the physical path of file $1, after every link.
# Returns 1 after 40 links or when a link cannot be read.
resolve_file() {
  local file="$1" link hops=0
  while [ -L "$file" ]; do
    hops=$((hops + 1))
    [ "$hops" -le 40 ] || return 1
    link="$(readlink -- "$file" 2>/dev/null)" || return 1
    case "$link" in
      /*) file="$link" ;;
      *) file="${file%/*}/$link" ;;
    esac
  done
  resolve_dir "${file%/*}" || return 1
  RESOLVED_FILE="${RESOLVED%/}/${file##*/}"
}

# Returns 0 when directory $1 is a known version-manager shim directory, in
# any letter case: a directory named shims (this covers mise, asdf and any
# data directory of them), .volta/bin, volta/bin (the Windows form), or one of
# VOLTA_HOME/bin, ASDF_DATA_DIR/shims and MISE_DATA_DIR/shims when the
# variable is set, before or after links. A shim can run the fallow that the
# project installs. RESOLVED of the caller does not change.
is_shim_dir() {
  local dir="${1%/}" shim=1 base sub saved="$RESOLVED"
  shopt -s nocasematch
  case "$dir" in
    */shims | */.volta/bin | */volta/bin) shim=0 ;;
  esac
  for base in "VOLTA_HOME|bin" "ASDF_DATA_DIR|shims" "MISE_DATA_DIR|shims"; do
    [ "$shim" -eq 1 ] || break
    sub="${base#*|}"
    base="${base%%|*}"
    base="${!base:-}"
    [ -n "$base" ] || continue
    base="${base%/}/$sub"
    case "$dir" in
      "$base") shim=0 ;;
    esac
    if [ "$shim" -eq 1 ] && resolve_dir "$base"; then
      case "$dir" in
        "$RESOLVED") shim=0 ;;
      esac
    fi
  done
  shopt -u nocasematch
  RESOLVED="$saved"
  return "$shim"
}

# Returns 0 when file name $1 is volta-shim, in any letter case.
is_shim_name() {
  local shim=1
  shopt -s nocasematch
  case "$1" in
    volta-shim | volta-shim.exe) shim=0 ;;
  esac
  shopt -u nocasematch
  return "$shim"
}

# Sets TRUSTED_FALLOW to the physical path of the first trusted fallow on
# PATH, and TRUSTED_NAME to its path on PATH. The PATH entry passes the PATH
# rules. The directory of the physical path of the program is not excluded. It
# can be inside a node_modules directory, because a global npm install links
# into lib/node_modules. The gate skips a version-manager shim: an entry, or
# the directory of the physical path of the program, that is_shim_dir
# accepts, or a program whose physical name is volta-shim. SKIPPED_SHIM is 1
# when the gate skipped such a shim. Returns 1 when no entry holds a trusted
# fallow.
find_trusted_fallow() {
  local entry dir
  local -a entries
  TRUSTED_FALLOW=""
  TRUSTED_NAME=""
  SKIPPED_SHIM=0
  IFS=: read -r -a entries <<<"$PATH"
  for entry in ${entries[@]+"${entries[@]}"}; do
    case "$entry" in
      /*) ;;
      *) continue ;;
    esac
    ! has_node_modules "$entry" || continue
    resolve_dir "$entry" || continue
    dir="$RESOLVED"
    ! has_node_modules "$dir" || continue
    [ -f "$dir/fallow" ] && [ -x "$dir/fallow" ] || continue
    resolve_file "$dir/fallow" || continue
    ! is_excluded "$dir" || continue
    ! is_excluded "${RESOLVED_FILE%/*}" || continue
    if is_shim_dir "$entry" || is_shim_dir "$dir" || is_shim_dir "${RESOLVED_FILE%/*}" || is_shim_name "${RESOLVED_FILE##*/}"; then
      SKIPPED_SHIM=1
      continue
    fi
    TRUSTED_FALLOW="$RESOLVED_FILE"
    TRUSTED_NAME="${dir%/}/fallow"
    return 0
  done
  return 1
}

# Runs find_trusted_fallow on the entries of ORIG_PATH, with only the trees in
# the arguments excluded. PATH and EXCLUDED of the caller do not change.
find_fallow_without() {
  local saved="$PATH" missing=0
  local -a EXCLUDED
  EXCLUDED=()
  PATH="$ORIG_PATH"
  filter_path ${1+"$@"}
  find_trusted_fallow || missing=1
  PATH="$saved"
  return "$missing"
}

# Runs the trusted fallow. The program gets its PATH name as argv[0], so a
# program that reads argv[0] still sees the fallow command.
run_fallow() {
  (exec -a "$TRUSTED_NAME" "$TRUSTED_FALLOW" "$@")
}

# Audits the current directory. Returns 2 when fallow audit returns verdict
# fail, else 0.
audit_here() {
  local runner_desc version_raw version min_version lower status verdict is_error msg err_line
  # The audit runs only the fallow that find_trusted_fallow finds. It never
  # runs a project-local launcher, yarn or npx.
  if ! find_trusted_fallow; then
    {
      echo "fallow plugin gate: the fallow binary is not installed (tried each absolute PATH entry outside node_modules, outside the session tree and outside a version-manager shim directory)."
      [ "$SKIPPED_SHIM" -eq 0 ] || echo "fallow plugin gate: a fallow in a version-manager shim directory is not used, because a shim can run the fallow that the project installs."
      echo "fallow plugin gate: the commit or push continues without a fallow audit."
      echo "fallow plugin gate: install fallow globally outside a version manager (npm install -g fallow or cargo install fallow-cli) to turn the gate on, or set FALLOW_PLUGIN_GATE=off to hide this notice."
    } >&2
    return 0
  fi
  runner_desc="$TRUSTED_FALLOW"

  version_raw="$(run_fallow --version 2>/dev/null || true)"
  version="${version_raw#fallow }"
  version="${version%% *}"

  min_version="${FALLOW_GATE_MIN_VERSION-2.85.0}"
  if [ -n "$min_version" ] && [ -n "$version" ]; then
    lower="$(printf '%s\n%s\n' "$min_version" "$version" | sort -V | head -n1)"
    if [ "$lower" != "$min_version" ]; then
      {
        echo "fallow plugin gate: $runner_desc is fallow $version, below the required $min_version."
        echo "fallow plugin gate: the commit or push continues without a fallow audit."
        echo "fallow plugin gate: upgrade fallow (npm install -g fallow@latest or cargo install fallow-cli) to turn the gate on."
      } >&2
      return 0
    fi
  fi

  if run_fallow audit --format json --quiet --explain --gate-marker agent >"$TMP_JSON" 2>"$TMP_ERR"; then
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

# The gate excludes the trees of every audit root before the first audit, so
# no tool from the tree of one root runs while the gate audits another root.
# AUDITS holds the roots that no installed gate covers.
AUDITS=()
for root in "${ROOTS[@]}"; do
  exclude_dir "$root" "" self "$root"
  # git already gave the work tree top of the session directory.
  if [ -n "$SESSION_TOP" ] && [ "$root" = "$SESSION_ROOT_PHYSICAL" ]; then
    root_top="$SESSION_TOP"
  else
    root_top="$(cd "$root" && gate_git rev-parse --show-toplevel 2>/dev/null)" || root_top=""
  fi
  exclude_dir "$root" "$root_top" self "$root"
  covered_by_installed_gate "$root" || AUDITS+=("$root")
done
[ "${#AUDITS[@]}" -gt 0 ] || exit 0
require_git

# The trusted fallow with only the base trees excluded. When the trees of the
# targets and the audit roots remove it, the gate blocks before any audit.
if ! find_trusted_fallow && find_fallow_without ${BASE_TREES[@]+"${BASE_TREES[@]}"}; then
  target_holding "${TRUSTED_NAME%/*}" || target_holding "${TRUSTED_FALLOW%/*}" || HOLDER="${AUDITS[0]}"
  {
    echo "fallow plugin gate: blocked: the only trusted fallow on PATH is $TRUSTED_NAME, inside the tree of the command target $HOLDER."
    echo "fallow plugin gate: the gate does not run a program from a tree that the command writes to, so it cannot audit this commit or push."
    echo "fallow plugin gate: install fallow globally outside that tree (npm install -g fallow or cargo install fallow-cli), or set FALLOW_PLUGIN_GATE=off to turn the gate off."
  } >&2
  exit 2
fi

for root in "${AUDITS[@]}"; do
  if [ -n "${FALLOW_GATE_DEBUG:-}" ]; then
    echo "fallow plugin gate: auditing $root." >&2
  fi
  cd "$root"
  if ! audit_here; then
    exit 2
  fi
done
exit 0
