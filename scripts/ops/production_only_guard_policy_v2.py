"""Opt-in pressure-aware policy. V1 remains the active default and is unchanged.

Only one short swap-out episode in a complete *precutover* observation can be
reported as a warning. Every other V1 gate remains a hard failure. Direct
reclaim is an additional hard gate, not an alternative way to pass V1.
"""

import production_only_guard_policy as v1

PROFILE = "PRODUCTION_ONLY_V2"
MAX_ISOLATED_SWAP_OUT_PAGES = 256
MAX_EPISODE_SAMPLES = 3
MAX_EPISODE_SECONDS = 5.0
SWAP_OUT_REASONS = {"swap_out_60s", "swap_out_600s"}


def direct_reclaim_reasons(samples):
    if not samples or any("pgscan_direct" not in row or
                          not isinstance(row["pgscan_direct"], int)
                          for row in samples):
        return ["direct_reclaim_evidence_missing"]
    if any(after["pgscan_direct"] < before["pgscan_direct"]
           for before, after in zip(samples, samples[1:])):
        return ["direct_reclaim_counter_reset"]
    if samples[-1]["pgscan_direct"] > samples[0]["pgscan_direct"]:
        return ["direct_reclaim_detected"]
    return []


def swap_out_episode(samples):
    """Return one contiguous burst and its ending time, or None."""
    if any("pswpout" not in row or "t" not in row for row in samples):
        return None
    positive = [(index, after["pswpout"] - before["pswpout"], after["t"])
                for index, (before, after) in enumerate(zip(samples, samples[1:]), 1)
                if after["pswpout"] > before["pswpout"]]
    if not positive or len(positive) > MAX_EPISODE_SAMPLES:
        return None
    if any(b[0] != a[0] + 1 for a, b in zip(positive, positive[1:])):
        return None
    if positive[-1][2] - positive[0][2] > MAX_EPISODE_SECONDS:
        return None
    total = sum(item[1] for item in positive)
    if total > MAX_ISOLATED_SWAP_OUT_PAGES:
        return None
    return {"pages": total, "end_t": positive[-1][2],
            "samples": len(positive)}


def evaluate_trace(samples, observations, checkpoint, *, phase):
    if phase not in ("precutover", "poststart"):
        raise ValueError("invalid_v2_guard_phase")
    if not samples or any(not set(v1.SAMPLE_KEYS) <= set(row) for row in samples):
        duration = (samples[-1].get("t", 0) - samples[0].get("t", 0)) if samples else 0
        return {"profile": PROFILE, "phase": phase, "status": "FAIL",
                "reasons": ["observation_incomplete"], "warnings": [],
                "duration_exact_s": duration, "duration_s": round(duration, 3),
                "isolated_swap_out": None}
    result = v1.evaluate_trace(samples, observations, checkpoint)
    reasons = set(result["reasons"])
    reasons.update(direct_reclaim_reasons(samples))
    # V1's fast path returns only observation_incomplete for short traces.
    # Preserve the diagnostic 600-second swap trigger even on that path.
    if samples and samples[-1].get("pswpout", 0) - samples[0].get("pswpout", 0) > v1.LIMITS["swap_out_600s"]:
        reasons.add("swap_out_600s")
    warnings = []
    episode = None
    if samples and samples[-1].get("pswpout", 0) > samples[0].get("pswpout", 0):
        episode = swap_out_episode(samples)
        if episode is None:
            reasons.add("swap_out_not_isolated_or_over_ceiling")
        if samples[-1].get("pswpin", 0) > samples[0].get("pswpin", 0):
            reasons.add("simultaneous_swap_in_out")
    if reasons & SWAP_OUT_REASONS and phase == "precutover":
        # A soft swap-out may pass only when there is no other V1 failure,
        # no page-in, no direct reclaim, and a checked Docker/HTTP checkpoint
        # that actually follows the last swapping sample. V1 validates every
        # required external checkpoint and exact duration first.
        subsequent = any(event.get("checked_t", -1) > episode["end_t"]
                         for event in observations) if episode else False
        safe = (episode is not None and subsequent and
                not (reasons - SWAP_OUT_REASONS) and
                samples[-1]["pswpin"] == samples[0]["pswpin"])
        if safe:
            warnings = sorted(reasons & SWAP_OUT_REASONS)
            reasons -= SWAP_OUT_REASONS
        else:
            reasons.add("isolated_swap_out_unconfirmed")
    result.update(profile=PROFILE, phase=phase,
                  status="FAIL" if reasons else "PASS",
                  reasons=sorted(reasons), warnings=warnings,
                  isolated_swap_out=episode)
    return result


def streaming_reasons(sample, first, minute_start, *, phase):
    reasons = set(v1.metric_reasons(sample, first, minute_start))
    if sample.get("pgscan_direct") is None:
        reasons.add("direct_reclaim_evidence_missing")
    elif sample["pgscan_direct"] < first["pgscan_direct"]:
        reasons.add("direct_reclaim_counter_reset")
    elif sample["pgscan_direct"] > first["pgscan_direct"]:
        reasons.add("direct_reclaim_detected")
    if phase == "precutover":
        # Defer *only* the two swap-out threshold decisions until the complete
        # 600-second trace can confirm a single episode and post-event checks.
        reasons -= SWAP_OUT_REASONS
        if sample["pswpout"] > first["pswpout"] and sample["pswpin"] > first["pswpin"]:
            reasons.add("simultaneous_swap_in_out")
    return sorted(reasons)


def episode_streaming_reasons(samples, *, phase):
    if phase != "precutover" or len(samples) < 2:
        return []
    if samples[-1]["pswpout"] > samples[0]["pswpout"] and swap_out_episode(samples) is None:
        return ["swap_out_not_isolated_or_over_ceiling"]
    return []
