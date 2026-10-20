"""Offline passive-watch regressions; no Docker, SSH or production access."""

from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import production_web_swap_probe as probe  # noqa: E402
import production_web_passive_swap_watch as watch  # noqa: E402


def snapshot(t, swap_out=0, *, gone=False):
    return {"epoch": t, "monotonic": float(t), "phase": "passive",
            "host": {"vm": {"pswpout": swap_out, "pswpin": 0, "pgmajfault": 0,
                            "oom_kill": 0, "pgscan_direct": 0, "pgscan_kswapd": 0},
                     "mem": {"MemAvailable": 1100000, "SwapFree": 1600000},
                     "psi": {"some": {"avg10": 0, "total_us": 0},
                             "full": {"avg10": 0, "total_us": 0}}},
            "pids": {"11": {"gone": True} if gone else
                     {"start_ticks": 10, "major_faults": 0,
                      "vm_swap_kib": 4, "cgroup": "/system.slice/web.scope"}},
            "cgroups": {"/system.slice/web.scope":
                        {"gone": True} if gone else
                        {"swap_bytes": swap_out * 4096, "pgscan": swap_out,
                         "pgsteal": swap_out}}}


class PassiveProbeTests(unittest.TestCase):
    def test_selection_covers_process_groups_and_records_omissions(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for pid in (11, 12, 13):
                (root / str(pid)).mkdir()

            def info(pid):
                return {"pid": pid, "start_ticks": pid,
                        "name": "node" if pid == 11 else "worker",
                        "vm_swap_kib": pid, "cgroup": "/system.slice/app.scope"}

            with patch.object(probe, "PROC", root), patch.object(
                    probe, "process_info", side_effect=info), patch.object(
                        probe, "MAX_PASSIVE_PIDS", 2):
                selected = probe.select_passive()
            self.assertEqual(selected["coverage"], {
                "attempted_pids": 3, "skipped_pids": 0,
                "discovered_pids": 3, "selected_pids": 2,
                "discovered_cgroups": 3, "selected_cgroups": 3})
            self.assertEqual(set(selected["pids"]), {"12", "13"})
            self.assertEqual(set(selected["cgroups"]), {"/", "/system.slice",
                                                      "/system.slice/app.scope"})

    def test_bounded_groups_keep_broad_slice_and_report_omissions(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for pid in (11, 12, 13, 14):
                (root / str(pid)).mkdir()

            def info(pid):
                return {"pid": pid, "start_ticks": pid, "name": "worker",
                        "vm_swap_kib": 0,
                        "cgroup": f"/system.slice/app-{pid}.scope"}

            with patch.object(probe, "PROC", root), patch.object(
                    probe, "process_info", side_effect=info), patch.object(
                        probe, "MAX_PASSIVE_GROUPS", 2):
                selected = probe.select_passive()
            self.assertEqual(selected["coverage"]["discovered_cgroups"], 6)
            self.assertEqual(selected["coverage"]["selected_cgroups"], 2)
            self.assertIn("/system.slice", selected["cgroups"])

    def test_correlations_do_not_claim_causality_or_reused_pid(self):
        a, b = snapshot(0), snapshot(1, 90)
        correlated = probe.correlate(a, b)
        self.assertEqual(correlated["host"]["pswpout"], 90)
        self.assertEqual(correlated["cgroups"]["/system.slice/web.scope"][
            "swap_bytes"], 90 * 4096)
        self.assertEqual(correlated["attribution"], "correlation_only")
        b["pids"]["11"]["start_ticks"] = 99
        b["cgroups"]["/system.slice/web.scope"] = {"gone": True}
        correlated = probe.correlate(a, b)
        self.assertEqual(correlated["pids"], {})
        self.assertEqual(correlated["cgroups"], {})
        self.assertEqual(correlated["missing"], [
            "cgroup:/system.slice/web.scope", "pid:11"])


class PassiveWatchTests(unittest.TestCase):
    def test_bounded_watch_writes_protected_correlative_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            selection = {"pids": {}, "cgroups": [], "coverage": {
                "discovered_pids": 0, "selected_pids": 0, "discovered_cgroups": 0}}
            taken = []

            def capture(_selection, _phase):
                i = len(taken)
                taken.append(i)
                return snapshot(i, 90 if i >= 20 else 0)

            with patch.object(watch, "ROOT", root), patch.object(
                    watch, "prepare_output", side_effect=lambda path: path.mkdir()), patch.object(
                    watch.probe, "select_passive", return_value=selection), patch.object(
                        watch.probe, "benchmark", return_value={
                            "p95_ms": 3, "max_ms": 4}), patch.object(
                                watch.probe, "capture", side_effect=capture):
                result = watch.observe(root / "run", 30,
                                       clock=lambda: len(taken), sleep=lambda _: None)
            self.assertEqual(result["status"], "COMPLETE")
            self.assertEqual(result["duration_exact_s"], 30)
            self.assertEqual(result["samples"], 31)
            self.assertEqual(len(result["swap_out_events"]), 1)
            self.assertEqual(result["swap_out_events"][0]["host"]["pswpout"], 90)
            self.assertEqual(result["attribution"], "correlation_only")
            self.assertTrue((root / "run" / "passive-trace.jsonl").is_file())

    def test_overhead_refusal_prevents_sampling(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with patch.object(watch, "ROOT", root), patch.object(
                    watch, "prepare_output", side_effect=lambda path: path.mkdir()), patch.object(
                    watch.probe, "select_passive", return_value={
                        "pids": {}, "cgroups": [], "coverage": {}}), patch.object(
                            watch.probe, "benchmark", return_value={
                                "p95_ms": 21, "max_ms": 22}), patch.object(
                                    watch.probe, "capture") as capture:
                result = watch.observe(root / "run", 30)
            self.assertEqual(result["status"], "INCOMPLETE")
            self.assertIn("probe_overhead_too_high", result["reason"])
            capture.assert_not_called()
            self.assertFalse((root / "run" / "passive-trace.jsonl").exists())

    def test_invalid_duration_refused_before_output(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "run"
            with self.assertRaisesRegex(ValueError, "duration_out_of_bounds"):
                watch.observe(path, 600)
            self.assertFalse(path.exists())

    def test_lost_sample_is_incomplete_not_release_pass(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            taken = []

            def capture(_selection, _phase):
                i = len(taken)
                taken.append(i)
                return snapshot(i if i < 15 else i + 4)

            with patch.object(watch, "ROOT", root), patch.object(
                    watch, "prepare_output", side_effect=lambda path: path.mkdir()), patch.object(
                        watch.probe, "select_passive", return_value={
                            "pids": {}, "cgroups": [], "coverage": {}}), patch.object(
                                watch.probe, "benchmark", return_value={
                                    "p95_ms": 3, "max_ms": 4}), patch.object(
                                        watch.probe, "capture", side_effect=capture):
                result = watch.observe(root / "run", 30,
                                       clock=lambda: len(taken), sleep=lambda _: None)
            self.assertEqual(result["status"], "INCOMPLETE")
            self.assertEqual(result["reason"], "sample_gap_duration_or_counter_reset")

    def test_capture_failure_retains_incomplete_result(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with patch.object(watch, "ROOT", root), patch.object(
                    watch, "prepare_output", side_effect=lambda path: path.mkdir()), patch.object(
                        watch.probe, "select_passive", return_value={
                            "pids": {}, "cgroups": [], "coverage": {}}), patch.object(
                                watch.probe, "benchmark", return_value={
                                    "p95_ms": 3, "max_ms": 4}), patch.object(
                                        watch.probe, "capture", side_effect=OSError("proc unavailable")):
                result = watch.observe(root / "run", 30)
            self.assertEqual(result["status"], "INCOMPLETE")
            self.assertTrue((root / "run" / "result.json").is_file())

    def test_host_counter_reset_is_incomplete(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            taken = []

            def capture(_selection, _phase):
                i = len(taken)
                taken.append(i)
                return snapshot(i, 90 if 10 <= i < 20 else 0)

            with patch.object(watch, "ROOT", root), patch.object(
                    watch, "prepare_output", side_effect=lambda path: path.mkdir()), patch.object(
                        watch.probe, "select_passive", return_value={
                            "pids": {}, "cgroups": [], "coverage": {}}), patch.object(
                                watch.probe, "benchmark", return_value={
                                    "p95_ms": 3, "max_ms": 4}), patch.object(
                                        watch.probe, "capture", side_effect=capture):
                result = watch.observe(root / "run", 30,
                                       clock=lambda: len(taken), sleep=lambda _: None)
            self.assertEqual(result["status"], "INCOMPLETE")
            self.assertEqual(result["reason"], "sample_gap_duration_or_counter_reset")


if __name__ == "__main__":
    unittest.main()
