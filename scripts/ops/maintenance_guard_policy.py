"""Strict resource policy for the 600s interval with TEST API/Web stopped.

The full-stack policy remains in web_only_guard_policy.py. A page-in/fault
burst alone is diagnostic here: it can be cold-page recovery after stopping
TEST. Persistent paired activity over three complete minutes is a failure.
"""

from web_only_guard_policy import LIMITS, SAMPLE_KEYS


def _minute_bins(samples):
    bins = {}
    origin = samples[0]["t"]
    for before, after in zip(samples, samples[1:]):
        index = int((after["t"] - origin) // 60)
        if index >= 10:
            index = 9
        bucket = bins.setdefault(index, {"in": 0, "faults": 0})
        bucket["in"] += max(0, after["pswpin"] - before["pswpin"])
        bucket["faults"] += max(0, after["pgmajfault"] - before["pgmajfault"])
    return bins


def sustained_pressure(samples):
    """Three consecutive complete minutes of paired page-ins/faults."""
    if len(samples) < 2:
        return False
    completed = int((samples[-1]["t"] - samples[0]["t"]) // 60)
    bins = _minute_bins(samples)
    return any(
        all(bins.get(j, {}).get("in", 0) >= 64 and
            bins.get(j, {}).get("faults", 0) >= 64
            for j in range(first, first + 3))
        for first in range(max(0, completed - 2))
    )


def immediate_reasons(sample, baseline, samples, http_failures, ready_latency):
    reasons = []
    if sample["mem_available_kib"] < LIMITS["mem_available_kib"]:
        reasons.append("mem_available_floor")
    if sample["swap_free_kib"] < LIMITS["swap_free_kib"]:
        reasons.append("swap_free_floor")
    if sample["disk_free_mib"] < LIMITS["disk_free_mib"]:
        reasons.append("disk_free_floor")
    if sample["psi_full_avg10"] >= LIMITS["psi_full_avg10"]:
        reasons.append("psi_full")
    if sample["psi_some_avg10"] >= LIMITS["psi_some_avg10"]:
        reasons.append("psi_some")
    if sample["pswpout"] != baseline["pswpout"]:
        reasons.append("strict_no_swap_out")
    if sample["oom_kill"] != baseline["oom_kill"]:
        reasons.append("oom")
    if http_failures:
        reasons.append("http_health")
    if ready_latency >= LIMITS["prod_ready_latency_s"]:
        reasons.append("prod_latency")
    if sustained_pressure(samples):
        reasons.append("sustained_page_in_and_faults")
    return reasons


def evaluate_trace(samples, checks):
    """A partial or malformed interval never earns a maintenance PASS."""
    if len(samples) < 301 or any(any(key not in row for key in SAMPLE_KEYS) for row in samples):
        return {"status": "FAIL", "reasons": ["missing_samples_or_metrics"]}
    reasons = []
    duration = samples[-1]["t"] - samples[0]["t"]
    if duration < 600:
        reasons.append("short_interval")
    if any(b["t"] - a["t"] > LIMITS["max_sample_gap_s"] or b["t"] <= a["t"]
           for a, b in zip(samples, samples[1:])):
        reasons.append("sample_gap_or_clock_error")
    for key in ("pswpout", "pswpin", "pgmajfault", "oom_kill"):
        if any(b[key] < a[key] for a, b in zip(samples, samples[1:])):
            reasons.append("nonmonotonic_" + key)
    for row in samples:
        reasons.extend(immediate_reasons(row, samples[0], [], [], 0.0))
    if sustained_pressure(samples):
        reasons.append("sustained_page_in_and_faults")
    required = ("http_failures", "container_check_start", "container_check_end",
                "approvals_start", "approvals_end", "prod_ready_latency_max_s")
    if any(key not in checks for key in required):
        reasons.append("missing_external_checks")
    else:
        if checks["http_failures"]:
            reasons.append("http_health")
        if not checks["container_check_start"] or not checks["container_check_end"]:
            reasons.append("container_health")
        if checks["approvals_start"] != [0, 0, 0] or checks["approvals_end"] != [0, 0, 0]:
            reasons.append("active_approval_or_commit")
        if checks["prod_ready_latency_max_s"] >= LIMITS["prod_ready_latency_s"]:
            reasons.append("prod_latency")
    return {
        "status": "FAIL" if reasons else "PASS",
        "reasons": sorted(set(reasons)),
        "duration_s": round(duration, 3),
        "sample_count": len(samples),
        "min_mem_available_kib": min(row["mem_available_kib"] for row in samples),
        "min_swap_free_kib": min(row["swap_free_kib"] for row in samples),
        "min_disk_free_mib": min(row["disk_free_mib"] for row in samples),
        "peak_psi_full_avg10": max(row["psi_full_avg10"] for row in samples),
        "peak_psi_some_avg10": max(row["psi_some_avg10"] for row in samples),
        "deltas": {key: samples[-1][key] - samples[0][key]
                   for key in ("pswpout", "pswpin", "pgmajfault", "oom_kill")},
        "minute_bins": _minute_bins(samples),
    }
