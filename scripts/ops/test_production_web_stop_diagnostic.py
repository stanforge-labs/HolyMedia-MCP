"""No-container offline tests for one Web stop and bounded old-Web recovery."""

import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import production_web_stop_diagnostic_once as diagnostic  # noqa: E402
from production_only_guard_policy import PROD, TEST  # noqa: E402
from test_production_only_guard import fixture  # noqa: E402


def plan_and_rows():
    _, events, checkpoint = fixture()
    rows = copy.deepcopy(events[0]["containers"])
    web = rows[diagnostic.WEB]
    plan = {"profile": "OLD_WEB_STOP_DIAGNOSTIC_V1", "web_id": web["id"],
            "web_image": web["image"], "old_ref": "ghcr.io/example@sha256:old",
            "production_baseline": {name: copy.deepcopy(rows[name]) for name in PROD},
            "test_checkpoint": checkpoint}
    return plan, rows


class DiagnosticTests(unittest.TestCase):
    def test_prepare_snapshots_only_original_web_and_retired_test(self):
        _plan, rows = plan_and_rows()
        _, _, checkpoint = fixture()
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            config = base / "compose.yml"
            config.write_text("services: {}\n")
            run_dir = base / "protected-run"
            with patch.object(diagnostic.release, "CONFIGS", {"base-compose.yml": config}), \
                    patch.object(diagnostic, "load_checkpoint", return_value=checkpoint), \
                    patch.object(diagnostic, "docker_state", return_value=rows), \
                    patch.object(diagnostic.release, "pending_operations", return_value=[0] * 6), \
                    patch.object(diagnostic.legacy, "immediate", return_value={}), \
                    patch.object(diagnostic.legacy, "ensure_immediate_preflight"), \
                    patch.object(diagnostic.release, "baseline_image", return_value="ghcr.io/example@sha256:old"), \
                    patch.object(diagnostic, "web_pid", return_value=42), \
                    patch.object(diagnostic.probe, "select", return_value={"pids": {"42": 1},
                        "cgroups": ["/web"]}), \
                    patch.object(diagnostic.legacy, "OLD_PACKAGE", HERE / "fixtures"), \
                    patch.object(diagnostic.release, "command") as command:
                plan = diagnostic.prepare(run_dir)
                self.assertEqual(plan["web_id"], rows[diagnostic.WEB]["id"])
                self.assertEqual(set(plan["test_checkpoint"]), set(TEST))
                self.assertEqual(diagnostic.load_plan(run_dir)["web_id"], plan["web_id"])
                self.assertEqual(run_dir.stat().st_mode & 0o077, 0)
                command.assert_not_called()
            self.assertFalse((run_dir / "new-web.yml").exists())

    def test_diagnostic_watchdog_preserves_resource_thresholds_and_phases(self):
        archive = HERE / "fixtures" / "startup-watch-unexecuted.py"
        with tempfile.TemporaryDirectory() as temp, \
                patch.object(diagnostic.legacy, "OLD_PACKAGE", archive.parent):
            diagnostic.legacy.prepare_startup_watcher(Path(temp), diagnostic=True)
            code = (Path(temp) / "startup-watch-unexecuted.py").read_text()
            self.assertIn("peak60['pswpin'] > 32", code)
            self.assertIn("current['pswpin'] - first['pswpin'] > 64", code)
            self.assertIn("'restoring-old'", code)
            self.assertIn("'old-stopped'", code)
            self.assertIn("capture(selection, phase)", code)
            self.assertNotIn("candidate_not_running_in_watch_window", code)

    def test_one_stop_has_immediate_restore_even_when_docker_stop_fails(self):
        plan, rows = plan_and_rows()
        stopped = copy.deepcopy(rows)
        stopped[diagnostic.WEB]["status"] = "exited"
        stopped[diagnostic.WEB]["health"] = "none"
        class Watcher:
            def poll(self):
                return None
            def wait(self, timeout=None):
                return 0
        watcher = Watcher()
        for stop_fails in (False, True):
            with self.subTest(stop_fails=stop_fails), tempfile.TemporaryDirectory() as temp:
                run_dir = Path(temp)
                (run_dir / "backstop-armed").write_text(diagnostic.UNIT_PREFIX + "offline")
                (run_dir / "preflight-pass").touch()
                (run_dir / "startup-watch.ready").touch()
                (run_dir / "preflight-result.json").write_text(
                    json.dumps({"status": "PASS", "duration_exact_s": 600.001}))
                (run_dir / "startup-watch.json").write_text(
                    json.dumps({"status": "FAIL", "reason": "swap_in", "duration_exact_s": 1.0}))
                (run_dir / "startup-attribution.jsonl").write_text("{}\n{}\n")
                (run_dir / "boundary-attribution.jsonl").write_text("{}\n{}\n")
                def command(args, **_kwargs):
                    if args[0] == "systemctl":
                        return type("Result", (), {"stdout":
                            "ExecStopPost=python3 --recover --run-dir " + str(run_dir) +
                            "\nRuntimeMaxUSec=3min 30s"})()
                    if args[:2] == ["docker", "stop"] and stop_fails:
                        raise RuntimeError("docker_stop_failed")
                    return type("Result", (), {"stdout": ""})()
                with patch.dict(os.environ, {"INVOCATION_ID": "invocation",
                    "HOLYPILOT_DIAG_UNIT": diagnostic.UNIT_PREFIX + "offline"}), \
                        patch.object(diagnostic, "load_plan", return_value=plan), \
                        patch.object(diagnostic, "verify_baseline"), \
                        patch.object(diagnostic.probe, "read_selection", return_value={"pids": {}}), \
                        patch.object(diagnostic.probe, "benchmark", return_value={
                            "p95_ms": 2, "max_ms": 3}), \
                        patch.object(diagnostic.legacy, "prepare_startup_watcher"), \
                        patch.object(diagnostic.subprocess, "Popen", return_value=watcher), \
                        patch.object(diagnostic.release, "command", side_effect=command) as calls, \
                        patch.object(diagnostic, "docker_state", return_value=stopped), \
                        patch.object(diagnostic, "boundary"), \
                        patch.object(diagnostic, "recover", side_effect=lambda path:
                            diagnostic.release.record_phase(path, "web", "restored")) as restore:
                    if stop_fails:
                        with self.assertRaisesRegex(RuntimeError, "docker_stop_failed"):
                            diagnostic.observe(run_dir)
                    else:
                        self.assertEqual(diagnostic.observe(run_dir),
                                         "RESTORED_DIAGNOSTIC_COMPLETE")
                        result = json.loads((run_dir / "diagnostic-result.json").read_text())
                        self.assertEqual(result["status"], "RECOVERED_WITH_RESOURCE_FAIL")
                    restore.assert_called_once_with(run_dir)
                    stops = [call.args[0] for call in calls.call_args_list
                             if call.args[0][:2] == ["docker", "stop"]]
                    self.assertEqual(stops, [["docker", "stop", "--time", "5", diagnostic.WEB]])
                    self.assertFalse(any("candidate" in " ".join(args) for args in stops))

    def test_watchdog_fail_before_stop_blocks_docker_mutation(self):
        plan, _ = plan_and_rows()
        class Watcher:
            def poll(self):
                return None
            def wait(self, timeout=None):
                return 0
        with tempfile.TemporaryDirectory() as temp:
            run_dir = Path(temp)
            for name in ("backstop-armed", "preflight-pass", "startup-watch.ready"):
                (run_dir / name).touch()
            (run_dir / "backstop-armed").write_text(diagnostic.UNIT_PREFIX + "offline")
            (run_dir / "preflight-result.json").write_text(
                json.dumps({"status": "PASS", "duration_exact_s": 600.001}))
            checks = 0
            def fail_second(*_args):
                nonlocal checks
                checks += 1
                if checks == 2:
                    raise RuntimeError("startup_resource_fail")
            def command(args, **_kwargs):
                if args[0] == "systemctl":
                    return type("Result", (), {"stdout":
                        "ExecStopPost=python3 --recover --run-dir " + str(run_dir) +
                        "\nRuntimeMaxUSec=5min"})()
                raise AssertionError("docker must not run")
            with patch.dict(os.environ, {"INVOCATION_ID": "invocation",
                "HOLYPILOT_DIAG_UNIT": diagnostic.UNIT_PREFIX + "offline"}), \
                    patch.object(diagnostic, "load_plan", return_value=plan), \
                    patch.object(diagnostic, "verify_baseline"), \
                    patch.object(diagnostic.probe, "read_selection", return_value={"pids": {}}), \
                    patch.object(diagnostic.probe, "benchmark", return_value={"p95_ms": 2, "max_ms": 3}), \
                    patch.object(diagnostic.legacy, "prepare_startup_watcher"), \
                    patch.object(diagnostic.subprocess, "Popen", return_value=Watcher()), \
                    patch.object(diagnostic.release, "command", side_effect=command), \
                    patch.object(diagnostic.release, "require_watcher_alive", side_effect=fail_second), \
                    patch.object(diagnostic, "boundary"), \
                    patch.object(diagnostic, "recover"):
                with self.assertRaisesRegex(RuntimeError, "startup_resource_fail"):
                    diagnostic.observe(run_dir)

    def test_direct_invocation_without_systemd_backstop_cannot_stop_web(self):
        with patch.dict("os.environ", {"INVOCATION_ID": "", "HOLYPILOT_DIAG_UNIT": ""}), \
                patch.object(diagnostic.release, "command") as command:
            with self.assertRaisesRegex(RuntimeError, "systemd_backstop_required"):
                diagnostic.observe(Path("/root/diagnostic"))
        command.assert_not_called()

    def test_healthy_original_is_idempotent_without_docker_mutation(self):
        plan, rows = plan_and_rows()
        with tempfile.TemporaryDirectory() as temp:
            run_dir = Path(temp)
            (run_dir / "diagnostic-attempted").touch()
            with patch.object(diagnostic, "load_plan", return_value=plan), \
                    patch.object(diagnostic, "docker_state", return_value=rows), \
                    patch.object(diagnostic, "verify_routes"), \
                    patch.object(diagnostic.release, "command") as command:
                self.assertEqual(diagnostic.recover(run_dir), "ORIGINAL_WEB_HEALTHY")
                command.assert_not_called()

    def test_stopped_original_is_started_once_with_exact_identity(self):
        plan, rows = plan_and_rows()
        stopped = copy.deepcopy(rows)
        stopped[diagnostic.WEB]["status"] = "exited"
        stopped[diagnostic.WEB]["health"] = "none"
        with tempfile.TemporaryDirectory() as temp:
            run_dir = Path(temp)
            (run_dir / "diagnostic-attempted").touch()
            with patch.object(diagnostic, "load_plan", return_value=plan), \
                    patch.object(diagnostic, "docker_state", side_effect=[stopped, rows]), \
                    patch.object(diagnostic, "wait_web_healthy"), \
                    patch.object(diagnostic, "verify_restored"), \
                    patch.object(diagnostic, "verify_routes"), \
                    patch.object(diagnostic.release, "command") as command:
                self.assertEqual(diagnostic.recover(run_dir), "docker_start_original")
                self.assertEqual(command.call_count, 1)
                self.assertEqual(command.call_args.args[0], ["docker", "start", diagnostic.WEB])
            self.assertFalse((run_dir / "compose-fallback-used").exists())

    def test_one_cached_compose_fallback_when_direct_start_fails(self):
        plan, rows = plan_and_rows()
        stopped = copy.deepcopy(rows)
        stopped[diagnostic.WEB]["status"] = "exited"
        stopped[diagnostic.WEB]["health"] = "none"
        def command(args, **_kwargs):
            if args[:2] == ["docker", "start"]:
                raise RuntimeError("docker_start_failed")
        with tempfile.TemporaryDirectory() as temp:
            run_dir = Path(temp)
            (run_dir / "diagnostic-attempted").touch()
            with patch.object(diagnostic, "load_plan", return_value=plan), \
                    patch.object(diagnostic, "docker_state", side_effect=[stopped, stopped]), \
                    patch.object(diagnostic, "wait_web_healthy"), \
                    patch.object(diagnostic, "verify_restored"), \
                    patch.object(diagnostic, "verify_routes"), \
                    patch.object(diagnostic, "verify_sources_and_config"), \
                    patch.object(diagnostic.release, "baseline_image", return_value=plan["old_ref"]), \
                    patch.object(diagnostic.release, "command", side_effect=command) as commands:
                self.assertEqual(diagnostic.recover(run_dir), "single_compose_rollback")
                self.assertEqual(commands.call_count, 2)
                compose = commands.call_args.args[0]
                self.assertIn("--pull", compose)
                self.assertIn("never", compose)
                self.assertNotIn("pull", compose[:2])
            self.assertTrue((run_dir / "compose-fallback-used").exists())
            with patch.object(diagnostic, "load_plan", return_value=plan), \
                    patch.object(diagnostic, "docker_state", return_value=stopped):
                with self.assertRaisesRegex(RuntimeError, "recovery_repeat_blocked"):
                    diagnostic.recover(run_dir)

    def test_identity_or_unrelated_drift_blocks_recovery(self):
        plan, rows = plan_and_rows()
        rows[diagnostic.WEB]["id"] = "unexpected-id"
        rows[diagnostic.WEB]["status"] = "exited"
        with tempfile.TemporaryDirectory() as temp:
            run_dir = Path(temp)
            (run_dir / "diagnostic-attempted").touch()
            with patch.object(diagnostic, "load_plan", return_value=plan), \
                    patch.object(diagnostic, "docker_state", return_value=rows), \
                    patch.object(diagnostic.release, "command") as command:
                with self.assertRaisesRegex(RuntimeError, "original_web_identity_changed"):
                    diagnostic.recover(run_dir)
                command.assert_not_called()
        rows[diagnostic.WEB]["id"] = plan["web_id"]
        rows[TEST[0]]["status"] = "running"
        restored_drift = copy.deepcopy(rows)
        restored_drift[diagnostic.WEB]["status"] = "running"
        restored_drift[diagnostic.WEB]["health"] = "healthy"
        with tempfile.TemporaryDirectory() as temp:
            run_dir = Path(temp)
            (run_dir / "diagnostic-attempted").touch()
            with patch.object(diagnostic, "load_plan", return_value=plan), \
                    patch.object(diagnostic, "docker_state", side_effect=[rows, restored_drift]), \
                    patch.object(diagnostic, "wait_web_healthy"), \
                    patch.object(diagnostic.release, "command") as command:
                with self.assertRaisesRegex(RuntimeError, "retired_test_changed"):
                    diagnostic.recover(run_dir)
                self.assertEqual(command.call_args.args[0], ["docker", "start", diagnostic.WEB])

    def test_launcher_has_backstop_and_no_candidate_or_pull(self):
        plan, _ = plan_and_rows()
        with tempfile.TemporaryDirectory() as temp:
            run_dir = Path(temp)
            with patch.object(diagnostic, "load_plan", return_value=plan), \
                    patch.object(diagnostic.release, "command") as command, \
                    patch.object(diagnostic, "recover"), \
                    patch.object(diagnostic, "postcheck"):
                diagnostic.launch(run_dir)
                args = command.call_args.args[0]
                self.assertEqual(args[0], "systemd-run")
                self.assertTrue(any("ExecStopPost=" in part and "--recover" in part for part in args))
                self.assertTrue(any("RuntimeMaxSec=300" in part for part in args))
                self.assertNotIn("candidate", " ".join(args))
                self.assertNotIn("docker pull", " ".join(args))
            self.assertTrue((run_dir / "backstop-armed").exists())

    def test_external_backstop_resumes_with_single_fallback(self):
        plan, rows = plan_and_rows()
        rows[diagnostic.WEB]["status"] = "exited"
        rows[diagnostic.WEB]["health"] = "none"
        with tempfile.TemporaryDirectory() as temp:
            run_dir = Path(temp)
            (run_dir / "diagnostic-attempted").touch()
            (run_dir / "recovery-attempted").touch()
            with patch.object(diagnostic, "load_plan", return_value=plan), \
                    patch.object(diagnostic, "docker_state", side_effect=[rows, rows]), \
                    patch.object(diagnostic, "wait_web_healthy"), \
                    patch.object(diagnostic, "verify_restored"), \
                    patch.object(diagnostic, "verify_routes"), \
                    patch.object(diagnostic, "verify_sources_and_config"), \
                    patch.object(diagnostic.release, "baseline_image", return_value=plan["old_ref"]), \
                    patch.object(diagnostic.release, "command") as commands:
                self.assertEqual(diagnostic.recover(run_dir), "single_compose_rollback")
                self.assertEqual(commands.call_count, 1)
                self.assertEqual(commands.call_args.args[0][0:2], ["docker", "compose"])

    def test_parent_timeout_does_not_race_systemd_backstop(self):
        plan, _ = plan_and_rows()
        with tempfile.TemporaryDirectory() as temp:
            run_dir = Path(temp)
            with patch.object(diagnostic, "load_plan", return_value=plan), \
                    patch.object(diagnostic.release, "command",
                        side_effect=subprocess.TimeoutExpired("systemd-run", 540)), \
                    patch.object(diagnostic, "recover") as recover:
                with self.assertRaisesRegex(RuntimeError, "external_backstop_owns_recovery"):
                    diagnostic.launch(run_dir)
                recover.assert_not_called()

    def test_completed_compose_fallback_is_verified_without_second_rollback(self):
        plan, rows = plan_and_rows()
        rows[diagnostic.WEB]["id"] = "compose-recreated-old-image"
        with tempfile.TemporaryDirectory() as temp:
            run_dir = Path(temp)
            for name in ("diagnostic-attempted", "recovery-attempted", "compose-fallback-used"):
                (run_dir / name).touch()
            with patch.object(diagnostic, "load_plan", return_value=plan), \
                    patch.object(diagnostic, "docker_state", return_value=rows), \
                    patch.object(diagnostic, "verify_routes"), \
                    patch.object(diagnostic.release, "command") as command:
                self.assertEqual(diagnostic.recover(run_dir), "ORIGINAL_WEB_HEALTHY")
                command.assert_not_called()


if __name__ == "__main__":
    unittest.main()
