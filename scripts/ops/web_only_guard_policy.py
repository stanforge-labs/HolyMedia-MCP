"""TEST Web-only resource policy. Never use this profile for TEST API or production."""

from collections import deque


LIMITS = {
    "duration_s": 600,
    "mem_available_kib": 819200,
    "swap_free_kib": 262144,
    "disk_free_mib": 10240,
    "psi_full_avg10": 1.5,
    "psi_some_avg10": 2.0,
    "swap_out_600s": 64,
    "swap_out_60s": 32,
    "swap_in_600s": 64,
    "swap_in_60s": 32,
    "major_faults_600s": 256,
    "major_faults_60s": 64,
    "prod_ready_latency_s": 0.8,
    "prod_ready_latency_with_swap_s": 0.5,
    "max_sample_gap_s": 3.5,
}

SAMPLE_KEYS = (
    "t",
    "mem_available_kib",
    "swap_free_kib",
    "disk_free_mib",
    "psi_full_avg10",
    "psi_some_avg10",
    "pswpout",
    "pswpin",
    "pgmajfault",
    "oom_kill",
)


def _rolling_peak(samples, key, seconds=60):
    queue = deque()
    peak = 0
    for sample in samples:
        queue.append((sample["t"], sample[key]))
        while len(queue) > 1 and queue[1][0] <= sample["t"] - seconds:
            queue.popleft()
        peak = max(peak, sample[key] - queue[0][1])
    return peak


def immediate_reasons(sample, baseline, window_start, http_failures, ready_latency):
    """Conditions that require stopping observation and rolling back promptly."""
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
    for key, total_limit, rolling_limit, label in (
        ("pswpout", "swap_out_600s", "swap_out_60s", "swap_out_limit"),
        ("pswpin", "swap_in_600s", "swap_in_60s", "swap_in_limit"),
        ("pgmajfault", "major_faults_600s", "major_faults_60s", "major_fault_limit"),
    ):
        if sample[key] - baseline[key] > LIMITS[total_limit] or sample[key] - window_start[key] > LIMITS[rolling_limit]:
            reasons.append(label)
    if sample["oom_kill"] != baseline["oom_kill"]:
        reasons.append("oom")
    if http_failures:
        reasons.append("http_health")
    if ready_latency >= LIMITS["prod_ready_latency_s"]:
        reasons.append("prod_latency")
    if sample["pswpout"] > baseline["pswpout"] and ready_latency >= LIMITS["prod_ready_latency_with_swap_s"]:
        reasons.append("swap_with_prod_latency")
    return reasons


