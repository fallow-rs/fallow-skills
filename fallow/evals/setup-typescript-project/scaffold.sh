#!/usr/bin/env bash
set -euo pipefail

# Copy the TypeScript fixture into the empty run workspace and commit it, so
# the setup run starts from a clean git tree.
case_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fixture="$case_dir/../fixtures/ts-app"

if [ ! -f "$fixture/package.json" ]; then
  echo "scaffold: fixture not found at $fixture" >&2
  exit 1
fi

cp -R "$fixture"/. .
git init --quiet --initial-branch=main
git add -A
git -c user.name=eval -c user.email=eval@example.invalid -c commit.gpgsign=false \
  commit --quiet -m "chore: initial fixture"
