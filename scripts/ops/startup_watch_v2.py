#!/usr/bin/env python3
"""Opt-in 180-second startup watcher; old-stop exception needs a handshake.

The candidate is not allowed to start until the watcher has observed two
stable post-stop samples, then armed a fresh candidate-phase baseline.
"""

import argparse
import json
import os
from pathlib import Path
import time

from production_only_resource_guard_v2 import host_sample
from startup_watch_policy_v2 import PROFILE, State


def secure_create(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())


def phase_for(directory, service):
    for phase in ("candidate-running", "starting-candidate", "old-stopped",
                  "stopping-old", "before-stop"):
        if (directory / f"{service}-phase.{phase}").exists():
            return phase
    return "before-stop"


def initial_reasons(sample):
    reasons = []
    for key, floor in (("mem_available_kib", 819200),
                       ("swap_free_kib", 262144), ("disk_free_mib", 10240)):
        if sample[key] < floor:
            reasons.append(key + "_floor")
    if sample["psi_full_avg10"] >= 1.5 or sample["psi_some_avg10"] >= 2.0:
        reasons.append("psi_limit")
    return reasons


def run(directory, service, *, duration_s=180):
    if duration_s != 180:
        raise ValueError("startup_duration_must_be_180")
    if not directory.is_dir() or directory.is_symlink() or directory.stat().st_mode & 0o077:
        raise ValueError("protected_run_directory_required")
    start = time.monotonic()
    first = host_sample(start)
    first["epoch"] = time.time()
    first["monotonic"] = time.monotonic()
    state = State(first, allow_old_stop_swapin=service == "web")
    reasons = initial_reasons(first)
    trace_path = directory / "startup-watch-trace.jsonl"
    fd = os.open(trace_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    last = first
    reached_candidate = False
    with os.fdopen(fd, "w", encoding="utf-8") as trace:
        trace.write(json.dumps({"type": "sample", "phase": "before-stop", **first}) + "\n")
        trace.flush()
        if not reasons:
            secure_create(directory / "startup-watch.ready", str(os.getpid()))
        while not reasons:
            deadline = first["monotonic"] + duration_s
            time.sleep(min(1.0, max(0.0, deadline - time.monotonic())))
            sample = host_sample(start)
            sample["epoch"] = time.time()
            sample["monotonic"] = time.monotonic()
            phase = phase_for(directory, service)
            last = sample
            trace.write(json.dumps({"type": "sample", "phase": phase, **sample}) + "\n")
            trace.flush()
            reasons = state.update(sample, phase)
            if phase == "old-stopped" and state.old_cleared and not reasons and not (
                    directory / "startup-watch.old-stop-cleared").exists():
                secure_create(directory / "startup-watch.old-stop-cleared", "")
            if phase == "starting-candidate" and state.candidate_baseline and not reasons and not (
                    directory / "startup-watch.candidate-armed").exists():
                secure_create(directory / "startup-watch.candidate-armed", "")
            if phase == "candidate-running":
                reached_candidate = True
            if sample["monotonic"] - first["monotonic"] >= duration_s or reasons:
                break
        if not reasons and (not reached_candidate or not state.old_cleared or
                            state.candidate_baseline is None):
            reasons = ["startup_phase_evidence_incomplete"]
        exact = last["monotonic"] - first["monotonic"]
        if not reasons and exact < duration_s:
            reasons = ["startup_observation_incomplete"]
        result = {"profile": PROFILE, "status": "FAIL" if reasons else "PASS",
                  "reasons": reasons, "warnings": state.warnings,
                  "duration_exact_s": exact, "duration_s": round(exact, 3),
                  "peak60": state.peak60,
                  "deltas": {key: last[key] - first[key] for key in
                             ("pswpout", "pswpin", "pgmajfault", "oom_kill",
                              "pgscan_direct")}}
        trace.write(json.dumps({"type": "result", **result}) + "\n")
        trace.flush()
        os.fsync(trace.fileno())
    if reasons:
        secure_create(directory / "startup-watch.fail", ",".join(reasons))
    secure_create(directory / "startup-watch.json", json.dumps(result, sort_keys=True))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--service", required=True, choices=("web", "api"))
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("root_required")
    result = run(args.directory, args.service)
    print(json.dumps({"status": result["status"], "reasons": result["reasons"]}))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
