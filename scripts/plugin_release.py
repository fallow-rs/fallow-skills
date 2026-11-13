#!/usr/bin/env python3
"""Version and package the public Fallow plugin releases."""

from __future__ import annotations

import argparse
import json
import re
import stat
import tempfile
import unicodedata
from pathlib import Path, PurePosixPath
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ARCHIVE_LIMIT = 100_000_000
ENTRY_LIMIT = 100 * 1024 * 1024
ENTRY_COUNT_LIMIT = 5_000
EXTRACTED_LIMIT = 512 * 1024 * 1024
FIXED_ZIP_TIME = (1980, 1, 1, 0, 0, 0)
PLUGIN_ROOT = Path("fallow")
REPO_ROOT = Path(__file__).resolve().parents[1]
SEMVER = re.compile(
    r"^(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)"
    r"(?:-(?P<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+(?P<build>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)
VERSION_FILES = (
    Path(".claude-plugin/marketplace.json"),
    Path("fallow/.claude-plugin/plugin.json"),
    Path("fallow/.codex-plugin/plugin.json"),
    Path("fallow/.cursor-plugin/plugin.json"),
)
UNSUPPORTED_FILES = {".app.json", ".mcp.json"}


class ReleaseError(ValueError):
    """Raised when release input cannot produce a valid public plugin."""


def _load_json(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ReleaseError(f"Cannot read valid JSON from {path}: {error}") from error
    if not isinstance(value, dict):
        raise ReleaseError(f"Expected a JSON object in {path}")
    return value


def _parse_version(version: object) -> tuple[tuple[int, int, int], tuple[str, ...] | None]:
    if not isinstance(version, str):
        raise ReleaseError(f"Invalid semantic version: {version!r}")
    match = SEMVER.fullmatch(version)
    if match is None:
        raise ReleaseError(f"Invalid semantic version: {version!r}")
    prerelease_value = match.group("prerelease")
    prerelease = tuple(prerelease_value.split(".")) if prerelease_value else None
    if prerelease and any(
        identifier.isdigit() and len(identifier) > 1 and identifier.startswith("0")
        for identifier in prerelease
    ):
        raise ReleaseError(f"Invalid semantic version: {version!r}")
    core = tuple(int(match.group(field)) for field in ("major", "minor", "patch"))
    return core, prerelease


def _validate_version(version: object) -> str:
    _parse_version(version)
    return version


def compare_versions(left: str, right: str) -> int:
    """Compare SemVer precedence, ignoring build metadata."""
    left_core, left_prerelease = _parse_version(left)
    right_core, right_prerelease = _parse_version(right)
    if left_core != right_core:
        return 1 if left_core > right_core else -1
    if left_prerelease is None or right_prerelease is None:
        if left_prerelease == right_prerelease:
            return 0
        return 1 if left_prerelease is None else -1

    for left_identifier, right_identifier in zip(left_prerelease, right_prerelease):
        if left_identifier == right_identifier:
            continue
        left_numeric = left_identifier.isdigit()
        right_numeric = right_identifier.isdigit()
        if left_numeric and right_numeric:
            return 1 if int(left_identifier) > int(right_identifier) else -1
        if left_numeric != right_numeric:
            return -1 if left_numeric else 1
        return 1 if left_identifier > right_identifier else -1
    if len(left_prerelease) == len(right_prerelease):
        return 0
    return 1 if len(left_prerelease) > len(right_prerelease) else -1


def is_prerelease(version: str) -> bool:
    """Return whether a valid semantic version has prerelease identifiers."""
    _, prerelease = _parse_version(version)
    return prerelease is not None


def _manifest_versions(repo_root: Path) -> tuple[str, ...]:
    marketplace = _load_json(repo_root / VERSION_FILES[0])
    metadata = marketplace.get("metadata")
    plugins = marketplace.get("plugins")
    if not isinstance(metadata, dict) or not isinstance(plugins, list) or len(plugins) != 1:
        raise ReleaseError("Claude marketplace must contain metadata and exactly one plugin")
    plugin_entry = plugins[0]
    if not isinstance(plugin_entry, dict) or plugin_entry.get("name") != "fallow":
        raise ReleaseError("Claude marketplace must contain the Fallow plugin")

    claude = _load_json(repo_root / VERSION_FILES[1])
    codex = _load_json(repo_root / VERSION_FILES[2])
    cursor = _load_json(repo_root / VERSION_FILES[3])
    if any(manifest.get("name") != "fallow" for manifest in (claude, codex, cursor)):
        raise ReleaseError("Plugin manifests must keep the stable name 'fallow'")

    return tuple(
        _validate_version(version)
        for version in (
            metadata.get("version"),
            plugin_entry.get("version"),
            claude.get("version"),
            codex.get("version"),
            cursor.get("version"),
        )
    )


def check_versions(repo_root: Path, expected_version: str | None = None) -> str:
    """Return the synchronized plugin version or raise on drift."""
    versions = _manifest_versions(repo_root)
    if len(set(versions)) != 1:
        raise ReleaseError(f"Plugin versions are not synchronized: {versions}")
    version = versions[0]
    if expected_version is not None and version != _validate_version(expected_version):
        raise ReleaseError(f"Expected plugin version {expected_version}, found {version}")
    return version


def check_newer_version(repo_root: Path, base_version: str) -> str:
    """Return the synchronized version when it has higher SemVer precedence."""
    version = check_versions(repo_root)
    if compare_versions(version, base_version) <= 0:
        raise ReleaseError(
            f"Plugin version {version} must have higher precedence than {base_version}"
        )
    return version


def _replace_file(source: Path, destination: Path) -> None:
    source.replace(destination)


def set_version(repo_root: Path, version: str) -> None:
    """Update synchronized versions, preserving formatting and rolling back on failure."""
    version = _validate_version(version)
    old_version = check_versions(repo_root)
    replacements: dict[Path, str] = {}

    for relative_path in VERSION_FILES:
        path = repo_root / relative_path
        text = path.read_text(encoding="utf-8")
        updated, count = re.subn(
            rf'("version"\s*:\s*)"{re.escape(old_version)}"',
            rf'\1"{version}"',
            text,
        )
        expected_count = 2 if relative_path == VERSION_FILES[0] else 1
        if count != expected_count:
            raise ReleaseError(
                f"Expected {expected_count} version field(s) in {relative_path}, found {count}"
            )
        json.loads(updated)
        replacements[path] = updated

    staged: list[tuple[Path, Path]] = []
    backups: list[tuple[Path, Path]] = []
    try:
        for path, contents in replacements.items():
            mode = stat.S_IMODE(path.stat().st_mode)
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=path.parent,
                prefix=f".{path.name}.",
                delete=False,
            ) as handle:
                handle.write(contents)
                temporary = Path(handle.name)
                temporary.chmod(mode)
                staged.append((temporary, path))
            with tempfile.NamedTemporaryFile(
                dir=path.parent,
                prefix=f".{path.name}.backup.",
                delete=False,
            ) as backup_handle:
                backup_handle.write(path.read_bytes())
                backup = Path(backup_handle.name)
                backup.chmod(mode)
                backups.append((backup, path))
        try:
            for temporary, destination in staged:
                _replace_file(temporary, destination)
        except OSError as error:
            rollback_errors: list[str] = []
            for backup, destination in backups:
                try:
                    _replace_file(backup, destination)
                except OSError as rollback_error:
                    rollback_errors.append(f"{destination}: {rollback_error}")
            if rollback_errors:
                raise ReleaseError(
                    "Version update failed and rollback was incomplete: "
                    + "; ".join(rollback_errors)
                ) from error
            raise ReleaseError("Version update failed; original manifests restored") from error
    finally:
        for temporary, _ in (*staged, *backups):
            temporary.unlink(missing_ok=True)

    check_versions(repo_root, version)


def _resolve_component(plugin_root: Path, value: object, field: str) -> Path:
    if not isinstance(value, str) or not value.startswith("./") or "\\" in value:
        raise ReleaseError(f"{field} must be a ./-prefixed plugin-relative path")
    relative = value[2:-1] if value.endswith("/") else value[2:]
    parts = relative.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise ReleaseError(f"{field} contains an unsafe path: {value}")

    candidate = plugin_root.joinpath(*parts)
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(plugin_root.resolve(strict=True))
    except (OSError, ValueError) as error:
        raise ReleaseError(f"{field} points outside the plugin or does not exist: {value}") from error

    current = plugin_root
    for part in parts:
        current /= part
        if current.is_symlink():
            raise ReleaseError(f"{field} may not traverse a symbolic link: {value}")
    return candidate


def _collect_component(path: Path) -> set[Path]:
    if path.is_file():
        return {path}
    if not path.is_dir():
        raise ReleaseError(f"Unsupported component type: {path}")

    files: set[Path] = set()
    for candidate in path.rglob("*"):
        if candidate.is_symlink():
            raise ReleaseError(f"Submission components may not contain symbolic links: {candidate}")
        if candidate.is_file():
            files.add(candidate)
    return files


SKILLS_ONLY_OVERLAY = Path(".codex-plugin/skills-only.json")
# Fields that only the local marketplace install can use. The directory takes skills only.
APP_ONLY_FIELDS = ("mcpServers", "extensions")
OVERLAY_INTERFACE_FIELDS = ("shortDescription", "longDescription", "capabilities", "defaultPrompt")


def _skills_only_manifest(
    plugin_root: Path, manifest: dict[str, object]
) -> tuple[dict[str, object], set[str]]:
    """Return the manifest for the skills-only ZIP and the skill folders it leaves out.

    A manifest that declares an MCP server must ship `.codex-plugin/skills-only.json`, so the
    directory listing never describes an app that the ZIP does not contain.
    """
    has_app = any(field in manifest for field in APP_ONLY_FIELDS)
    overlay_path = plugin_root / SKILLS_ONLY_OVERLAY
    if not overlay_path.is_file():
        if has_app:
            raise ReleaseError(
                f"A manifest with {' or '.join(APP_ONLY_FIELDS)} needs {SKILLS_ONLY_OVERLAY} for the skills-only listing"
            )
        return manifest, set()

    overlay = _load_json(overlay_path)
    omitted = overlay.get("omitSkills", [])
    if not isinstance(omitted, list) or not all(
        isinstance(name, str) and re.fullmatch(r"[a-z0-9-]+", name) for name in omitted
    ):
        raise ReleaseError(f"{SKILLS_ONLY_OVERLAY} omitSkills must list skill folder names")
    interface_overlay = overlay.get("interface", {})
    if not isinstance(interface_overlay, dict) or not set(interface_overlay) <= set(
        OVERLAY_INTERFACE_FIELDS
    ):
        raise ReleaseError(
            f"{SKILLS_ONLY_OVERLAY} interface may only set {', '.join(OVERLAY_INTERFACE_FIELDS)}"
        )

    result = {key: value for key, value in manifest.items() if key not in APP_ONLY_FIELDS}
    interface = manifest.get("interface", {})
    if isinstance(interface, dict):
        result["interface"] = {**interface, **interface_overlay}
    return result, set(omitted)


def _submission_files(plugin_root: Path) -> tuple[str, set[Path], bytes]:
    manifest_path = plugin_root / ".codex-plugin/plugin.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ReleaseError("Missing regular .codex-plugin/plugin.json")
    manifest = _load_json(manifest_path)
    version = _validate_version(manifest.get("version"))

    if "apps" in manifest:
        raise ReleaseError("Skills-only submissions may not define apps")
    original_bytes = manifest_path.read_bytes()
    transformed = (plugin_root / SKILLS_ONLY_OVERLAY).is_file()
    manifest, omitted_skills = _skills_only_manifest(plugin_root, manifest)

    interface = manifest.get("interface", {})
    if not isinstance(interface, dict):
        raise ReleaseError("Manifest interface must be an object")
    if "screenshots" in interface:
        raise ReleaseError("Skills-only submissions may not include interface.screenshots")

    skills = _resolve_component(plugin_root, manifest.get("skills"), "skills")
    if not skills.is_dir():
        raise ReleaseError("Manifest skills must reference a directory")

    files = {manifest_path}
    files.update(
        path
        for path in _collect_component(skills)
        if path.relative_to(skills).parts[0] not in omitted_skills
    )
    if manifest.get("hooks"):
        files.update(
            _collect_component(_resolve_component(plugin_root, manifest["hooks"], "hooks"))
        )
    for field in ("composerIcon", "logo"):
        if interface.get(field):
            asset = _resolve_component(plugin_root, interface[field], f"interface.{field}")
            if not asset.is_file():
                raise ReleaseError(
                    f"interface.{field} must reference one regular visual asset"
                )
            files.add(asset)
    manifest_bytes = (
        (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
        if transformed
        else original_bytes
    )
    return version, files, manifest_bytes


def _archive_members(plugin_root: Path, files: set[Path]) -> list[tuple[Path, str]]:
    members: list[tuple[Path, str]] = []
    normalized_names: set[str] = set()
    extracted_size = 0

    for path in sorted(files):
        relative = path.relative_to(plugin_root)
        name = PurePosixPath(*relative.parts).as_posix()
        parts = PurePosixPath(name).parts
        if name.startswith("/") or "\\" in name or ".." in parts or len(parts) > 20:
            raise ReleaseError(f"Unsafe archive member path: {name}")
        if path.name in UNSUPPORTED_FILES:
            raise ReleaseError(f"Unsupported skills-only file: {name}")
        normalized = unicodedata.normalize("NFC", name).casefold()
        if normalized in normalized_names:
            raise ReleaseError(f"Archive path normalization collision: {name}")
        normalized_names.add(normalized)

        size = path.stat().st_size
        if size > ENTRY_LIMIT:
            raise ReleaseError(f"Archive member exceeds 100 MiB: {name}")
        extracted_size += size
        members.append((path, name))

    if len(members) > ENTRY_COUNT_LIMIT:
        raise ReleaseError("Archive contains more than 5,000 entries")
    if extracted_size > EXTRACTED_LIMIT:
        raise ReleaseError("Archive exceeds the 512 MiB extracted size limit")
    if not any(
        len(PurePosixPath(name).parts) == 3
        and name.startswith("skills/")
        and name.endswith("/SKILL.md")
        for _, name in members
    ):
        raise ReleaseError("Archive must contain at least one skills/<skill>/SKILL.md")
    return members


def build_archive(
    repo_root: Path,
    output_dir: Path,
    expected_version: str | None = None,
) -> Path:
    """Build and return a deterministic OpenAI skills-only ZIP."""
    synchronized_version = check_versions(repo_root, expected_version)
    plugin_root = repo_root / PLUGIN_ROOT
    manifest_version, files, manifest_bytes = _submission_files(plugin_root)
    manifest_path = plugin_root / ".codex-plugin/plugin.json"
    if manifest_version != synchronized_version:
        raise ReleaseError(
            f"Codex manifest version {manifest_version} differs from {synchronized_version}"
        )
    members = _archive_members(plugin_root, files)
    archive = (
        _output_directory(repo_root, output_dir)
        / f"fallow-plugin-{synchronized_version}-openai.zip"
    )

    entries = [
        (
            name,
            manifest_bytes if path == manifest_path else path.read_bytes(),
            bool(path.stat().st_mode & stat.S_IXUSR),
        )
        for path, name in members
    ]
    return _write_zip(archive, entries)


def _output_directory(repo_root: Path, output_dir: Path) -> Path:
    if not output_dir.is_absolute():
        output_dir = repo_root / output_dir
    try:
        output_dir.resolve().relative_to((repo_root / PLUGIN_ROOT).resolve(strict=True))
    except ValueError:
        pass
    else:
        raise ReleaseError("Output directory must be outside the plugin root")
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def _write_zip(archive: Path, entries: list[tuple[str, bytes, bool]]) -> Path:
    """Write a deterministic ZIP: fixed times, sorted input, and only the executable bit kept."""
    with tempfile.NamedTemporaryFile(
        dir=archive.parent,
        prefix=f".{archive.name}.",
        delete=False,
    ) as handle:
        temporary = Path(handle.name)
    try:
        with ZipFile(temporary, "w") as bundle:
            for name, contents, executable in entries:
                mode = 0o755 if executable else 0o644
                info = ZipInfo(name, FIXED_ZIP_TIME)
                info.compress_type = ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | mode) << 16
                bundle.writestr(info, contents, compresslevel=9)
        if temporary.stat().st_size > ARCHIVE_LIMIT:
            raise ReleaseError("Compressed archive exceeds the 100 MB upload limit")
        temporary.replace(archive)
    finally:
        temporary.unlink(missing_ok=True)
    return archive.resolve()


DIRECTORY_BUNDLE = Path("claude-directory/fallow")
DIRECTORY_MANIFEST_KEYS = (
    "name",
    "displayName",
    "description",
    "version",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
)
DIRECTORY_SKILL_EXCLUDES = {"fallow-codex-onboarding"}
DIRECTORY_FILE_TYPES = {".md", ".json", ".yaml", ".yml", ".txt", ".png"}
DIRECTORY_README = """# Fallow Code Analysis

Fallow gives Claude codebase intelligence for TypeScript and JavaScript
projects. The skills teach Claude to find unused files, exports and
dependencies, duplicated code, complex functions, circular dependencies and
architecture boundary violations, to review a change before a commit or a pull
request, and to set up code-quality tooling and a CI gate.

## What the plugin contains

- `fallow`: static analysis, changed-code risk, cleanup, architecture, styling,
  runtime evidence and Impact summaries.
- `fallow-review`: graph-grounded review of changed code.
- `fallow-mutation`: improves the tests of a change with mutation testing.
- `fallow-setup`: sets up code-quality tooling, the agent integration and a CI
  gate for a project.
- `fallow-cloud-setup`: connects an app to Fallow Cloud runtime coverage.
- `cargo-fallow`: runs `cargo fallow` on a Rust workspace.

This listing holds only skills. The plugin runs no hooks, scripts or servers of
its own.

## What runs, and what leaves your machine

Claude runs the fallow command-line tool in your project. When fallow is not
installed, the skills run an exact fallow release with npx, which downloads
that release from your npm registry. The analysis runs on your machine, and
product telemetry is off unless you turn it on. Fallow Cloud commands send data
only after you ask for them and set up a Fallow Cloud account.

## The full plugin

The plugin in the fallow-rs/fallow-skills marketplace adds the interactive
Fallow dashboard, a commit gate and a statusline command:

```text
/plugin install fallow --marketplace fallow-rs/fallow-skills
```

See the [Fallow privacy policy](https://fallow.tools/privacy) and the
[plugin documentation](https://fallow.tools/plugins). The plugin is MIT
licensed.
"""


def _directory_bundle_files(repo_root: Path) -> dict[str, bytes]:
    """The files of the skills-only bundle that the Claude plugin directory lists."""
    plugin_root = repo_root / PLUGIN_ROOT
    version = check_versions(repo_root)
    manifest = _load_json(plugin_root / ".claude-plugin/plugin.json")
    listed = {key: manifest[key] for key in DIRECTORY_MANIFEST_KEYS if key in manifest}
    listed["version"] = version
    files = {
        ".claude-plugin/plugin.json": json.dumps(listed, indent=2).encode() + b"\n",
        "LICENSE": (repo_root / "LICENSE").read_bytes(),
        "README.md": DIRECTORY_README.encode(),
        "assets/icon.png": (plugin_root / "assets/icon.png").read_bytes(),
    }
    for skill in sorted((plugin_root / "skills").iterdir()):
        if not skill.is_dir() or skill.name in DIRECTORY_SKILL_EXCLUDES:
            continue
        for path in sorted(skill.rglob("*")):
            relative = path.relative_to(plugin_root)
            if not path.is_file() or "agents" in relative.parts:
                continue
            if path.is_symlink() or path.suffix not in DIRECTORY_FILE_TYPES:
                raise ReleaseError(f"The directory bundle cannot hold {relative.as_posix()}")
            files[relative.as_posix()] = path.read_bytes()
    return files


def build_directory_bundle(repo_root: Path, output: Path = DIRECTORY_BUNDLE) -> Path:
    """Write the skills-only directory bundle, replacing any earlier copy."""
    target = output if output.is_absolute() else repo_root / output
    files = _directory_bundle_files(repo_root)
    if target.exists():
        for path in sorted(target.rglob("*"), reverse=True):
            path.unlink() if path.is_file() or path.is_symlink() else path.rmdir()
    for name, contents in files.items():
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(contents)
    return target.resolve()


def check_directory_bundle(repo_root: Path, output: Path = DIRECTORY_BUNDLE) -> list[str]:
    """Return each difference between the committed bundle and a fresh build."""
    target = output if output.is_absolute() else repo_root / output
    if not target.is_dir():
        return ["missing bundle"]
    expected = _directory_bundle_files(repo_root)
    actual = {
        path.relative_to(target).as_posix(): path.read_bytes()
        for path in target.rglob("*")
        if path.is_file()
    }
    problems = [f"missing {name}" for name in sorted(expected.keys() - actual.keys())]
    problems += [f"extra {name}" for name in sorted(actual.keys() - expected.keys())]
    problems += [
        f"changed {name}"
        for name in sorted(expected.keys() & actual.keys())
        if expected[name] != actual[name]
    ]
    return problems


def _desktop_manifest(version: str) -> dict[str, object]:
    """The MCPB manifest of the Fallow app as a Claude Desktop extension."""
    return {
        "manifest_version": "0.3",
        "name": "fallow-app",
        "display_name": "Fallow Code Analysis",
        "version": version,
        "description": "Fallow's code health dashboard for TypeScript and JavaScript projects.",
        "long_description": (
            "Runs fallow on your machine and shows the results as an interactive dashboard: "
            "dead code, unused dependencies, duplication, complexity, circular dependencies "
            "and architecture boundaries. Fallow must be installed on your PATH, chosen below, "
            "or downloaded with npx when you set the Fallow binary setting to npx. "
            "Your code stays on your machine."
        ),
        "author": {"name": "Bart Waardenburg", "email": "bart@fallow.tools", "url": "https://fallow.tools"},
        "homepage": "https://fallow.tools",
        "repository": {"type": "git", "url": "https://github.com/fallow-rs/fallow-skills"},
        "support": "https://github.com/fallow-rs/fallow-skills/issues",
        "license": "MIT",
        "icon": "icon.png",
        "keywords": ["fallow", "dead-code", "duplication", "complexity", "typescript", "javascript"],
        "server": {
            "type": "node",
            "entry_point": "server/server.mjs",
            "mcp_config": {
                "command": "node",
                "args": ["${__dirname}/server/server.mjs"],
                "env": {"FALLOW_BIN": "${user_config.fallow_bin}"},
            },
        },
        "user_config": {
            "fallow_bin": {
                "type": "file",
                "title": "Fallow executable",
                "description": (
                    "Optional. Choose the fallow binary when Claude cannot find it on your PATH, "
                    "for example a global npm install in a version manager folder."
                ),
                "required": False,
            }
        },
        "compatibility": {
            "platforms": ["darwin", "win32", "linux"],
            "runtimes": {"node": ">=20.0.0"},
        },
    }


def build_desktop_extension(
    repo_root: Path,
    output_dir: Path,
    expected_version: str | None = None,
) -> Path:
    """Build and return a deterministic `.mcpb` of the Fallow app for Claude Desktop."""
    version = check_versions(repo_root, expected_version)
    plugin_root = repo_root / PLUGIN_ROOT
    built = {name: plugin_root / "codex-app" / name for name in ("app.html", "server.mjs")}
    missing = [name for name, path in built.items() if not path.is_file()]
    if missing:
        raise ReleaseError(
            f"Missing app build output {', '.join(missing)}: run `npm run build` in codex-app"
        )
    manifest = json.dumps(_desktop_manifest(version), indent=2).encode() + b"\n"
    # The server reads its version from `../.codex-plugin/plugin.json`, as in the plugin folder.
    server_version = json.dumps({"name": "fallow", "version": version}, indent=2).encode() + b"\n"
    entries = [
        (".codex-plugin/plugin.json", server_version, False),
        ("icon.png", (plugin_root / "assets/icon.png").read_bytes(), False),
        ("manifest.json", manifest, False),
        ("server/app.html", built["app.html"].read_bytes(), False),
        ("server/server.mjs", built["server.mjs"].read_bytes(), False),
    ]
    archive = _output_directory(repo_root, output_dir) / f"fallow-app-{version}.mcpb"
    return _write_zip(archive, entries)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    check = commands.add_parser("check", help="validate synchronized plugin versions")
    check.add_argument("--expected-version")

    newer = commands.add_parser(
        "newer-than", help="require a synchronized version newer than the base version"
    )
    newer.add_argument("base_version")

    prerelease = commands.add_parser(
        "is-prerelease", help="print whether a semantic version is a prerelease"
    )
    prerelease.add_argument("version")

    set_version_parser = commands.add_parser(
        "set-version", help="update every explicit plugin version"
    )
    set_version_parser.add_argument("version")

    package = commands.add_parser("package", help="build the OpenAI submission ZIP")
    package.add_argument("--expected-version")
    package.add_argument("--output-dir", type=Path, default=Path("dist-submissions"))

    desktop = commands.add_parser(
        "package-desktop", help="build the Claude Desktop extension (.mcpb) of the Fallow app"
    )
    desktop.add_argument("--expected-version")
    desktop.add_argument("--output-dir", type=Path, default=Path("dist-submissions"))

    directory = commands.add_parser(
        "directory-bundle",
        help="write or check the skills-only bundle that the Claude plugin directory lists",
    )
    directory.add_argument("--check", action="store_true")
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        if args.command == "check":
            print(check_versions(REPO_ROOT, args.expected_version))
        elif args.command == "newer-than":
            print(check_newer_version(REPO_ROOT, args.base_version))
        elif args.command == "is-prerelease":
            print("true" if is_prerelease(args.version) else "false")
        elif args.command == "set-version":
            set_version(REPO_ROOT, args.version)
            print(args.version)
        elif args.command == "directory-bundle" and args.check:
            problems = check_directory_bundle(REPO_ROOT)
            if problems:
                raise ReleaseError(
                    "claude-directory/fallow is out of date ("
                    + ", ".join(problems)
                    + "). Run: python3 scripts/plugin_release.py directory-bundle"
                )
            print("claude-directory/fallow matches the plugin")
        elif args.command == "directory-bundle":
            print(build_directory_bundle(REPO_ROOT))
        elif args.command == "package-desktop":
            print(build_desktop_extension(REPO_ROOT, args.output_dir, args.expected_version))
        else:
            print(build_archive(REPO_ROOT, args.output_dir, args.expected_version))
    except ReleaseError as error:
        raise SystemExit(f"plugin-release: {error}") from error
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
