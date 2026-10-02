#!/usr/bin/env bash
set -euo pipefail

# Build a repository with a feature branch, so "this PR" names a real diff:
# main holds the TypeScript fixture, and feat/discount adds a module and
# changes the entry point.
case_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fixture="$case_dir/../fixtures/ts-app"

if [ ! -f "$fixture/package.json" ]; then
  echo "scaffold: fixture not found at $fixture" >&2
  exit 1
fi

commit() {
  git -c user.name=eval -c user.email=eval@example.invalid -c commit.gpgsign=false \
    commit --quiet -m "$1"
}

cp -R "$fixture"/. .
git init --quiet --initial-branch=main
git add -A
commit "chore: initial fixture"

git checkout --quiet -b feat/discount
cat > src/discount.ts <<'TS'
import { sum } from './math.js';

export const applyDiscount = (values: readonly number[], percent: number): number =>
  sum(values) * (1 - percent / 100);

export const discountLabel = (percent: number): string => `${percent}% off`;
TS
cat > src/index.ts <<'TS'
import { applyDiscount } from './discount.js';
import { formatTotal } from './format.js';

export const run = (values: readonly number[]): string => formatTotal(applyDiscount(values, 10));
TS
git add -A
commit "feat: apply a discount to the total"
