#!/usr/bin/env python3
"""One full, fail-closed TEST Web-only resource interval on the shared VPS.

Run as root on the VPS with web_only_guard_policy.py beside this file. This
script never changes Docker, system settings, credentials, or provider state.
"""

import argparse
from collections import deque
import hashlib
import json
import os
import pathlib
import statistics
import subprocess
import time
import urllib.error
import urllib.request

from web_only_guard_policy import LIMITS, evaluate_trace, immediate_reasons


CONTAINERS = (
    "holymedia-qrs-test-qrs_api-1",
    "holymedia-qrs-test-qrs_web-1",
    "holymedia-google-acceptance-postgres-1",
    "holymedia-google-acceptance-redis-1",
    "holymedia-v2-api-1",
    "holymedia-v2-web-1",
    "holymedia-v2-worker-1",
    "holymedia-v2-postgres-1",
    "holymedia-v2-redis-1",
)
URLS = (
    ("prod_health", "https://mcp.holymedia.kz/health"),
    ("prod_ready", "https://mcp.holymedia.kz/ready"),
    ("test_api", "http://127.0.0.1:14404/ready"),
    ("test_web_auth", "http://127.0.0.1:13300/auth"),
    ("test_web_approve", "http://127.0.0.1:13300/mcp/approve"),
)
APPROVAL_SQL = (
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
    result = subprocess.check_output(
        [
            "docker", "inspect", "--format",
            "{{.Name}} {{.Image}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.RestartCount}} {{.State.OOMKilled}} {{.State.Pid}}",
            *CONTAINERS,
        ],
        text=True,
        timeout=20,
    )
    rows = {}
    for line in result.splitlines():
        name, image, status, health, restarts, oom, pid = line.split()
        rows[name.lstrip("/")] = {
            "image": image, "status": status, "health": health,
            "restarts": int(restarts), "oom": oom.lower() == "true", "pid": int(pid),
        }
    if set(rows) != set(CONTAINERS):
        raise RuntimeError("container_inventory_incomplete")
    return rows


def containers_healthy(rows):
    return all(row["status"] == "running" and row["health"] == "healthy" and not row["oom"] for row in rows.values())


def approval_counts():
    output = subprocess.check_output(
        [
            "docker", "exec", "holymedia-google-acceptance-postgres-1", "sh", "-c",
            'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F " " -c "$1"',
            "sh", APPROVAL_SQL,
        ],
        text=True,
        timeout=20,
    )
    parts = output.strip().split()
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        raise RuntimeError("approval_count_invalid")
    return [int(part) for part in parts]


def cgroup_for(pid):
    for line in pathlib.Path(f"/proc/{pid}/cgroup").read_text().splitlines():
        if line.startswith("0::"):
            return pathlib.Path("/sys/fs/cgroup" + line[3:])
    raise RuntimeError("unified_cgroup_unavailable")


def cgroup_pids(group):
    try:
        return {int(item) for item in (group / "cgroup.procs").read_text().split()}
    except OSError:
        return set()


def pss_kib(pid):
    try:
        for line in pathlib.Path(f"/proc/{pid}/smaps_rollup").read_text().splitlines():
            if line.startswith("Pss:"):
                return int(line.split()[1])
    except (OSError, ValueError, IndexError):
        pass
    return None


def steady_web_pss(group):
    values = [value for pid in cgroup_pids(group) if (value := pss_kib(pid)) is not None]
    return max(values) if values else None


def sample_at(start):
    mem = {}
    for line in pathlib.Path("/proc/meminfo").read_text().splitlines():
        bits = line.split()
        if bits and bits[0] in ("MemAvailable:", "SwapFree:"):
            mem[bits[0][:-1]] = int(bits[1])
    vm = {}
    for line in pathlib.Path("/proc/vmstat").read_text().splitlines():
        bits = line.split()
        if bits and bits[0] in ("pswpout", "pswpin", "pgmajfault", "oom_kill"):
            vm[bits[0]] = int(bits[1])
    psi = {}
    for line in pathlib.Path("/proc/pressure/memory").read_text().splitlines():
        bits = line.split()
        if bits and bits[0] in ("some", "full"):
            psi[bits[0]] = float(bits[1].split("=")[1])
    disk = os.statvfs("/")
    if set(mem) != {"MemAvailable", "SwapFree"} or set(vm) != {"pswpout", "pswpin", "pgmajfault", "oom_kill"} or set(psi) != {"some", "full"}:
        raise RuntimeError("host_metric_unavailable")
    return {
        "t": time.monotonic() - start,
        "mem_available_kib": mem["MemAvailable"],
        "swap_free_kib": mem["SwapFree"],
        "disk_free_mib": disk.f_bavail * disk.f_frsize // 1048576,
        "psi_full_avg10": psi["full"],
        "psi_some_avg10": psi["some"],
        **vm,
    }


def probe_http(opener):
    failures = []
    ready_latency = 0.0
    for label, url in URLS:
        started = time.monotonic()
        try:
            with opener.open(url, timeout=3) as response:
                status = response.status
        except (OSError, urllib.error.URLError):
            status = 0
        latency = time.monotonic() - started
        if label == "prod_ready":
            ready_latency = latency
        if status != 200:
            failures.append({"route": label, "status": status})
    return failures, ready_latency


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--trace-output", help="optional local metrics-only JSON path, created mode 0600")
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("root is required for complete cgroup PSS and Docker health evidence")
    started_utc = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        before = docker_state()
        groups = {name: cgroup_for(row["pid"]) for name, row in before.items()}
        original_pids = {name: cgroup_pids(group) for name, group in groups.items()}
        checks = {
            "container_check_start": containers_healthy(before),
            "approvals_start": approval_counts(),
            "http_failures": [],
            "prod_ready_latency_max_s": 0.0,
        }
        steady_before = steady_web_pss(groups["holymedia-qrs-test-qrs_web-1"])
        opener = urllib.request.build_opener(NoRedirect())
        samples = []
        window = deque()
        minute_bins = [{"out": 0, "in": 0} for _ in range(11)]
        early_abort = []
        transient = {}
        observer_peak_pss = 0
        cpu_before = time.process_time()
        start = time.monotonic()
        next_http = start
        deadline = start + LIMITS["duration_s"]
        while time.monotonic() < deadline:
            sample = sample_at(start)
            if samples:
                minute = min(10, int(sample["t"] // 60))
                minute_bins[minute]["out"] += max(0, sample["pswpout"] - samples[-1]["pswpout"])
                minute_bins[minute]["in"] += max(0, sample["pswpin"] - samples[-1]["pswpin"])
            samples.append(sample)
            window.append(sample)
            while len(window) > 1 and window[1]["t"] <= sample["t"] - 60:
                window.popleft()
            for name, group in groups.items():
                for pid in cgroup_pids(group) - original_pids[name]:
                    value = pss_kib(pid)
                    if value is not None:
                        transient[name] = max(transient.get(name, 0), value)
            observer_peak_pss = max(observer_peak_pss, pss_kib(os.getpid()) or 0)
            if time.monotonic() >= next_http:
                next_http = time.monotonic() + 10
                failures, latency = probe_http(opener)
                checks["http_failures"].extend(failures)
                checks["prod_ready_latency_max_s"] = max(checks["prod_ready_latency_max_s"], latency)
            early_abort = immediate_reasons(
                sample, samples[0], window[0], checks["http_failures"], checks["prod_ready_latency_max_s"]
            )
            if any(all(minute_bins[j]["out"] > 0 for j in range(i, i + 3)) for i in range(len(minute_bins) - 2)):
                early_abort.append("sustained_swap_out")
            if any(all(minute_bins[j]["out"] > 0 and minute_bins[j]["in"] > 0 for j in range(i, i + 2)) for i in range(len(minute_bins) - 1)):
                early_abort.append("sustained_swap_in_out")
            if early_abort:
                break
            time.sleep(min(0.25, max(0, deadline - time.monotonic())))
        if not early_abort:
            samples.append(sample_at(start))
        after = docker_state()
        checks["container_check_end"] = containers_healthy(after) and all(
            before[name]["image"] == after[name]["image"]
            and before[name]["restarts"] == after[name]["restarts"]
            and before[name]["pid"] == after[name]["pid"]
            for name in CONTAINERS
        )
        checks["approvals_end"] = approval_counts()
        steady_after = steady_web_pss(groups["holymedia-qrs-test-qrs_web-1"])
        result = evaluate_trace(samples, checks)
        if early_abort:
            result["status"] = "FAIL"
            result["reasons"] = sorted(set(result["reasons"] + early_abort))
        result.update({
            "profile": "TEST_WEB_ONLY_V1",
            "started_utc": started_utc,
            "ended_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "checks": checks,
            "observer_peak_pss_kib": observer_peak_pss,
            "observer_cpu_s": round(time.process_time() - cpu_before, 3),
            "transient_peak_pss_kib": transient,
            "steady_web_pss_before_kib": steady_before,
            "steady_web_pss_after_kib": steady_after,
            "median_mem_available_kib": int(statistics.median(row["mem_available_kib"] for row in samples)),
        })
        if args.trace_output:
            payload = json.dumps({"samples": samples, "checks": checks}, separators=(",", ":"))
            fd = os.open(args.trace_output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as destination:
                destination.write(payload)
            result["trace_sha256"] = hashlib.sha256(payload.encode()).hexdigest()
            result["trace_path"] = args.trace_output
        print(json.dumps(result, sort_keys=True))
        return 0 if result["status"] == "PASS" else 1
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(json.dumps({"profile": "TEST_WEB_ONLY_V1", "status": "FAIL", "reasons": [type(error).__name__]}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