def evaluate_trace(samples, checks):
    """Evaluate a complete 600-second trace; missing evidence always fails."""
    reasons = []
    if len(samples) < 301 or any(any(key not in row for key in SAMPLE_KEYS) for row in samples):
        return {"status": "FAIL", "reasons": ["missing_samples_or_metrics"]}
    if samples[-1]["t"] - samples[0]["t"] < LIMITS["duration_s"]:
        reasons.append("short_interval")
    if any(b["t"] - a["t"] > LIMITS["max_sample_gap_s"] or b["t"] <= a["t"] for a, b in zip(samples, samples[1:])):
        reasons.append("sample_gap_or_clock_error")
    for key in ("pswpout", "pswpin", "pgmajfault", "oom_kill"):
        if any(b[key] < a[key] for a, b in zip(samples, samples[1:])):
            reasons.append(f"nonmonotonic_{key}")

    minimum_mem = min(row["mem_available_kib"] for row in samples)
    minimum_swap_free = min(row["swap_free_kib"] for row in samples)
    minimum_disk_free = min(row["disk_free_mib"] for row in samples)
    peak_full = max(row["psi_full_avg10"] for row in samples)
    peak_some = max(row["psi_some_avg10"] for row in samples)
    if minimum_mem < LIMITS["mem_available_kib"]:
        reasons.append("mem_available_floor")
    if minimum_swap_free < LIMITS["swap_free_kib"]:
        reasons.append("swap_free_floor")
    if minimum_disk_free < LIMITS["disk_free_mib"]:
        reasons.append("disk_free_floor")
    if peak_full >= LIMITS["psi_full_avg10"]:
        reasons.append("psi_full")
    if peak_some >= LIMITS["psi_some_avg10"]:
        reasons.append("psi_some")

    deltas = {key: samples[-1][key] - samples[0][key] for key in ("pswpout", "pswpin", "pgmajfault", "oom_kill")}
    peaks_60s = {key: _rolling_peak(samples, key) for key in ("pswpout", "pswpin", "pgmajfault")}
    if deltas["pswpout"] > LIMITS["swap_out_600s"] or peaks_60s["pswpout"] > LIMITS["swap_out_60s"]:
        reasons.append("swap_out_limit")
    if deltas["pswpin"] > LIMITS["swap_in_600s"] or peaks_60s["pswpin"] > LIMITS["swap_in_60s"]:
        reasons.append("swap_in_limit")
    if deltas["pgmajfault"] > LIMITS["major_faults_600s"] or peaks_60s["pgmajfault"] > LIMITS["major_faults_60s"]:
        reasons.append("major_fault_limit")
    if deltas["oom_kill"] != 0:
        reasons.append("oom")

    bins = [{"out": 0, "in": 0} for _ in range(11)]
    for before, after in zip(samples, samples[1:]):
        index = min(10, int((after["t"] - samples[0]["t"]) // 60))
        bins[index]["out"] += max(0, after["pswpout"] - before["pswpout"])
        bins[index]["in"] += max(0, after["pswpin"] - before["pswpin"])
    if any(all(bins[j]["out"] > 0 for j in range(i, i + 3)) for i in range(len(bins) - 2)):
        reasons.append("sustained_swap_out")
    if any(all(bins[j]["out"] > 0 and bins[j]["in"] > 0 for j in range(i, i + 2)) for i in range(len(bins) - 1)):
        reasons.append("sustained_swap_in_out")

    required_checks = ("http_failures", "container_check_start", "container_check_end", "approvals_start", "approvals_end", "prod_ready_latency_max_s")
    if any(key not in checks for key in required_checks):
        reasons.append("missing_external_checks")
    else:
        if checks["http_failures"]:
            reasons.append("http_health")
        if not checks["container_check_start"] or not checks["container_check_end"]:
            reasons.append("container_health")
        if checks["approvals_start"] != [0, 0, 0] or checks["approvals_end"] != [0, 0, 0]:
            reasons.append("active_approval_or_commit")
        latency = checks["prod_ready_latency_max_s"]
        if latency >= LIMITS["prod_ready_latency_s"]:
            reasons.append("prod_latency")
        if deltas["pswpout"] and latency >= LIMITS["prod_ready_latency_with_swap_s"]:
            reasons.append("swap_with_prod_latency")

    return {
        "status": "PASS" if not reasons else "FAIL",
        "reasons": sorted(set(reasons)),
        "duration_s": round(samples[-1]["t"] - samples[0]["t"], 3),
        "sample_count": len(samples),
        "min_mem_available_kib": minimum_mem,
        "min_swap_free_kib": minimum_swap_free,
        "min_disk_free_mib": minimum_disk_free,
        "peak_psi_full_avg10": peak_full,
        "peak_psi_some_avg10": peak_some,
        "deltas": deltas,
        "peak_60s": peaks_60s,
        "minute_bins": bins,
    }


def evaluate_historical_summary(record):
    """Reject known unsafe summaries; never certify an incomplete old interval."""
    reasons = []
    if record.get("swap_out_pages", 0) > LIMITS["swap_out_600s"]:
        reasons.append("swap_out_limit")
    if record.get("min_mem_available_kib", LIMITS["mem_available_kib"]) < LIMITS["mem_available_kib"]:
        reasons.append("mem_available_floor")
    if record.get("oom_delta", 0) > 0:
        reasons.append("oom")
    if record.get("peak_psi_full_avg10", 0) >= LIMITS["psi_full_avg10"]:
        reasons.append("psi_full")
    return {"status": "REJECTED" if reasons else "INDETERMINATE", "reasons": reasons}
