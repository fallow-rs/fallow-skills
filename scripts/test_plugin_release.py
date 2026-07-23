import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from plugin_release import ReleaseError, build_archive, check_versions, set_version


class PluginReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self._write_json(
            ".claude-plugin/marketplace.json",
            {
                "name": "fallow-skills",
                "metadata": {"version": "1.2.3"},
                "plugins": [{"name": "fallow", "version": "1.2.3", "source": "./fallow"}],
            },
        )
        self._write_json(
            "fallow/.claude-plugin/plugin.json",
            {"name": "fallow", "version": "1.2.3"},
        )
        self._write_json(
            "fallow/.codex-plugin/plugin.json",
            {
                "name": "fallow",
                "version": "1.2.3",
                "skills": "./skills/",
                "interface": {
                    "composerIcon": "./assets/icon.png",
                    "logo": "./assets/icon.png",
                },
            },
        )
        self._write("fallow/skills/fallow/SKILL.md", "---\nname: fallow\n---\n")
        self._write("fallow/skills/fallow/hooks/run.sh", "#!/bin/sh\nexit 0\n", 0o755)
        self._write("fallow/assets/icon.png", "png")
        self._write("fallow/private-notes.txt", "must not be packaged")

    def tearDown(self):
        self.temporary.cleanup()

    def _write(self, relative_path, contents, mode=0o644):
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(contents, encoding="utf-8")
        path.chmod(mode)

    def _write_json(self, relative_path, value):
        self._write(relative_path, json.dumps(value, indent=2) + "\n")

    def test_archive_is_deterministic_and_openai_specific(self):
        first = build_archive(self.root, Path("first"))
        source = self.root / "fallow/skills/fallow/SKILL.md"
        os.utime(source, (2_000_000_000, 2_000_000_000))
        second = build_archive(self.root, Path("second"))

        self.assertEqual(first.read_bytes(), second.read_bytes())
        with ZipFile(first) as bundle:
            self.assertEqual(
                bundle.namelist(),
                [
                    ".codex-plugin/plugin.json",
                    "assets/icon.png",
                    "skills/fallow/SKILL.md",
                    "skills/fallow/hooks/run.sh",
                ],
            )
            mode = bundle.getinfo("skills/fallow/hooks/run.sh").external_attr >> 16
            self.assertTrue(mode & stat.S_IXUSR)
            self.assertTrue(all(info.date_time == (1980, 1, 1, 0, 0, 0) for info in bundle.infolist()))

    def test_expected_version_must_match(self):
        with self.assertRaisesRegex(ReleaseError, "Expected plugin version 2.0.0"):
            build_archive(self.root, Path("dist"), "2.0.0")

    def test_unsupported_mcp_configuration_is_rejected(self):
        manifest_path = self.root / "fallow/.codex-plugin/plugin.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["mcpServers"] = "./.mcp.json"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        self._write("fallow/.mcp.json", "{}")

        with self.assertRaisesRegex(ReleaseError, "may not define mcpServers"):
            build_archive(self.root, Path("dist"))

    def test_symlinked_skill_content_is_rejected(self):
        target = self.root / "outside.txt"
        target.write_text("outside", encoding="utf-8")
        link = self.root / "fallow/skills/fallow/link.txt"
        try:
            link.symlink_to(target)
        except OSError:
            self.skipTest("Symbolic links are unavailable")

        with self.assertRaisesRegex(ReleaseError, "symbolic links"):
            build_archive(self.root, Path("dist"))

    def test_set_version_updates_all_explicit_fields(self):
        marketplace_path = self.root / ".claude-plugin/marketplace.json"
        marketplace_path.chmod(0o640)
        before = marketplace_path.read_text(encoding="utf-8")
        set_version(self.root, "2.0.0-beta.1")

        self.assertEqual(check_versions(self.root), "2.0.0-beta.1")
        self.assertEqual(stat.S_IMODE(marketplace_path.stat().st_mode), 0o640)
        after = marketplace_path.read_text(encoding="utf-8")
        self.assertEqual(before.count('"version": "1.2.3"'), 2)
        self.assertEqual(after.count('"version": "2.0.0-beta.1"'), 2)

    def test_set_version_refuses_to_hide_existing_drift(self):
        manifest_path = self.root / "fallow/.claude-plugin/plugin.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["version"] = "9.9.9"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

        with self.assertRaisesRegex(ReleaseError, "not synchronized"):
            set_version(self.root, "2.0.0")


if __name__ == "__main__":
    unittest.main()
