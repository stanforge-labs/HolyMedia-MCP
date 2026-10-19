"""Offline regression tests for the production Web cache-only release path."""

import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("holypilot_web_release_once.py")
SPEC = importlib.util.spec_from_file_location("holypilot_web_release_once", SCRIPT)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class CachedImageTests(unittest.TestCase):
    def setUp(self):
        self.reference = release.NEW_IMAGE
        self.valid = [{
            "Id": release.NEW_DIGEST,
            "RepoDigests": ["ghcr.io/stanforge-labs/holymedia-mcp-v2@" + release.NEW_DIGEST],
            "Config": {"Labels": {"org.opencontainers.image.revision": release.SOURCE_SHA}},
        }]

    def inspect(self, payload):
        with patch.object(release, "output", return_value=json.dumps(payload)) as command:
            result = release.verify_cached_image(
                self.reference, release.NEW_DIGEST, release.SOURCE_SHA, release.NEW_DIGEST)
        command.assert_called_once_with(["docker", "image", "inspect", self.reference])
        return result

    def test_exact_cached_image_passes_with_read_only_inspect(self):
        self.assertEqual(self.inspect(self.valid), release.NEW_DIGEST)

    def test_missing_image_fails_without_pull(self):
        with patch.object(release, "output", side_effect=subprocess.CalledProcessError(
                1, ["docker", "image", "inspect", self.reference])) as command:
            with self.assertRaises(subprocess.CalledProcessError):
                release.verify_cached_image(self.reference, release.NEW_DIGEST,
                                            release.SOURCE_SHA, release.NEW_DIGEST)
        command.assert_called_once()

    def test_wrong_digest_revision_or_id_fails(self):
        cases = (
            ("RepoDigests", ["ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:wrong"]),
            ("Id", "sha256:wrong"),
        )
        for key, value in cases:
            document = json.loads(json.dumps(self.valid))
            document[0][key] = value
            with self.subTest(key=key), patch.object(release, "output", return_value=json.dumps(document)):
                with self.assertRaisesRegex(RuntimeError, "cached_image_.*_mismatch"):
                    release.verify_cached_image(self.reference, release.NEW_DIGEST,
                                                release.SOURCE_SHA, release.NEW_DIGEST)
        document = json.loads(json.dumps(self.valid))
        document[0]["Config"]["Labels"]["org.opencontainers.image.revision"] = "wrong"
        with patch.object(release, "output", return_value=json.dumps(document)):
            with self.assertRaisesRegex(RuntimeError, "cached_image_revision_mismatch"):
                release.verify_cached_image(self.reference, release.NEW_DIGEST,
                                            release.SOURCE_SHA, release.NEW_DIGEST)

    def test_incomplete_inspect_fails(self):
        for payload in ([], [{}, {}], {}):
            with self.subTest(payload=payload), patch.object(release, "output", return_value=json.dumps(payload)):
                with self.assertRaisesRegex(RuntimeError, "cached_image_inspect_incomplete"):
                    release.verify_cached_image(self.reference, release.NEW_DIGEST,
                                                release.SOURCE_SHA, release.NEW_DIGEST)


