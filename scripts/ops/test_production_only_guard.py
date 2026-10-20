"""Offline regression of the five-service guard and exact resource ceilings."""

import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import production_only_guard_policy as policy  # noqa: E402
import production_only_resource_guard as guard  # noqa: E402
import web_only_guard_policy as historical  # noqa: E402


def row(status="running", health="healthy", restart="unless-stopped"):
    return dict(id="id", image="sha256:image", status=status, health=health,
                restart=restart, restarts=0, oom=False)


def fixture():
    checkpoint = {name: {"id": "id", "image": "sha256:image"} for name in policy.TEST}
    rows = {name: row() for name in policy.PROD}
    rows.update({name: row("exited", "none", "no") for name in policy.TEST})
    samples = [dict(t=float(i * 2), mem_available_kib=1000000,
                    swap_free_kib=1000000, disk_free_mib=12000,
                    psi_full_avg10=0.0, psi_some_avg10=0.0,
                    pswpout=0, pswpin=0, pgmajfault=0, oom_kill=0)
               for i in range(301)]
    probes = {name: {"status": 200, "duration_s": 0.1, "error": None}
              for name in ("health", "ready")}
    observations = [dict(t=float(i * 30), containers=rows, http=probes,
                         swap_out_delta=0) for i in range(21)]
    return samples, observations, checkpoint


