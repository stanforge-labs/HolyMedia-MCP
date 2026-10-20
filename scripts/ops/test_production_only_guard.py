"""Offline regression of the five-service guard and exact resource ceilings."""

import importlib.util
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
