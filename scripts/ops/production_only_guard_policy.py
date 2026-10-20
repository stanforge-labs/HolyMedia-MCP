"""Versioned five-production-container release policy; no TEST service is started.

The resource numbers and 600-second window equal the protected nine-container
guard (SHA-256 6f256d9b68bc6c909a6a4754bfda003333fe01ab80027e4c0d5db799374a5fa4).
"""

from collections import deque

PROFILE = "PRODUCTION_ONLY_V1"
PROD = ("holymedia-v2-api-1", "holymedia-v2-web-1", "holymedia-v2-worker-1",
        "holymedia-v2-postgres-1", "holymedia-v2-redis-1")
TEST = ("holymedia-qrs-test-qrs_api-1", "holymedia-qrs-test-qrs_web-1",
        "holymedia-google-acceptance-postgres-1", "holymedia-google-acceptance-redis-1")
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
SAMPLE_KEYS = ("t", "mem_available_kib", "swap_free_kib", "disk_free_mib",
               "psi_full_avg10", "psi_some_avg10", "pswpout", "pswpin",
               "pgmajfault", "oom_kill")
COUNTERS = (("pswpout", "swap_out"), ("pswpin", "swap_in"),
            ("pgmajfault", "major_faults"))


def container_reasons(rows, checkpoint, baseline=None):
    """Check both the live production set and all four retired TEST identities."""
    reasons = []
    if set(rows) != set(PROD + TEST) or set(checkpoint) != set(TEST):
        return ["container_inventory_incomplete"]
    # Release plans snapshot the five production identities; the four retired
    # TEST identities are checked independently against the protected checkpoint.
    # Guard traces may instead supply all nine rows as their first observation.
    if baseline is not None and set(baseline) not in (set(PROD), set(PROD + TEST)):
        return ["container_baseline_incomplete"]
    for name in PROD:
        row = rows[name]
        if row["status"] != "running" or row["health"] != "healthy":
            reasons.append("container_unhealthy:" + name)
        if row["oom"]:
            reasons.append("container_oom:" + name)
        if baseline and any(row[key] != baseline[name][key]
                            for key in ("id", "image", "restarts")):
            reasons.append("container_changed:" + name)
    for name in TEST:
        row = rows[name]
        if row["status"] != "exited" or row["restart"] != "no":
            reasons.append("test_not_stopped:" + name)
        if row["id"] != checkpoint[name]["id"] or row["image"] != checkpoint[name]["image"]:
            reasons.append("test_identity_changed:" + name)
    return reasons


def metric_reasons(sample, first, minute_start):
    reasons = []
    for key, floor in (("mem_available_kib", "mem_available_kib"),
                       ("swap_free_kib", "swap_free_kib"),
                       ("disk_free_mib", "disk_free_mib")):
        if sample[key] < LIMITS[floor]:
            reasons.append(key + "_floor")
    for key in ("psi_full_avg10", "psi_some_avg10"):
        if sample[key] >= LIMITS[key]:
            reasons.append(key + "_limit")
    if sample["oom_kill"] != first["oom_kill"]:
        reasons.append("oom_kill")
    for key, label in COUNTERS:
        if sample[key] - first[key] > LIMITS[label + "_600s"]:
            reasons.append(label + "_600s")
        if sample[key] - minute_start[key] > LIMITS[label + "_60s"]:
            reasons.append(label + "_60s")
    return reasons