class GuardAndReleaseTests(unittest.TestCase):
    def test_cache_mode_must_be_explicit(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "/tmp/not-a-release"],
                                capture_output=True, text=True, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("explicit --from-cache", result.stderr)

    def test_extra_disk_floor_and_original_memory_limits(self):
        valid = dict(mem=819200, swapfree=262144, disk_mib=11500, full=1.49, some=1.99)
        release.ensure_immediate_preflight(valid)
        release.ensure_immediate_preflight({**valid, "disk_mib": 11774})
        for key, value in (("disk_mib", 11499), ("mem", 819199),
                           ("swapfree", 262143), ("full", 1.5), ("some", 2.0)):
            current = {**valid, key: value}
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, "immediate_preflight_fail"):
                release.ensure_immediate_preflight(current)

    def test_original_guard_sha_and_full_duration_remain_pinned(self):
        self.assertEqual(release.GUARD_SHA,
                         "6f256d9b68bc6c909a6a4754bfda003333fe01ab80027e4c0d5db799374a5fa4")
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            with patch.object(release, "GUARD", directory / "guard.py"), \
                    patch.object(release, "subprocess") as proc:
                proc.run.return_value.returncode = 0
                # Empty or incomplete trace must never count as PASS.
                with self.assertRaises((json.JSONDecodeError, ValueError)):
                    release.run_guard(directory, "guard.json")
                self.assertEqual(proc.run.call_args.args[0][-2:], ["--seconds", "600"])

    def test_partial_guard_pass_record_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            with patch.object(release, "GUARD", directory / "guard.py"), \
                    patch.object(release, "subprocess") as proc:
                proc.run.return_value.returncode = 0
                # The guard writes to this file; simulate a truncated PASS record.
                original_open = Path.open

                def guarded_open(path, *args, **kwargs):
                    file = original_open(path, *args, **kwargs)
                    if path.name == "partial.json" and args and args[0] == "w":
                        file.write(json.dumps({"status": "PASS", "duration_s": 599.9}))
                        file.flush()
                    return file

                with patch.object(Path, "open", guarded_open):
                    with self.assertRaisesRegex(RuntimeError, "resource_guard_incomplete"):
                        release.run_guard(directory, "partial.json")

    def test_exact_source_shell_is_modified_only_for_no_pull_and_start_trace(self):
        with tempfile.TemporaryDirectory() as temp:
            old = Path(temp) / "old"
            old.mkdir()
            destination = Path(temp) / "run"
            destination.mkdir()
            source = f'''#!/usr/bin/env bash
backup={old}
cp /tmp/holypilot-startup-watch.py "$backup/startup-watch.py"
cat > "$new_override" <<EOF
services:
  web:
    image: $newref
EOF
cat > "$old_override" <<EOF
services:
  web:
    image: $oldref
EOF
old up -d --no-deps --no-build --force-recreate web
touch "$backup/cutover-attempted"
cutover=1
docker stop "$web" >/dev/null
[[ $(docker inspect "$web" --format '{{{{.State.Running}}}}') == false ]]
new up -d --no-deps --no-build --force-recreate web
status=''
'''
            (old / "release-one-unexecuted.sh").write_text(source)
            with patch.object(release, "OLD_PACKAGE", old), \
                    patch.object(release, "OLD_SCRIPT_SHA", digest(source)):
                result = release.prepare_release_script(destination)
            transformed = (destination / "release-one.sh").read_text()
            self.assertEqual(result, digest(transformed))
            self.assertEqual(transformed.count("pull_policy: never"), 2)
            self.assertEqual(transformed.count("--pull never"), 2)
            self.assertIn('touch "$backup/web-start.begin"\ndocker stop', transformed)
            self.assertIn('touch "$backup/web-start.running"\nstatus=', transformed)
            self.assertIn('[[ ! -e "$backup/startup-watch.json" && ! -e "$backup/startup-watch.fail" ]]', transformed)
            self.assertNotIn("docker pull", transformed)

    def test_startup_trace_inherits_original_thresholds(self):
        with tempfile.TemporaryDirectory() as temp:
            old = Path(temp) / "old"
            old.mkdir()
            destination = Path(temp) / "run"
            destination.mkdir()
            source = '''import time
def main():
    current = first
    while time.monotonic() - start < 180:
        now = time.monotonic()
        current = sample()
        for key in low: pass
    result = dict(status='FAIL' if reason else 'PASS', reason=reason,
                  duration_s=180)
'''
            (old / "startup-watch-unexecuted.py").write_text(source)
            with patch.object(release, "OLD_PACKAGE", old), \
                    patch.object(release, "WATCH_SHA", digest(source)):
                release.prepare_startup_watcher(destination)
            transformed = (destination / "startup-watch-unexecuted.py").read_text()
            self.assertIn("startup-watch-trace.jsonl", transformed)
            self.assertIn("web-start.begin", transformed)
            self.assertIn("web-start.running", transformed)
            self.assertIn("web_start_exceeded_watch_window", transformed)
            self.assertEqual(transformed.count("while time.monotonic() - start < 180:"), 1)


if __name__ == "__main__":
    unittest.main()
