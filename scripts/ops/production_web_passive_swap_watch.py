#!/usr/bin/env python3
"""Bounded, procfs-only swap observation; requires separate owner approval on VPS.

This is evidence collection, not a release guard or a Web-stop action. It never
reads process environments, command lines, credentials, network or Docker.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import time

import production_web_swap_probe as probe

ROOT = Path("/var/backups/adforge-mcp")
INTERVAL_S = 1.0
MAX_GAP_S = 1.5
MAX_P95_MS = 20.0
MAX_SAMPLE_MS = 40.0


def secure_write(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(value, stream, sort_keys=True)
        stream.write("\n")


def prepare_output(path):
    if path.is_symlink() or ROOT.is_symlink() or path.parent.resolve() != ROOT.resolve():
        raise ValueError("output_must_be_new_direct_child_of_protected_root")
    path.mkdir(mode=0o700)
    if path.stat().st_mode & 0o077:
        raise ValueError("output_permissions_invalid")


def observe(path, duration_s=120, *, clock=time.monotonic, sleep=time.sleep):
    if not 30 <= duration_s <= 180:
        raise ValueError("duration_out_of_bounds")
    prepare_output(path)
    result = {"status": "INCOMPLETE", "reason": "observation_not_finished"}
    trace_path = path / "passive-trace.jsonl"
    try:
        selection = probe.select_passive()
        secure_write(path / "selection.json", selection)
        overhead = probe.benchmark(selection, count=10)
        secure_write(path / "overhead.json", overhead)
        if overhead["p95_ms"] > MAX_P95_MS or overhead["max_ms"] > MAX_SAMPLE_MS:
            raise RuntimeError("probe_overhead_too_high")
        fd = os.open(trace_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        snapshots = []
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            first_clock = clock()
            while True:
                snapshot = probe.capture(selection, "passive")
                snapshots.append(snapshot)
                stream.write(json.dumps(snapshot, sort_keys=True) + "\n")
                stream.flush()
                if snapshot["monotonic"] - snapshots[0]["monotonic"] >= duration_s:
                    break
                next_clock = first_clock + len(snapshots) * INTERVAL_S
                sleep(max(0.0, next_clock - clock()))
            os.fsync(stream.fileno())
        gaps = [b["monotonic"] - a["monotonic"]
                for a, b in zip(snapshots, snapshots[1:])]
        duration_exact = snapshots[-1]["monotonic"] - snapshots[0]["monotonic"]
        counters_monotonic = all(
            after["host"]["vm"][key] >= before["host"]["vm"][key]
            for before, after in zip(snapshots, snapshots[1:])
            for key in ("pswpout", "pswpin", "pgmajfault", "oom_kill"))
        complete = (duration_exact >= duration_s and counters_monotonic and
                    all(0 < gap <= MAX_GAP_S for gap in gaps))
        events = []
        for before, after in zip(snapshots, snapshots[1:]):
            evidence = probe.correlate(before, after)
            if evidence["host"].get("pswpout", 0) > 0:
                events.append({"start_monotonic": before["monotonic"],
                               "end_monotonic": after["monotonic"], **evidence})
        result = {"status": "COMPLETE" if complete else "INCOMPLETE",
                  "reason": "observation_complete" if complete else
                  "sample_gap_duration_or_counter_reset",
                  "duration_exact_s": duration_exact, "samples": len(snapshots),
                  "max_gap_s": max(gaps, default=0), "swap_out_events": events,
                  "pid_coverage": selection["coverage"],
                  "trace_sha256": hashlib.sha256(trace_path.read_bytes()).hexdigest(),
                  "attribution": "correlation_only"}
    except Exception as exc:
        result = {"status": "INCOMPLETE", "reason": type(exc).__name__ + ":" + str(exc)}
    secure_write(path / "result.json", result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--duration-s", type=int, default=120)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit("root_required_for_protected_evidence")
    result = observe(args.output_dir, args.duration_s)
    print(json.dumps({"status": result["status"], "reason": result["reason"]}))
    if result["status"] != "COMPLETE":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
