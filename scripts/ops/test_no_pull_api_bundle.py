import json
from pathlib import Path
import tempfile
import unittest

from no_pull_api_bundle import COMPILED_ROOTS, build, compose, verify


class BundleTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.old = self.root / "old"
        self.new = self.root / "new"
        for root in (self.old, self.new):
            for prefix in COMPILED_ROOTS:
                (root / prefix).mkdir(parents=True)
        self.changed = "apps/api/dist/mcp/example.js"
        old = self.old / self.changed
        old.parent.mkdir(parents=True)
        old.write_text("export const value = 1;\n")
        new = self.new / self.changed
        new.parent.mkdir(parents=True)
        new.write_text("export const value = 2;\n")
        self.added = self.new / "apps/api/dist/providers/new-gate.js"
        self.added.parent.mkdir(parents=True)
        self.added.write_text("export const gate = false;\n")

    def build_bundle(self):
        bundle = self.root / "bundle"
        build(self.old, self.new, bundle, "sha256:old", "sha256:new", "a" * 40)
        return bundle

    def test_only_changed_compiled_files_and_read_only_bind_mounts(self):
        bundle = self.build_bundle()
        manifest = verify(bundle)
        self.assertEqual([e["path"] for e in manifest["files"]],
                         [self.changed, "apps/api/dist/providers/new-gate.js"])
        overlay = self.root / "overlay.json"
        compose(bundle, overlay, "qrs_api")
        service = json.loads(overlay.read_text())["services"]["qrs_api"]
        self.assertEqual(len(service["volumes"]), 2)
        self.assertTrue(all(item["read_only"] and
                            item["bind"]["create_host_path"] is False
                            for item in service["volumes"]))

    def test_deletions_and_tampering_fail_closed(self):
        self.changed = "apps/api/dist/mcp/deleted.js"
        old = self.old / self.changed
        old.parent.mkdir(parents=True, exist_ok=True)
        old.write_text("present only in old")
        with self.assertRaisesRegex(ValueError, "compiled_deletions"):
            self.build_bundle()

    def test_bundle_hash_mismatch_fails(self):
        bundle = self.build_bundle()
        target = bundle / "files" / self.changed
        target.chmod(0o644)
        target.write_text("tampered")
        with self.assertRaisesRegex(ValueError, "bundle_file_drift"):
            verify(bundle)


if __name__ == "__main__":
    unittest.main()
