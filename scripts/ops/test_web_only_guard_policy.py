import json
import pathlib
import unittest

from web_only_guard_policy import evaluate_historical_summary, evaluate_trace


def trace(out=None, incoming=None, major=None):
    out = out or {}
    incoming = incoming or {}
    major = major or {}
    result = []
    totals = {"pswpout": 1000, "pswpin": 2000, "pgmajfault": 3000}
    for second in range(601):
        totals["pswpout"] += out.get(second, 0)
        totals["pswpin"] += incoming.get(second, 0)
        totals["pgmajfault"] += major.get(second, 0)
        result.append({
            "t": float(second),
            "mem_available_kib": 850000,
            "swap_free_kib": 1500000,
            "disk_free_mib": 11000,
            "psi_full_avg10": 0.0,
            "psi_some_avg10": 0.0,
            "oom_kill": 0,
            **totals,
        })
    return result


def checks():
    return {
        "http_failures": [],
        "container_check_start": True,
        "container_check_end": True,
        "approvals_start": [0, 0, 0],
        "approvals_end": [0, 0, 0],
        "prod_ready_latency_max_s": 0.1,
    }


class WebOnlyPolicyTest(unittest.TestCase):
    def test_sparse_low_swap_can_pass_when_all_evidence_exists(self):
        result = evaluate_trace(trace(out={10: 6, 180: 6, 360: 6}, incoming={11: 1}, major={15: 1}), checks())
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["deltas"]["pswpout"], 18)

    def test_rolling_60_second_burst_fails(self):
        result = evaluate_trace(trace(out={40: 33}), checks())
        self.assertIn("swap_out_limit", result["reasons"])

    def test_total_600_second_swap_fails(self):
        result = evaluate_trace(trace(out={20: 13, 100: 13, 180: 13, 260: 13, 340: 13}), checks())
        self.assertIn("swap_out_limit", result["reasons"])

    def test_sustained_swap_out_fails_even_below_total_limit(self):
        result = evaluate_trace(trace(out={10: 1, 70: 1, 130: 1}), checks())
        self.assertIn("sustained_swap_out", result["reasons"])

    def test_sustained_bidirectional_swap_fails(self):
        result = evaluate_trace(trace(out={10: 1, 70: 1}, incoming={11: 1, 71: 1}), checks())
        self.assertIn("sustained_swap_in_out", result["reasons"])

    def test_major_fault_and_psi_some_fails(self):
        samples = trace(major={40: 65})
        samples[40]["psi_some_avg10"] = 2.0
        result = evaluate_trace(samples, checks())
        self.assertIn("major_fault_limit", result["reasons"])
        self.assertIn("psi_some", result["reasons"])

    def test_ram_oom_health_approval_and_latency_fail_closed(self):
        samples = trace(out={20: 1})
        samples[50]["mem_available_kib"] = 819199
        for row in samples[300:]:
            row["oom_kill"] = 1
        external = checks()
        external["http_failures"] = [{"route": "prod_ready", "status": 503}]
        external["approvals_end"] = [1, 0, 0]
        external["prod_ready_latency_max_s"] = 0.6
        result = evaluate_trace(samples, external)
        for reason in ("mem_available_floor", "oom", "http_health", "active_approval_or_commit", "swap_with_prod_latency"):
            self.assertIn(reason, result["reasons"])

    def test_missing_metric_short_interval_and_gap_fail_closed(self):
        samples = trace()
        del samples[100]["pgmajfault"]
        self.assertEqual(evaluate_trace(samples, checks())["status"], "FAIL")
        samples = trace()[:500]
        self.assertIn("short_interval", evaluate_trace(samples, checks())["reasons"])
        samples = trace()
        samples[200]["t"] = 210.0
        self.assertIn("sample_gap_or_clock_error", evaluate_trace(samples, checks())["reasons"])

    def test_all_recorded_history_is_classified_without_false_pass(self):
        path = pathlib.Path(__file__).parent / "fixtures" / "web_only_guard_history_20261016.json"
        records = json.loads(path.read_text())
        self.assertEqual(len(records), 5)
        for record in records:
            with self.subTest(record=record["id"]):
                self.assertEqual(evaluate_historical_summary(record)["status"], record["expected"])


if __name__ == "__main__":
    unittest.main()
