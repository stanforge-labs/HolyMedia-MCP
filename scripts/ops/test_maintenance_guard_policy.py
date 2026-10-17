"""Offline regression for the TEST-off phase; no VPS or Docker access."""

import unittest

from batch2_test_maintenance_guard import phase_evaluate_trace, phase_immediate_reasons
from maintenance_guard_policy import evaluate_trace, immediate_reasons
from web_only_guard_policy import evaluate_trace as evaluate_full_trace


def trace(*, incoming=None, faults=None, outgoing=None, seconds=600):
    incoming, faults, outgoing = incoming or {}, faults or {}, outgoing or {}
    totals = {"pswpin": 802361, "pgmajfault": 680622, "pswpout": 1348083}
    rows = []
    for second in range(seconds + 1):
        totals["pswpin"] += incoming.get(second, 0)
        totals["pgmajfault"] += faults.get(second, 0)
        totals["pswpout"] += outgoing.get(second, 0)
        rows.append({
            "t": float(second), "mem_available_kib": 1107264,
            "swap_free_kib": 1600000, "disk_free_mib": 12565,
            "psi_full_avg10": 0.19, "psi_some_avg10": 0.7,
            "oom_kill": 0, **totals,
        })
    return rows


def checks():
    return {"http_failures": [], "container_check_start": True,
            "container_check_end": True, "approvals_start": [0, 0, 0],
            "approvals_end": [0, 0, 0], "prod_ready_latency_max_s": 0.062}


class MaintenancePolicyTest(unittest.TestCase):
    def test_previous_burst_is_diagnostic_only_if_600_seconds_complete(self):
        rows = trace(incoming={1: 251}, faults={1: 184})
        self.assertEqual(immediate_reasons(rows[1], rows[0], rows[:2], [], 0.062), [])
        result = evaluate_trace(rows, checks())
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["deltas"]["pswpin"], 251)
        self.assertEqual(result["deltas"]["pgmajfault"], 184)
        self.assertIn("swap_in_limit", evaluate_full_trace(rows, checks())["reasons"])
        self.assertEqual(phase_evaluate_trace("maintenance", rows, checks())["status"], "PASS")
        self.assertEqual(phase_immediate_reasons("maintenance", rows[1], rows[0],
                         rows[:2], rows[0], [], 0.062), [])
        self.assertEqual(phase_evaluate_trace("full", rows, checks())["status"], "FAIL")

    def test_previous_partial_trace_remains_fail_closed(self):
        rows = trace(incoming={1: 251}, faults={1: 184}, seconds=1)
        self.assertEqual(evaluate_trace(rows, checks())["status"], "FAIL")
        self.assertEqual(phase_evaluate_trace("maintenance", rows, checks())["status"], "FAIL")

    def test_real_swap_out_is_immediate_fail(self):
        rows = trace(outgoing={2: 1})
        self.assertIn("strict_no_swap_out", immediate_reasons(rows[2], rows[0], rows[:3], [], 0.1))
        self.assertEqual(evaluate_trace(rows, checks())["status"], "FAIL")
        self.assertIn("strict_api_no_swap_out", phase_evaluate_trace("full", rows, checks())["reasons"])

    def test_psi_ram_oom_and_production_failure_are_immediate_fail(self):
        rows = trace()
        row = rows[1]
        row["psi_full_avg10"] = 1.5
        row["mem_available_kib"] = 819199
        row["oom_kill"] = 1
        reasons = immediate_reasons(row, rows[0], rows[:2], [{"route": "prod_ready"}], 0.8)
        for reason in ("psi_full", "mem_available_floor", "oom", "http_health", "prod_latency"):
            self.assertIn(reason, reasons)

    def test_sustained_paired_page_ins_and_faults_fail(self):
        rows = trace(incoming={10: 64, 70: 64, 130: 64},
                     faults={10: 64, 70: 64, 130: 64})
        self.assertIn("sustained_page_in_and_faults",
                      immediate_reasons(rows[180], rows[0], rows[:181], [], 0.1))
        self.assertEqual(evaluate_trace(rows, checks())["status"], "FAIL")

    def test_missing_sample_gap_and_external_check_fail(self):
        rows = trace()
        self.assertIn("short_interval", evaluate_trace(rows[:500], checks())["reasons"])
        rows[200]["t"] = 210
        self.assertIn("sample_gap_or_clock_error", evaluate_trace(rows, checks())["reasons"])
        rows = trace()
        del rows[20]["pswpin"]
        self.assertEqual(evaluate_trace(rows, checks())["status"], "FAIL")
        self.assertIn("missing_external_checks", evaluate_trace(trace(), {})["reasons"])


if __name__ == "__main__":
    unittest.main()
