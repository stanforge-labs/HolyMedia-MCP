"""Offline historical-boundary and fail-closed tests for opt-in V2."""

import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import production_only_guard_policy as v1  # noqa: E402
import production_only_guard_policy_v2 as v2  # noqa: E402
import production_only_release_once as release  # noqa: E402
import production_only_resource_guard_v2 as guard_v2  # noqa: E402
import startup_watch_policy_v2 as startup  # noqa: E402
import startup_watch_v2 as startup_runtime  # noqa: E402
from test_production_only_guard import fixture  # noqa: E402


def complete_fixture():
    samples, events, checkpoint = fixture()
    for sample in samples:
        sample["pgscan_direct"] = 100
    for event in events:
        event["checked_t"] = event["t"] + 0.1
    return samples, events, checkpoint


def old_stop_sample(t, **changes):
    sample = dict(t=float(t), mem_available_kib=1000000,
                  swap_free_kib=1000000, disk_free_mib=12000,
                  psi_full_avg10=0.0, psi_some_avg10=0.0,
                  pswpout=0, pswpin=0, pgmajfault=0,
                  oom_kill=0, pgscan_direct=0)
    sample.update(changes)
    return sample


class V2GuardTests(unittest.TestCase):
    def test_clean_v1_and_v2_pass_without_warning(self):
        s, e, c = complete_fixture()
        self.assertEqual(v1.evaluate_trace(s, e, c)["status"], "PASS")
        for phase in ("precutover", "poststart"):
            result = v2.evaluate_trace(s, e, c, phase=phase)
            self.assertEqual(result["status"], "PASS")
            self.assertEqual(result["warnings"], [])
            self.assertEqual(result["duration_exact_s"], 600)

    def test_isolated_90_page_swap_out_only_pre_guard_warning(self):
        s, e, c = complete_fixture()
        for sample in s[47:]:
            sample["pswpout"] = 90
        for event in e[4:]:
            event["swap_out_delta"] = 90
        self.assertEqual(v1.evaluate_trace(s, e, c)["status"], "FAIL")
        result = v2.evaluate_trace(s, e, c, phase="precutover")
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["isolated_swap_out"]["pages"], 90)
        self.assertIn("swap_out_60s", result["warnings"])
        self.assertIn("swap_out_600s", result["warnings"])
        self.assertEqual(v2.evaluate_trace(s, e, c, phase="poststart")["status"], "FAIL")

    def test_historical_93_seconds_remains_fail_without_post_event_check(self):
        s, e, c = complete_fixture()
        del s[47:]
        s[-1]["t"] = 93.48367840703577
        s[-1]["pswpout"] = 90
        del e[4:]
        for event in e:
            event.pop("checked_t")
        result = v2.evaluate_trace(s, e, c, phase="precutover")
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("observation_incomplete", result["reasons"])
        self.assertIn("isolated_swap_out_unconfirmed", result["reasons"])

    def test_missing_post_event_check_or_reclaim_evidence_fails(self):
        for defect in ("post_event", "reclaim", "counter"):
            with self.subTest(defect=defect):
                s, e, c = complete_fixture()
                for sample in s[47:]:
                    sample["pswpout"] = 90
                if defect == "post_event":
                    for event in e:
                        event.pop("checked_t")
                elif defect == "reclaim":
                    s[80].pop("pgscan_direct")
                else:
                    s[80].pop("pswpout")
                result = v2.evaluate_trace(s, e, c, phase="precutover")
                self.assertEqual(result["status"], "FAIL")

    def test_pressure_http_and_incomplete_conditions_remain_hard(self):
        cases = (
            ("oom", lambda s, e: [r.__setitem__("oom_kill", 1) for r in s[48:]], "oom_kill"),
            ("psi", lambda s, e: s[48].__setitem__("psi_full_avg10", 1.5), "psi_full_avg10_limit"),
            ("memory", lambda s, e: s[48].__setitem__("mem_available_kib", 819199), "mem_available_kib_floor"),
            ("swap_floor", lambda s, e: s[48].__setitem__("swap_free_kib", 262143), "swap_free_kib_floor"),
            ("reclaim", lambda s, e: [r.__setitem__("pgscan_direct", 101) for r in s[48:]], "direct_reclaim_detected"),
            ("http", lambda s, e: e[5]["http"]["ready"].__setitem__("status", 503), "ready_http_status"),
            ("duration", lambda s, e: (s.pop(), e.pop()), "observation_incomplete"),
        )
        for name, mutate, expected in cases:
            with self.subTest(name=name):
                s, e, c = complete_fixture()
                for sample in s[47:]:
                    sample["pswpout"] = 90
                mutate(s, e)
                result = v2.evaluate_trace(s, e, c, phase="precutover")
                self.assertEqual(result["status"], "FAIL")
                self.assertIn(expected, result["reasons"])

    def test_repeated_or_large_swap_is_never_waived(self):
        for mode in ("repeated", "large", "mixed"):
            with self.subTest(mode=mode):
                s, e, c = complete_fixture()
                for sample in s[47:]:
                    sample["pswpout"] = 90
                if mode == "repeated":
                    for sample in s[100:]:
                        sample["pswpout"] = 100
                if mode == "large":
                    for sample in s[47:]:
                        sample["pswpout"] = 257
                if mode == "mixed":
                    for sample in s[100:]:
                        sample["pswpin"] = 1
                result = v2.evaluate_trace(s, e, c, phase="precutover")
                self.assertEqual(result["status"], "FAIL")

    def test_runtime_keeps_sampling_after_trigger_until_full_600_and_http(self):
        samples, events, checkpoint = complete_fixture()
        now = [0.0]

        def clock(): return now[0]
        def sleep(seconds): now[0] += seconds
        def host_sample(start):
            return {**samples[0], "t": now[0] - start,
                    "pswpout": 90 if now[0] >= 92 else 0}

        trace = io.StringIO()
        with patch.object(guard_v2.time, "monotonic", side_effect=clock), \
                patch.object(guard_v2.time, "sleep", side_effect=sleep), \
                patch.object(guard_v2, "host_sample", side_effect=host_sample), \
                patch.object(guard_v2, "docker_state", return_value=events[0]["containers"]), \
                patch.object(guard_v2, "probe_http", return_value=events[0]["http"]), \
                patch.object(guard_v2.urllib.request, "build_opener", return_value=object()):
            result = guard_v2.observe(checkpoint, trace, phase="precutover")
        records = [json.loads(line) for line in trace.getvalue().splitlines()]
        self.assertEqual(result["status"], "PASS")
        self.assertIn("swap_out_60s", result["warnings"])
        self.assertGreaterEqual(result["duration_exact_s"], 600)
        self.assertGreater(records[-2]["checked_t"], 92)


