#!/usr/bin/env bash
# fallow review , SessionStart hook.
#
# Declares a watchPath on the review app's feedback feed so that reviewer notes
# (written by the fallow review app to .fallow-review/feed.jsonl) are injected
# into THIS live coding session, by the paired FileChanged hook. The session that
# did the work reuses its own context to act on the feedback; nothing spawns a
# fresh agent. watchPaths must be absolute, so it is built from the hook's cwd.
set -euo pipefail

input=$(cat)
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
[ -z "$cwd" ] && cwd="$PWD"

dir="$cwd/.fallow-review"
feed="$dir/feed.jsonl"

# If a review is already in progress (the scratch dir exists) but the feed file
# has not been created yet, create it so the watch arms reliably. Never create
# the scratch dir itself, so repos not under review stay untouched.
if [ -d "$dir" ] && [ ! -f "$feed" ]; then
  : > "$feed"
fi

jq -n --arg p "$feed" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    watchPaths: [$p],
    additionalContext: "fallow review: watching .fallow-review/feed.jsonl. Reviewer feedback from the review app will arrive in this session as it is written."
  }
}'
