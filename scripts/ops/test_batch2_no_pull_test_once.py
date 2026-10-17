"""Offline checks for the future single-use no-pull TEST runner."""

import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import call, patch

import batch2_no_pull_test_once as runner


class NoPullRunnerTests(unittest.TestCase):
    def test_pinned_staged_helpers_match_exact_local_sources(self):
        repo = Path(__file__).resolve().parents[2]
        for name, expected in runner.SOURCE_HASHES.items():
            path = (repo / "infra/test-mcp/no-pull-web-health.override.yml"
                    if name.endswith(".yml") else repo / "scripts/ops" / name)
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), expected, name)

    def test_maintenance_transition_uses_original_stop_baseline_for_both_starts(self):
        baseline = {"pswpout": 42, "oom_kill": 0}
        with (patch.object(runner.prior, "guard") as guard,
              patch.object(runner, "start_candidate_service") as start):
            runner.activate_after_maintenance(baseline)
        guard.assert_called_once_with("maintenance")
        self.assertEqual(start.call_args_list, [
            call("qrs_api", baseline, "http://127.0.0.1:14404/ready"),
            call("qrs_web", baseline, "http://127.0.0.1:13300/auth"),
        ])

    def test_startup_gate_keeps_test_stop_baseline_and_records_phase(self):
        baseline = {"pswpout": 42, "oom_kill": 0}
        sample = {"pswpout": 42, "oom_kill": 0}
        with (patch.object(runner.prior, "host_gate", return_value=sample) as gate,
              patch.object(runner.prior, "metric", return_value=sample),
              patch.object(runner.prior, "event") as event,
              patch.object(runner, "compose") as compose,
              patch.object(runner.prior, "wait_health") as health):
            runner.start_candidate_service("qrs_api", baseline, "http://127.0.0.1:14404/ready")
        self.assertEqual(gate.call_count, 2)
        gate.assert_any_call(
            baseline, reserve=runner.prior.ROLLBACK_RESERVE_MIB,
            context="pre_candidate_start:qrs_api")
        gate.assert_any_call(
            baseline, reserve=runner.prior.ROLLBACK_RESERVE_MIB,
            context="candidate_start_returned:qrs_api")
        health.assert_called_once_with(
            runner.prior.API_NAME, baseline, "http://127.0.0.1:14404/ready")
        compose.assert_called_once_with(
            ["up", "-d", "--no-deps", "--no-build", "--pull", "never", "qrs_api"],
            candidate=True)
        self.assertEqual([call.args[0] for call in event.call_args_list],
                         ["candidate_start_begin", "candidate_start_returned", "candidate_healthy"])

    def test_host_gate_persists_exact_failed_psi_sample(self):
        baseline = {"pswpout": 42, "oom_kill": 0}
        sample = {"mem_kib": 1088488, "swap_free_kib": 1599664,
                  "disk_free_mib": 12382, "psi_full": 1.51, "psi_some": 2.01,
                  "pswpout": 42, "pswpin": 5, "pgmajfault": 15, "oom_kill": 0}
        with (patch.object(runner.prior, "metric", return_value=sample),
              patch.object(runner.prior, "event") as event):
            with self.assertRaisesRegex(RuntimeError, "memory_psi"):
                runner.prior.host_gate(baseline, context="candidate_health:qrs_api")
        event.assert_called_once()
        self.assertEqual(event.call_args.args[0], "host_gate_failed")
        self.assertIs(event.call_args.kwargs["metric"], sample)
        self.assertEqual(event.call_args.kwargs["context"], "candidate_health:qrs_api")
        self.assertEqual(event.call_args.kwargs["limits"]["psi_full"], 1.5)
        self.assertEqual(event.call_args.kwargs["limits"]["psi_some"], 2.0)

    def test_startup_gate_rejects_swap_since_test_stop(self):
        baseline = {"pswpout": 42, "oom_kill": 0}
        sample = {"mem_kib": 1100000, "swap_free_kib": 1599664,
                  "disk_free_mib": 12382, "psi_full": 0.0, "psi_some": 0.0,
                  "pswpout": 43, "pswpin": 5, "pgmajfault": 15, "oom_kill": 0}
        with (patch.object(runner.prior, "metric", return_value=sample),
              patch.object(runner.prior, "event") as event,
              patch.object(runner, "compose") as compose):
            with self.assertRaisesRegex(RuntimeError, "new_swap_out"):
                runner.start_candidate_service("qrs_api", baseline, "http://127.0.0.1:14404/ready")
        compose.assert_not_called()
        self.assertEqual(event.call_args.args[0], "host_gate_failed")
        self.assertEqual(event.call_args.kwargs["baseline_pswpout"], 42)

    def test_prepare_creates_audit_directory_before_pending_check(self):
        with tempfile.TemporaryDirectory() as directory:
            run = Path(directory) / "single-use"

            def checked_preflight():
                self.assertTrue(run.is_dir())
                self.assertTrue((run / "events.jsonl").is_file())
                raise RuntimeError("preflight_stop")

            with (patch.object(runner, "RUN", run), patch.object(runner.prior, "RUN", run),
                  patch.object(runner, "source_gate"),
                  patch.object(runner, "preflight", side_effect=checked_preflight)):
                with self.assertRaisesRegex(RuntimeError, "preflight_stop"):
                    runner.prepare(Path("unused"))

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
            base["services"]["qrs_api"]["environment"]["QRS_TEST_PMAX_CONFIRMED_WRITE_ENABLED"] = "true"
            changed["services"]["qrs_api"]["environment"]["QRS_TEST_PMAX_CONFIRMED_WRITE_ENABLED"] = "true"
            with self.assertRaisesRegex(RuntimeError, "test_write_gate_drift"):
                runner.model_gate()
            del base["services"]["qrs_api"]["environment"]["QRS_TEST_PMAX_CONFIRMED_WRITE_ENABLED"]
            del changed["services"]["qrs_api"]["environment"]["QRS_TEST_PMAX_CONFIRMED_WRITE_ENABLED"]
            changed["services"]["qrs_api"]["command"] = ["unexpected"]
            with self.assertRaisesRegex(RuntimeError, "unapproved_service_change"):
                runner.model_gate()


if __name__ == "__main__":
    unittest.main()