class V2StartupTests(unittest.TestCase):
    def test_old_web_stop_historical_magnitudes_can_be_warning_only_with_new_evidence(self):
        for pages, faults in ((583, 380), (631, 415)):
            with self.subTest(pages=pages):
                state = startup.State(old_stop_sample(0))
                self.assertEqual(state.update(old_stop_sample(1, pswpin=pages,
                                    pgmajfault=faults), "stopping-old"), [])
                self.assertEqual(state.update(old_stop_sample(2, pswpin=pages,
                                    pgmajfault=faults), "old-stopped"), [])
                self.assertFalse(state.old_cleared)
                self.assertEqual(state.update(old_stop_sample(3, pswpin=pages,
                                    pgmajfault=faults), "old-stopped"), [])
                self.assertTrue(state.old_cleared)
                self.assertEqual(state.warnings, ["isolated_swap_in_during_old_web_stop"])
                self.assertEqual(state.update(old_stop_sample(4, pswpin=pages,
                                    pgmajfault=faults), "starting-candidate"), [])
                self.assertEqual(state.update(old_stop_sample(5, pswpin=pages,
                                    pgmajfault=faults), "candidate-running"), [])

    def test_old_stop_fail_closed_for_real_pressure_or_missing_stability(self):
        for change, expected in (({"oom_kill": 1}, "oom"),
                                 ({"psi_full_avg10": 1.5}, "psi_full"),
                                 ({"mem_available_kib": 819199}, "mem_floor"),
                                 ({"pgscan_direct": 1}, "direct_reclaim"),
                                 ({"pswpin": 1025}, "old_stop_swap_in_ceiling"),
                                 ({"pswpin": 583, "pgmajfault": 513}, "old_stop_major_faults_ceiling")):
            with self.subTest(change=change):
                state = startup.State(old_stop_sample(0))
                self.assertIn(expected, state.update(old_stop_sample(1, **change),
                                                    "stopping-old"))
        state = startup.State(old_stop_sample(0))
        state.update(old_stop_sample(1, pswpin=583, pgmajfault=380), "stopping-old")
        self.assertIn("old_stop_evidence_missing", state.update(
            old_stop_sample(2, pswpin=583, pgmajfault=380), "starting-candidate"))

    def test_candidate_swap_in_not_waived_and_api_old_stop_strict(self):
        state = startup.State(old_stop_sample(0))
        state.update(old_stop_sample(1, pswpin=583, pgmajfault=380), "stopping-old")
        state.update(old_stop_sample(2, pswpin=583, pgmajfault=380), "old-stopped")
        state.update(old_stop_sample(3, pswpin=583, pgmajfault=380), "old-stopped")
        state.update(old_stop_sample(4, pswpin=583, pgmajfault=380), "starting-candidate")
        self.assertIn("swap_in", state.update(old_stop_sample(5, pswpin=616,
                            pgmajfault=380), "candidate-running"))
        api = startup.State(old_stop_sample(0), allow_old_stop_swapin=False)
        self.assertIn("swap_in", api.update(old_stop_sample(1, pswpin=583), "stopping-old"))

    def test_burst_before_candidate_arming_and_unarmed_candidate_fail(self):
        for phase, expected in (("starting-candidate", "swap_in_before_candidate_armed"),
                                ("candidate-running", "candidate_phase_unarmed")):
            with self.subTest(phase=phase):
                state = startup.State(old_stop_sample(0))
                state.update(old_stop_sample(1, pswpin=583, pgmajfault=380), "stopping-old")
                state.update(old_stop_sample(2, pswpin=583, pgmajfault=380), "old-stopped")
                state.update(old_stop_sample(3, pswpin=583, pgmajfault=380), "old-stopped")
                self.assertIn(expected, state.update(old_stop_sample(4, pswpin=616,
                                      pgmajfault=380), phase))

    def test_repeated_swap_out_and_missing_counter_fail(self):
        state = startup.State(old_stop_sample(0))
        self.assertEqual(state.update(old_stop_sample(1, pswpout=1), "before-stop"), [])
        self.assertEqual(state.update(old_stop_sample(2, pswpout=1), "before-stop"), [])
        self.assertIn("sustained_or_repeated_swap_out", state.update(
            old_stop_sample(3, pswpout=2), "before-stop"))
        state = startup.State(old_stop_sample(0))
        missing = old_stop_sample(1)
        missing.pop("pgscan_direct")
        self.assertIn("evidence_missing:pgscan_direct", state.update(missing,
                                                                       "stopping-old"))

    def test_runtime_requires_phase_handshakes_and_full_180_seconds(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            directory.chmod(0o700)
            now = [0.0]

            def clock():
                return now[0]

            def sleep(seconds):
                now[0] += seconds
                markers = {1: "stopping-old", 2: "old-stopped",
                           4: "starting-candidate", 5: "candidate-running"}
                marker = markers.get(round(now[0]))
                if marker and abs(now[0] - round(now[0])) < 0.001:
                    (directory / f"web-phase.{marker}").touch()

            def host_sample(_start):
                values = {"pswpin": 583, "pgmajfault": 380} if now[0] >= 1 else {}
                return old_stop_sample(now[0], **values)

            with patch.object(startup_runtime.time, "monotonic", side_effect=clock), \
                    patch.object(startup_runtime.time, "time", side_effect=clock), \
                    patch.object(startup_runtime.time, "sleep", side_effect=sleep), \
                    patch.object(startup_runtime, "host_sample", side_effect=host_sample):
                result = startup_runtime.run(directory, "web")
            self.assertEqual(result["status"], "PASS")
            self.assertGreaterEqual(result["duration_exact_s"], 180)
            self.assertEqual(result["warnings"], ["isolated_swap_in_during_old_web_stop"])
            self.assertTrue((directory / "startup-watch.old-stop-cleared").exists())
            self.assertTrue((directory / "startup-watch.candidate-armed").exists())
            self.assertFalse((directory / "startup-watch.fail").exists())


class V2AdapterTests(unittest.TestCase):
    def test_v1_default_v2_requires_explicit_prepare_and_complete_sources(self):
        self.assertEqual(release.V1_PROFILE, "PRODUCTION_ONLY_V1")
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            plan = {"service": "web", "candidate_digest": release.CANDIDATES["web"][0],
                    "candidate_revision": release.CANDIDATES["web"][1],
                    "guard_profile": v2.PROFILE, "source_sha256": {},
                    "config_sha256": {}}
            with self.assertRaisesRegex(RuntimeError, "v2_release_sources_missing"):
                release.verify_plan(plan, directory)

    def test_explicit_v2_prepare_stages_only_local_opt_in_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            config = base / "compose.yml"
            config.write_text("services: {}\n")
            _, events, checkpoint = fixture()
            rows = events[0]["containers"]
            rows["holymedia-v2-web-1"]["image"] = release.BASELINE_ID
            with patch.object(release, "CONFIGS", {"base-compose.yml": config}), \
                    patch.object(release, "load_checkpoint", return_value=checkpoint), \
                    patch.object(release, "docker_state", return_value=rows), \
                    patch.object(release, "pending_operations", return_value=[0] * 6), \
                    patch.object(release, "baseline_image", return_value="ghcr.io/example@sha256:old"), \
                    patch.object(release, "candidate_image", return_value="ghcr.io/example@sha256:new"), \
                    patch.object(release, "image_document", return_value={"Id": "sha256:new"}), \
                    patch.object(release.legacy, "immediate", return_value={"disk_mib": 11704}), \
                    patch.object(release.legacy, "ensure_immediate_preflight"), \
                    patch.object(release.legacy, "sha", return_value=release.legacy.WATCH_SHA), \
                    patch.object(release, "command") as command:
                run = base / "run"
                plan = release.prepare("web", run, profile=v2.PROFILE)
            command.assert_not_called()
            self.assertEqual(plan["guard_profile"], v2.PROFILE)
            self.assertTrue(set(release.V2_SOURCES) <= set(plan["source_sha256"]))
            for name in release.V2_SOURCES:
                self.assertEqual((run / name).stat().st_mode & 0o777, 0o600)
            self.assertIn("pull_policy: never", (run / "new-web.yml").read_text())

    def test_failed_old_stop_handshake_blocks_candidate_and_rolls_back_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "production-only-plan.json").write_text(json.dumps({
                "service": "web", "guard_profile": v2.PROFILE,
                "test_checkpoint": {}}))
            (directory / "startup-watch.ready").touch()

            class Watcher:
                returncode = None
                def poll(self): return None
                def terminate(self): pass
                def wait(self, timeout=None): return 0

            def handshake(_watcher, _directory, marker, **_kwargs):
                self.assertEqual(marker, "startup-watch.old-stop-cleared")
                raise RuntimeError("startup_v2_handshake_timeout")

            with patch.object(release, "verify_plan"), \
                    patch.object(release, "guard"), \
                    patch.object(release.legacy, "immediate", return_value={}), \
                    patch.object(release.legacy, "ensure_immediate_preflight"), \
                    patch.object(release.subprocess, "Popen", return_value=Watcher()), \
                    patch.object(release, "command"), \
                    patch.object(release, "docker_state", return_value={
                        "holymedia-v2-web-1": {"status": "exited"}}), \
                    patch.object(release, "wait_v2_handshake", side_effect=handshake), \
                    patch.object(release, "compose_replace") as compose, \
                    patch.object(release.subprocess, "run", return_value=type(
                        "Result", (), {"returncode": 0})()) as rollback:
                with self.assertRaisesRegex(RuntimeError, "startup_v2_handshake_timeout"):
                    release.execute(directory)
            compose.assert_not_called()
            rollback.assert_called_once()
            self.assertFalse((directory / "web-start.begin").exists())


if __name__ == "__main__":
    unittest.main()
