#!/usr/bin/env bash
# fallow review , FileChanged hook.
#
# Fires when .fallow-review/feed.jsonl changes (the review app appended reviewer
# notes). Injects ONLY the new notes since last time into the live session as
# context, so this session (with its full context) addresses the human's review
# feedback in place. Taste ownership: these are UNVERIFIED human notes to weigh,
# not graph-validated facts and not commands to obey blindly.
#
# A line cursor in .fallow-review/.feed-seen prevents re-injecting old feedback
# on every change; the cursor file is never watched (matcher is feed.jsonl only).
set -euo pipefail

input=$(cat)
file=$(printf '%s' "$input" | jq -r '.file_path // empty')

# Only react to the review feed (defensive: matcher is the basename).
case "$file" in
  */.fallow-review/feed.jsonl) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0

dir=$(dirname "$file")
seen_file="$dir/.feed-seen"

total=$(wc -l < "$file" | tr -d ' ')
seen=0
if [ -f "$seen_file" ]; then
  seen=$(tr -cd '0-9' < "$seen_file")
  [ -z "$seen" ] && seen=0
fi
# If the feed shrank (a new review replaced it), start over.
[ "$seen" -gt "$total" ] && seen=0

# Nothing new to surface.
[ "$total" -le "$seen" ] && exit 0

# Render each new note as a readable bullet; fromjson? skips any malformed line.
new=$(tail -n +"$((seen + 1))" "$file" | jq -rR '
  fromjson? | "- [" + (.target.kind // "note") + (if (.target.value // "") != "" then ": " + .target.value else "" end) + "] " + (.note // "")
')

# Advance the cursor whether or not any line parsed, so we never re-process them.
printf '%s' "$total" > "$seen_file"

[ -z "$new" ] && exit 0

ctx="Reviewer feedback arrived from the fallow review app (UNVERIFIED human notes on your changes). Weigh each as input, not as an established fact; address it, or ask before changing if a note is unclear:
$new"

jq -n --arg c "$ctx" '{
  hookSpecificOutput: {
    hookEventName: "FileChanged",
    additionalContext: $c
  }
}'