class GuardTests(unittest.TestCase):
    def assert_fail(self, mutate, reason):
        samples, events, checkpoint = fixture()
        mutate(samples, events, checkpoint)
        result = policy.evaluate_trace(samples, events, checkpoint)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn(reason, result["reasons"])

    def test_five_healthy_four_retired_and_full_duration(self):
        samples, events, checkpoint = fixture()
        self.assertEqual(policy.evaluate_trace(samples, events, checkpoint)["status"], "PASS")
        self.assertEqual(policy.LIMITS["duration_s"], 600)
        self.assertEqual(policy.LIMITS["mem_available_kib"], 819200)
        self.assertEqual(policy.LIMITS["disk_free_mib"], 10240)
        self.assertEqual(policy.LIMITS, historical.LIMITS)

    def test_exact_duration_boundary_never_uses_rounded_value(self):
        for duration, expected in ((599.999737, "FAIL"), (600.0, "PASS"),
                                   (600.000263, "PASS")):
            with self.subTest(duration=duration):
                samples, events, checkpoint = fixture()
                samples[-1]["t"] = duration
                events[-1]["t"] = duration
                result = policy.evaluate_trace(samples, events, checkpoint)
                self.assertEqual(result["status"], expected)
                self.assertEqual(result["duration_exact_s"], duration)
                if expected == "FAIL":
                    self.assertEqual(result["duration_s"], 600.0)
                    self.assertIn("observation_incomplete", result["reasons"])

    def run_observe_with_clock(self, *, fail_final_docker=False, fail_final_http=False):
        class Clock:
            now = 0.0
            near_miss = False

            def monotonic(self):
                return self.now

            def sleep(self, seconds):
                target = self.now + seconds
                if not self.near_miss and target >= 600.000857:
                    self.now = 600.000594
                    self.near_miss = True
                else:
                    self.now = target

        clock = Clock()
        samples, events, checkpoint = fixture()
        template = samples[0]
        rows = events[0]["containers"]
        probes = events[0]["http"]

        def host_sample(start):
            if clock.now == 0:
                clock.now = 0.000857
            return {**template, "t": clock.now - start}

        def docker_state():
            if fail_final_docker and clock.now >= 600.000857:
                changed = {name: value.copy() for name, value in rows.items()}
                changed[policy.TEST[0]]["status"] = "running"
                return changed
            return rows

        def probe_http(_opener):
            if fail_final_http and clock.now >= 600.000857:
                changed = {name: value.copy() for name, value in probes.items()}
                changed["ready"]["status"] = 503
                return changed
            return probes

        trace = io.StringIO()
        with patch.object(guard.time, "monotonic", side_effect=clock.monotonic), \
                patch.object(guard.time, "sleep", side_effect=clock.sleep), \
                patch.object(guard, "host_sample", side_effect=host_sample), \
                patch.object(guard, "docker_state", side_effect=docker_state), \
                patch.object(guard, "probe_http", side_effect=probe_http), \
                patch.object(guard.urllib.request, "build_opener", return_value=object()):
            result = guard.observe(checkpoint, trace)
        return result, [json.loads(line) for line in trace.getvalue().splitlines()]

    def test_observer_waits_for_full_recorded_interval_and_final_check(self):
        result, trace = self.run_observe_with_clock()
        recorded = [event["t"] for event in trace if event["type"] == "sample"]
        self.assertTrue(any(0 < t - recorded[0] < 600 for t in recorded if t >= 600))
        self.assertGreaterEqual(recorded[-1] - recorded[0], 600)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["duration_exact_s"], recorded[-1] - recorded[0])
        self.assertEqual(trace[-2]["type"], "external")
        self.assertEqual(trace[-2]["t"], recorded[-1])
        self.assertEqual(trace[-1]["duration_exact_s"], result["duration_exact_s"])

    def test_final_docker_and_http_checks_cannot_be_skipped(self):
        for failure, reason in (("fail_final_docker", "test_not_stopped:" + policy.TEST[0]),
                                ("fail_final_http", "ready_http_status")):
            with self.subTest(failure=failure):
                result, trace = self.run_observe_with_clock(**{failure: True})
                self.assertEqual(result["status"], "FAIL")
                self.assertIn(reason, result["reasons"])
                self.assertGreaterEqual(trace[-2]["t"], 600)

    def test_unexpected_running_test_and_identity_change(self):
        self.assert_fail(lambda s, e, c: e[4]["containers"].__setitem__(
            policy.TEST[0], row()), "test_not_stopped:" + policy.TEST[0])
        self.assert_fail(lambda s, e, c: e[4]["containers"][policy.TEST[0]].__setitem__(
            "id", "other"), "test_identity_changed:" + policy.TEST[0])
        self.assert_fail(lambda s, e, c: e[4]["containers"][policy.TEST[0]].__setitem__(
            "restart", "unless-stopped"), "test_not_stopped:" + policy.TEST[0])

    def test_production_unhealthy_oom_and_restart(self):
        self.assert_fail(lambda s, e, c: e[4]["containers"][policy.PROD[0]].__setitem__(
            "health", "unhealthy"), "container_unhealthy:" + policy.PROD[0])
        self.assert_fail(lambda s, e, c: e[4]["containers"][policy.PROD[0]].__setitem__(
            "oom", True), "container_oom:" + policy.PROD[0])
        samples, events, checkpoint = fixture()
        events[4]["containers"] = {name: dict(value) for name, value in events[4]["containers"].items()}
        events[4]["containers"][policy.PROD[0]]["restarts"] = 1
        result = policy.evaluate_trace(samples, events, checkpoint)
        self.assertIn("container_changed:" + policy.PROD[0], result["reasons"])

    def test_slow_health_separate_from_fast_ready(self):
        self.assert_fail(lambda s, e, c: e[3]["http"]["health"].__setitem__(
            "duration_s", 0.801), "health_latency")
        samples, events, checkpoint = fixture()
        events[3]["http"]["health"]["duration_s"] = 0.801
        self.assertNotIn("ready_latency", policy.evaluate_trace(samples, events, checkpoint)["reasons"])

    def test_slow_ready_status_and_timeout(self):
        self.assert_fail(lambda s, e, c: e[3]["http"]["ready"].__setitem__(
            "duration_s", 0.8), "ready_latency")
        self.assert_fail(lambda s, e, c: e[3]["http"]["health"].__setitem__(
            "status", 503), "health_http_status")
        self.assert_fail(lambda s, e, c: e[3]["http"]["ready"].__setitem__(
            "error", "timeout"), "ready_timeout")

    def test_resources_fail_at_original_limits(self):
        cases = (("pswpout", 65, "swap_out_600s"),
                 ("pswpin", 65, "swap_in_600s"),
                 ("pgmajfault", 257, "major_faults_600s"),
                 ("oom_kill", 1, "oom_kill"),
                 ("mem_available_kib", 819199, "mem_available_kib_floor"),
                 ("swap_free_kib", 262143, "swap_free_kib_floor"),
                 ("disk_free_mib", 10239, "disk_free_mib_floor"),
                 ("psi_full_avg10", 1.5, "psi_full_avg10_limit"),
                 ("psi_some_avg10", 2.0, "psi_some_avg10_limit"))
        for key, value, reason in cases:
            with self.subTest(key=key):
                if key in ("pswpout", "pswpin", "pgmajfault", "oom_kill"):
                    self.assert_fail(lambda s, e, c: [r.__setitem__(key, value) for r in s[150:]], reason)
                else:
                    self.assert_fail(lambda s, e, c: s[150].__setitem__(key, value), reason)

    def test_rolling_swap_and_sustained_pressure(self):
        self.assert_fail(lambda s, e, c: [r.__setitem__("pswpout", 33) for r in s[150:]],
                         "swap_out_60s")
        def sustained(samples, events, checkpoint):
            for row in samples:
                if row["t"] >= 61:
                    row["pswpout"] = 1
                if row["t"] >= 121:
                    row["pswpout"] = 2
                if row["t"] >= 181:
                    row["pswpout"] = 3
        self.assert_fail(sustained, "sustained_swap_out")

    def test_incomplete_and_gap_fail(self):
        self.assert_fail(lambda s, e, c: s.pop(), "observation_incomplete")
        self.assert_fail(lambda s, e, c: e.pop(), "external_observation_incomplete")
        self.assert_fail(lambda s, e, c: e[4].__setitem__("t", 200), "external_observation_gap")
        self.assert_fail(lambda s, e, c: s[100].pop("pswpin"), "observation_incomplete")
        self.assert_fail(lambda s, e, c: s[100].__setitem__("t", 95), "sample_gap_or_clock_error")

    def test_http_probe_clocks_are_independent(self):
        class FakeResponse:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, *_): return b"x"
        class FakeOpener:
            def open(self, *_args, **_kwargs): return FakeResponse()
        with patch.object(guard.time, "monotonic", side_effect=[0, 0.4, 10, 10.1]):
            result = guard.probe_http(FakeOpener())
        self.assertAlmostEqual(result["health"]["duration_s"], 0.4)
        self.assertAlmostEqual(result["ready"]["duration_s"], 0.1)


if __name__ == "__main__":
    unittest.main()
