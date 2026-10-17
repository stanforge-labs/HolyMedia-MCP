#!/usr/bin/env python3
"""Persist one strict TEST maintenance/full-stack resource guard on the VPS.

No Docker mutation, credential read, or provider call occurs here. A stopped
TEST API/Web is expected only in the explicitly named maintenance phase.
"""

import argparse
from collections import deque
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request

from maintenance_guard_policy import (
    evaluate_trace as evaluate_maintenance_trace,
    immediate_reasons as maintenance_immediate_reasons,
)
from web_only_guard_policy import (
    evaluate_trace as evaluate_full_trace,
    immediate_reasons as full_immediate_reasons,
)


PROD = (
    "holymedia-v2-api-1", "holymedia-v2-web-1", "holymedia-v2-worker-1",
    "holymedia-v2-postgres-1", "holymedia-v2-redis-1",
)
TEST_DATA = (
    "holymedia-google-acceptance-postgres-1",
    "holymedia-google-acceptance-redis-1",
)
TEST_APP = ("holymedia-qrs-test-qrs_api-1", "holymedia-qrs-test-qrs_web-1")
ALL = PROD + TEST_DATA + TEST_APP
PREVIEW_SQL = (
    "SELECT count(*) FILTER (WHERE consumed_at IS NULL AND cancelled_at IS NULL "
    "AND expires_at>now()), count(*) FILTER (WHERE confirmed_at IS NOT NULL "
    "AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>now()), "
    "count(*) FILTER (WHERE commit_attempted_at IS NOT NULL AND commit_status IS NULL) "
    "FROM mcp_previews"
)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def docker_state():
    output = subprocess.check_output([
        "docker", "inspect", "--format",
        "{{.Name}}|{{.Id}}|{{.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.Pid}}",
        *ALL,
    ], text=True, timeout=20)
    rows = {}
    for line in output.splitlines():
        name, container_id, image, status, health, restarts, oom, pid = line.split("|")
        rows[name.lstrip("/")] = {
            "id": container_id, "image": image, "status": status,
            "health": health, "restarts": int(restarts),
            "oom": oom == "true", "pid": int(pid),
        }
    if set(rows) != set(ALL):
        raise RuntimeError("container_inventory_incomplete")
    return rows


def expected_state(rows, phase):
    for name in PROD + TEST_DATA:
        if rows[name]["status"] != "running" or rows[name]["health"] != "healthy" or rows[name]["oom"]:
            return False
    for name in TEST_APP:
        row = rows[name]
        if phase == "maintenance":
            valid = row["status"] == "exited" and row["pid"] == 0
        else:
            valid = row["status"] == "running" and row["health"] == "healthy"
        if not valid or row["oom"]:
            return False
    return True


def approvals():
    result = subprocess.check_output([
        "docker", "exec", TEST_DATA[0], "sh", "-c",
        'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F " " -c "$1"',
        "sh", PREVIEW_SQL,
    ], text=True, timeout=20).strip().split()
    if len(result) != 3 or any(not x.isdecimal() for x in result):
        raise RuntimeError("approval_counts_invalid")
    return [int(x) for x in result]


def read_sample(start):
    values = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        parts = line.split()
        if parts and parts[0] in ("MemAvailable:", "SwapFree:"):
            values[parts[0][:-1]] = int(parts[1])
    for line in Path("/proc/vmstat").read_text().splitlines():
        parts = line.split()
        if parts and parts[0] in ("pswpout", "pswpin", "pgmajfault", "oom_kill"):
            values[parts[0]] = int(parts[1])
    for line in Path("/proc/pressure/memory").read_text().splitlines():
        parts = line.split()
        if parts and parts[0] in ("some", "full"):
            values[parts[0]] = float(parts[1].split("=")[1])
    fs = os.statvfs("/")
    required = {"MemAvailable", "SwapFree", "pswpout", "pswpin", "pgmajfault", "oom_kill", "some", "full"}
    if set(values) != required:
        raise RuntimeError("resource_counter_missing")
    return {
        "t": time.monotonic() - start,
        "mem_available_kib": values["MemAvailable"],
        "swap_free_kib": values["SwapFree"],
        "disk_free_mib": fs.f_bavail * fs.f_frsize // 1048576,
        "psi_full_avg10": values["full"],
        "psi_some_avg10": values["some"],
        "pswpout": values["pswpout"],
        "pswpin": values["pswpin"],
        "pgmajfault": values["pgmajfault"],
        "oom_kill": values["oom_kill"],
    }


def probe(opener, phase):
    urls = [
        ("prod_health", "https://mcp.holymedia.kz/health"),
        ("prod_ready", "https://mcp.holymedia.kz/ready"),
    ]
    if phase == "full":
        urls.extend([
            ("test_api", "http://127.0.0.1:14404/ready"),
            ("test_web_auth", "http://127.0.0.1:13300/auth"),
            ("test_web_approval", "http://127.0.0.1:13300/mcp/approve"),
        ])
    failures = []
    ready_latency = 0.0
    for name, url in urls:
        started = time.monotonic()
        try:
            with opener.open(url, timeout=3) as response:
                status = response.status
        except (OSError, urllib.error.URLError):
            status = 0
        latency = time.monotonic() - started
        if name == "prod_ready":
            ready_latency = latency
        if status != 200:
            failures.append({"route": name, "status": status})
    return failures, ready_latency


