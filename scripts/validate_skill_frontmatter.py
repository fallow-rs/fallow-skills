#!/usr/bin/env python3
"""Validate the YAML frontmatter of every SKILL.md under a root directory.

Parsing the frontmatter with a real YAML loader (instead of grepping for
`name:` and `description:`) is what catches malformed scalars, such as an
unquoted plain scalar containing a `": "` sequence, which YAML reads as a
mapping indicator and which some skill harnesses reject at load time.
"""

from __future__ import annotations

import pathlib
import re
import sys

import yaml

FRONTMATTER = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n", re.DOTALL)
SKILL_NAME = re.compile(r"^[a-z][a-z0-9-]*$")
SKIPPED_DIRS = {"node_modules", ".git"}


def frontmatter_errors(path: pathlib.Path) -> list[str]:
    text = path.read_text(encoding="utf-8")

    match = FRONTMATTER.match(text)
    if match is None:
        return [f"{path}: missing frontmatter"]

    try:
        data = yaml.safe_load(match.group(1))
    except yaml.YAMLError as error:
        detail = str(error).replace("\n", " ")
        return [f"{path}: frontmatter is not valid YAML: {detail}"]

    if not isinstance(data, dict):
        return [f"{path}: frontmatter must be a YAML mapping"]

    errors = []
    for field in ("name", "description"):
        value = data.get(field)
        if value is None:
            errors.append(f"{path}: missing '{field}' in frontmatter")
        elif not isinstance(value, str) or not value.strip():
            errors.append(f"{path}: '{field}' must be a non-empty string")

    name = data.get("name")
    if isinstance(name, str):
        directory = path.parent.name
        if name != directory:
            errors.append(f"{path}: name '{name}' does not match directory '{directory}'")
        if not SKILL_NAME.match(name):
            errors.append(
                f"{path}: name '{name}' must be lowercase letters, numbers, and hyphens"
            )

    return errors


def skill_files(root: pathlib.Path) -> list[pathlib.Path]:
    return sorted(
        path
        for path in root.rglob("SKILL.md")
        if SKIPPED_DIRS.isdisjoint(path.parts)
    )


def main() -> int:
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    print("Validating SKILL.md files...")

    errors = []
    for path in skill_files(root):
        print(f"  Checking {path}")
        errors.extend(frontmatter_errors(path))

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print("All SKILL.md files are valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
