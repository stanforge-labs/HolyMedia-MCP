"""Offline checks for the future single-use no-pull TEST runner."""

import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import batch2_no_pull_test_once as runner


class NoPullRunnerTests(unittest.TestCase):
    def test_safe_archive_and_pinned_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = b'{"format":"test"}\n'
            archive = root / "release.tar.gz"
            with tarfile.open(archive, "w:gz") as output:
                info = tarfile.TarInfo("./manifest.json")
                info.size = len(manifest)
                output.addfile(info, io.BytesIO(manifest))
            target = root / "files"
            with (patch.object(runner, "ARCHIVE_SHA256", hashlib.sha256(archive.read_bytes()).hexdigest()),
                  patch.object(runner, "MANIFEST_SHA256", hashlib.sha256(manifest).hexdigest()),
                  patch.object(runner.bundle_tool, "verify", return_value={
                      "old_image": runner.prior.OLD_API,
                      "candidate_image": runner.prior.NEW_API,
                      "source_sha": runner.NEW_API_SOURCE,
                      "files": [{}] * runner.EXPECTED_FILES,
                  })):
                runner.safe_extract(archive, target)
            self.assertEqual((target / "manifest.json").read_bytes(), manifest)

    def test_archive_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "release.tar.gz"
            with tarfile.open(archive, "w:gz") as output:
                info = tarfile.TarInfo("./files/../../escape.js")
                info.size = 1
                output.addfile(info, io.BytesIO(b"x"))
            with patch.object(runner, "ARCHIVE_SHA256", hashlib.sha256(archive.read_bytes()).hexdigest()):
                with self.assertRaisesRegex(RuntimeError, "unsafe_member"):
                    runner.safe_extract(archive, root / "output")
            self.assertFalse((root / "escape.js").exists())

    def test_model_gate_accepts_only_web_probe_and_api_mounts(self):
        base = {"services": {
            "qrs_api": {"image": runner.prior.OLD_API, "environment": {
                "GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST": "8590146099",
                "QRS_TEST_RESTRICTED_AUTH": "true",
                "QRS_TEST_PMAX_CONFIRMED_WRITE_ENABLED": "false",
                "V2_CONFIRMED_WRITE_ENABLED": "false",
            }, "healthcheck": {"test": ["CMD", "node"]}},
            "qrs_web": {"image": runner.prior.OLD_WEB,
                        "healthcheck": {"test": ["CMD", "node"]}},
        }}
        changed = json.loads(json.dumps(base))
        changed["services"]["qrs_api"]["volumes"] = [
            {"read_only": True} for _ in range(runner.EXPECTED_FILES)]
        changed["services"]["qrs_web"]["healthcheck"] = {
            "test": ["CMD", "bash", "-ec", "probe"],
            "interval": "15s", "timeout": "5s",
        }
        def fake_compose(_args, *, candidate):
            return json.dumps(changed if candidate else base).encode()
        with patch.object(runner, "compose", side_effect=fake_compose):
            runner.model_gate()
            changed["services"]["qrs_api"]["command"] = ["unexpected"]
            with self.assertRaisesRegex(RuntimeError, "unapproved_service_change"):
                runner.model_gate()


if __name__ == "__main__":
    unittest.main()
