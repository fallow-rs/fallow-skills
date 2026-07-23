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
SEMVER = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
VERSION_FILES = (
    Path(".claude-plugin/marketplace.json"),
    Path("fallow/.claude-plugin/plugin.json"),
    Path("fallow/.codex-plugin/plugin.json"),
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


def _validate_version(version: object) -> str:
    if not isinstance(version, str) or not SEMVER.fullmatch(version):
        raise ReleaseError(f"Invalid semantic version: {version!r}")
    return version


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
    if claude.get("name") != "fallow" or codex.get("name") != "fallow":
        raise ReleaseError("Plugin manifests must keep the stable name 'fallow'")

    return tuple(
        _validate_version(version)
        for version in (
            metadata.get("version"),
            plugin_entry.get("version"),
            claude.get("version"),
            codex.get("version"),
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


def set_version(repo_root: Path, version: str) -> None:
    """Update every explicit plugin version while preserving JSON formatting."""
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
        for temporary, destination in staged:
            temporary.replace(destination)
    finally:
        for temporary, _ in staged:
            temporary.unlink(missing_ok=True)

    check_versions(repo_root, version)


def _resolve_component(plugin_root: Path, value: object, field: str) -> Path:
    if not isinstance(value, str) or not value.startswith("./") or "\\" in value:
        raise ReleaseError(f"{field} must be a ./-prefixed plugin-relative path")
    relative = value[2:-1] if value.endswith("/") else value[2:]
    parts = relative.split("/")
    if not parts or any(part in {"", ".", ".."} for part in parts):
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


def _submission_files(plugin_root: Path) -> tuple[str, set[Path]]:
    manifest_path = plugin_root / ".codex-plugin/plugin.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ReleaseError("Missing regular .codex-plugin/plugin.json")
    manifest = _load_json(manifest_path)
    version = _validate_version(manifest.get("version"))

    for field in ("mcpServers", "apps"):
        if manifest.get(field):
            raise ReleaseError(f"Skills-only submissions may not define {field}")

    interface = manifest.get("interface", {})
    if not isinstance(interface, dict):
        raise ReleaseError("Manifest interface must be an object")
    if interface.get("screenshots"):
        raise ReleaseError("Skills-only submissions may not include interface.screenshots")

    skills = _resolve_component(plugin_root, manifest.get("skills"), "skills")
    if not skills.is_dir():
        raise ReleaseError("Manifest skills must reference a directory")

    files = {manifest_path}
    files.update(_collect_component(skills))
    if manifest.get("hooks"):
        files.update(
            _collect_component(_resolve_component(plugin_root, manifest["hooks"], "hooks"))
        )
    for field in ("composerIcon", "logo"):
        if interface.get(field):
            files.update(
                _collect_component(
                    _resolve_component(plugin_root, interface[field], f"interface.{field}")
                )
            )
    return version, files


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
    manifest_version, files = _submission_files(plugin_root)
    if manifest_version != synchronized_version:
        raise ReleaseError(
            f"Codex manifest version {manifest_version} differs from {synchronized_version}"
        )
    members = _archive_members(plugin_root, files)

    if not output_dir.is_absolute():
        output_dir = repo_root / output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    archive = output_dir / f"fallow-plugin-{synchronized_version}-openai.zip"

    with tempfile.NamedTemporaryFile(
        dir=output_dir,
        prefix=f".{archive.name}.",
        delete=False,
    ) as handle:
        temporary = Path(handle.name)
    try:
        with ZipFile(temporary, "w") as bundle:
            for path, name in members:
                mode = 0o755 if path.stat().st_mode & stat.S_IXUSR else 0o644
                info = ZipInfo(name, FIXED_ZIP_TIME)
                info.compress_type = ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | mode) << 16
                bundle.writestr(info, path.read_bytes(), compresslevel=9)
        if temporary.stat().st_size > ARCHIVE_LIMIT:
            raise ReleaseError("Compressed archive exceeds the 100 MB upload limit")
        temporary.replace(archive)
    finally:
        temporary.unlink(missing_ok=True)
    return archive.resolve()


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help=argparse.SUPPRESS,
    )
    commands = parser.add_subparsers(dest="command", required=True)

    check = commands.add_parser("check", help="validate synchronized plugin versions")
    check.add_argument("--expected-version")

    set_version_parser = commands.add_parser(
        "set-version", help="update every explicit plugin version"
    )
    set_version_parser.add_argument("version")

    package = commands.add_parser("package", help="build the OpenAI submission ZIP")
    package.add_argument("--expected-version")
    package.add_argument("--output-dir", type=Path, default=Path("dist-submissions"))
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        if args.command == "check":
            print(check_versions(args.repo_root, args.expected_version))
        elif args.command == "set-version":
            set_version(args.repo_root, args.version)
            print(args.version)
        else:
            print(build_archive(args.repo_root, args.output_dir, args.expected_version))
    except ReleaseError as error:
        raise SystemExit(f"plugin-release: {error}") from error
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