def write_json(path, item):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as out:
        json.dump(item, out, sort_keys=True)
        out.write("\n")
        out.flush()
        os.fsync(out.fileno())


def phase_immediate_reasons(phase, row, baseline, samples, window_start,
                            http_failures, ready_latency):
    if phase == "maintenance":
        return maintenance_immediate_reasons(
            row, baseline, samples, http_failures, ready_latency,
        )
    if phase == "full":
        reasons = full_immediate_reasons(
            row, baseline, window_start, http_failures, ready_latency,
        )
        if row["pswpout"] != baseline["pswpout"]:
            reasons.append("strict_api_no_swap_out")
        return reasons
    raise ValueError("unknown_guard_phase")


def phase_evaluate_trace(phase, samples, checks):
    if phase == "maintenance":
        result = evaluate_maintenance_trace(samples, checks)
    elif phase == "full":
        result = evaluate_full_trace(samples, checks)
    else:
        raise ValueError("unknown_guard_phase")
    if samples and samples[-1]["pswpout"] != samples[0]["pswpout"]:
        result["status"] = "FAIL"
        result["reasons"] = sorted(set(result["reasons"] + ["strict_api_no_swap_out"]))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", required=True, choices=("maintenance", "full"))
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--seconds", type=int, default=600)
    args = parser.parse_args()
    if os.geteuid() != 0 or args.seconds != 600:
        parser.error("root and an exact 600-second guard are required")
    folder = Path(args.output_dir)
    if not folder.is_dir() or folder.is_symlink() or folder.stat().st_mode & 0o077 or folder.stat().st_uid != 0:
        parser.error("output directory must be existing root-only directory")
    trace = folder / f"{args.phase}-trace.jsonl"
    result_path = folder / f"{args.phase}-result.json"
    if trace.exists() or result_path.exists():
        parser.error("guard already attempted in this directory")
    opener = urllib.request.build_opener(NoRedirect())
    before = docker_state()
    checks = {
        "container_check_start": expected_state(before, args.phase),
        "approvals_start": approvals(),
        "http_failures": [],
        "prod_ready_latency_max_s": 0.0,
    }
    start = time.monotonic()
    deadline = start + args.seconds
    next_http = start
    samples = []
    window = deque()
    failure = []
    fd = os.open(trace, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as out:
        while time.monotonic() < deadline:
            row = read_sample(start)
            samples.append(row)
            window.append(row)
            while len(window) > 1 and window[1]["t"] <= row["t"] - 60:
                window.popleft()
            out.write(json.dumps(row, separators=(",", ":")) + "\n")
            out.flush()
            if len(samples) % 10 == 0:
                os.fsync(out.fileno())
            if time.monotonic() >= next_http:
                next_http = time.monotonic() + 10
                failed, latency = probe(opener, args.phase)
                checks["http_failures"].extend(failed)
                checks["prod_ready_latency_max_s"] = max(checks["prod_ready_latency_max_s"], latency)
            failure = phase_immediate_reasons(
                args.phase, row, samples[0], samples, window[0],
                checks["http_failures"], checks["prod_ready_latency_max_s"],
            )
            if not checks["container_check_start"] or checks["approvals_start"] != [0, 0, 0]:
                failure.append("bad_initial_state")
            if failure:
                break
            time.sleep(min(1.0, max(0.0, deadline - time.monotonic())))
        if not failure:
            final = read_sample(start)
            samples.append(final)
            out.write(json.dumps(final, separators=(",", ":")) + "\n")
        out.flush()
        os.fsync(out.fileno())
    after = docker_state()
    checks["container_check_end"] = expected_state(after, args.phase) and all(
        before[name]["id"] == after[name]["id"]
        and before[name]["image"] == after[name]["image"]
        and before[name]["pid"] == after[name]["pid"]
        and before[name]["restarts"] == after[name]["restarts"]
        for name in ALL
    )
    checks["approvals_end"] = approvals()
    result = phase_evaluate_trace(args.phase, samples, checks)
    if failure:
        result["status"] = "FAIL"
        result["reasons"] = sorted(set(result["reasons"] + failure))
    result.update({
        "phase": args.phase,
        "full_stack_proven": args.phase == "full" and result["status"] == "PASS",
        "trace_path": str(trace),
        "checks": checks,
        "strict_api_swap_out_pages": samples[-1]["pswpout"] - samples[0]["pswpout"],
    })
    write_json(result_path, result)
    print(json.dumps(result, sort_keys=True))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        failure = {"status": "FAIL", "error_type": type(error).__name__}
        if "--output-dir" in sys.argv and "--phase" in sys.argv:
            try:
                folder = Path(sys.argv[sys.argv.index("--output-dir") + 1])
                phase = sys.argv[sys.argv.index("--phase") + 1]
                result_path = folder / f"{phase}-result.json"
                if folder.is_dir() and not result_path.exists():
                    write_json(result_path, failure)
            except (OSError, IndexError, ValueError):
                pass
        print(json.dumps(failure))
        sys.exit(1)