def http_reasons(probes, swap_out_delta=0):
    reasons = []
    if set(probes) != {"health", "ready"}:
        return ["http_observation_incomplete"]
    for name, probe in probes.items():
        if probe.get("error") == "timeout":
            reasons.append(name + "_timeout")
        elif probe.get("error"):
            reasons.append(name + "_network_error")
        elif probe.get("status") != 200:
            reasons.append(name + "_http_status")
        if not isinstance(probe.get("duration_s"), (int, float)):
            reasons.append(name + "_duration_missing")
        elif probe["duration_s"] >= LIMITS["prod_ready_latency_s"]:
            # Old guard measured /ready against 0.8s. Applying that ceiling to
            # /health too preserves the previous aggregate observer's refusal
            # for a slow health call, while identifying the actual route.
            reasons.append(name + "_latency")
    ready = probes["ready"].get("duration_s")
    if swap_out_delta > 0 and isinstance(ready, (int, float)) and ready >= LIMITS["prod_ready_latency_with_swap_s"]:
        reasons.append("swap_with_ready_latency")
    return reasons


def evaluate_trace(samples, observations, checkpoint):
    """A missing sample, Docker check or route measurement can never PASS."""
    reasons = []
    duration = samples[-1]["t"] - samples[0]["t"] if samples else 0
    if len(samples) < 301 or any(set(row) < set(SAMPLE_KEYS) for row in samples):
        return {"profile": PROFILE, "status": "FAIL", "reasons": ["observation_incomplete"],
                "duration_s": round(duration, 3), "duration_exact_s": duration}
    if duration < LIMITS["duration_s"]:
        reasons.append("observation_incomplete")
    if any(b["t"] <= a["t"] or b["t"] - a["t"] > LIMITS["max_sample_gap_s"]
           for a, b in zip(samples, samples[1:])):
        reasons.append("sample_gap_or_clock_error")
    for key in ("pswpout", "pswpin", "pgmajfault", "oom_kill"):
        if any(b[key] < a[key] for a, b in zip(samples, samples[1:])):
            reasons.append("nonmonotonic_" + key)
    window = deque()
    for sample in samples:
        window.append(sample)
        while len(window) > 1 and window[1]["t"] <= sample["t"] - 60:
            window.popleft()
        reasons.extend(metric_reasons(sample, samples[0], window[0]))
    bins = [{"out": 0, "in": 0} for _ in range(11)]
    for before, after in zip(samples, samples[1:]):
        idx = min(10, int((after["t"] - samples[0]["t"]) // 60))
        bins[idx]["out"] += after["pswpout"] - before["pswpout"]
        bins[idx]["in"] += after["pswpin"] - before["pswpin"]
    if any(all(bins[j]["out"] > 0 for j in range(i, i + 3)) for i in range(9)):
        reasons.append("sustained_swap_out")
    if any(all(bins[j]["out"] > 0 and bins[j]["in"] > 0 for j in range(i, i + 2)) for i in range(10)):
        reasons.append("sustained_swap_in_out")
    if len(observations) < 21 or observations[0]["t"] > 5 or observations[-1]["t"] < 600:
        reasons.append("external_observation_incomplete")
    if any(b["t"] <= a["t"] or b["t"] - a["t"] > 35
           for a, b in zip(observations, observations[1:])):
        reasons.append("external_observation_gap")
    for event in observations:
        reasons.extend(container_reasons(event.get("containers", {}), checkpoint,
                                         observations[0].get("containers")))
        reasons.extend(http_reasons(event.get("http", {}),
                                    event.get("swap_out_delta", 0)))
    return {
        "profile": PROFILE, "status": "FAIL" if reasons else "PASS",
        "reasons": sorted(set(reasons)), "duration_s": round(duration, 3),
        "duration_exact_s": duration,
        "sample_count": len(samples), "external_checks": len(observations),
        "min_mem_available_kib": min(row["mem_available_kib"] for row in samples),
        "min_swap_free_kib": min(row["swap_free_kib"] for row in samples),
        "min_disk_free_mib": min(row["disk_free_mib"] for row in samples),
        "peak_psi_some_avg10": max(row["psi_some_avg10"] for row in samples),
        "peak_psi_full_avg10": max(row["psi_full_avg10"] for row in samples),
        "deltas": {key: samples[-1][key] - samples[0][key]
                   for key in ("pswpout", "pswpin", "pgmajfault", "oom_kill")},
    }
