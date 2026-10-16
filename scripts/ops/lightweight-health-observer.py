#!/usr/bin/env python3
"""Read-only, single-process cgroup/healthcheck observer for the shared VPS.

Run locally on the VPS as root. Docker is queried once at startup; the sampling
loop reads only procfs/cgroupfs and sleeps between samples. No env or logs are read.
"""

import argparse
import json
import os
import pathlib
import subprocess
import time
import urllib.error
import urllib.request
import statistics


NAMES = (
    "holymedia-qrs-test-qrs_api-1",
    "holymedia-qrs-test-qrs_web-1",
    "holymedia-google-acceptance-postgres-1",
    "holymedia-google-acceptance-redis-1",
    "holymedia-v2-api-1",
    "holymedia-v2-web-1",
    "holymedia-v2-worker-1",
)
NODE_NAMES = {
    name
    for name in NAMES
    if name.startswith("holymedia-qrs-test-")
    or name in ("holymedia-v2-api-1", "holymedia-v2-web-1", "holymedia-v2-worker-1")
}


def key_value(path, key):
    try:
        for line in pathlib.Path(path).read_text().splitlines():
            bits = line.split()
            if bits and bits[0].rstrip(":") == key:
                return int(bits[1])
    except (OSError, ValueError, IndexError):
        pass
    return None


def process_memory_kib(pid):
    try:
        values = {}
        for line in pathlib.Path(f"/proc/{pid}/smaps_rollup").read_text().splitlines():
            bits = line.split()
            if bits and bits[0] in ("Pss:", "Rss:"):
                values[bits[0]] = int(bits[1])
        return values.get("Pss:"), values.get("Rss:")
    except (OSError, ValueError, IndexError):
        return None, None


def faults(pid):
    try:
        stat = pathlib.Path(f"/proc/{pid}/stat").read_text()
        fields = stat[stat.rfind(")") + 2 :].split()
        return int(fields[7]), int(fields[9])  # minflt and majflt
    except (OSError, ValueError, IndexError):
        return None


def cgroup_path(pid):
    for line in pathlib.Path(f"/proc/{pid}/cgroup").read_text().splitlines():
        if line.startswith("0::"):
            return pathlib.Path("/sys/fs/cgroup" + line[3:])
    raise RuntimeError(f"no unified cgroup for pid {pid}")


def process_ids(cgroup):
    try:
        return [int(p) for p in (cgroup / "cgroup.procs").read_text().split()]
    except OSError:
        return []


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=int, default=70)
    parser.add_argument("--interval", type=float, default=0.1)
    parser.add_argument("--cutover-guard", action="store_true")
    args = parser.parse_args()
    if not 10 <= args.seconds <= 660:
        parser.error("seconds must be 10..660")
    if not 0.1 <= args.interval <= 2.0:
        parser.error("interval must be 0.1..2.0")

    # Format at the Docker CLI boundary so environment and protected config
    # never enter this observer's input or output.
    rows = subprocess.check_output(
        ["docker", "inspect", "--format", "{{.Name}} {{.State.Pid}}", *NAMES],
        text=True,
    )
    groups = {
        name.removeprefix("/"): cgroup_path(int(pid))
        for name, pid in (row.split() for row in rows.splitlines())
    }
    original = {name: set(process_ids(cg)) for name, cg in groups.items()}
    transient = {}
    observer_pss = 0
    minimum_available = None
    available_samples = []
    minimum_swap_free = None
    minimum_disk_free_mib = None
    maximum_prod_latency = 0.0
    failed_http_checks = []
    next_http_check = 0.0
    swap_before = key_value("/proc/vmstat", "pswpout")
    vm_before = {
        key: key_value("/proc/vmstat", key)
        for key in ("pswpin", "pgscan_direct", "pgscan_kswapd", "oom_kill")
    }
    swap_during_transient = 0
    peak_full_psi = 0.0
    peak_simultaneous_probes = 0
    peak_simultaneous_test_probes = 0
    peak_simultaneous_pss_kib = 0
    last_swap = swap_before
    samples = 0
    cpu_start = time.process_time()
    end = time.monotonic() + args.seconds
    while time.monotonic() < end:
        samples += 1
        active = []
        active_test = 0
        active_node = 0
        active_pss = 0
        for name, cg in groups.items():
            for pid in process_ids(cg):
                if pid in original[name]:
                    continue
                active.append(pid)
                if name in NODE_NAMES:
                    active_node += 1
                if name.startswith("holymedia-qrs-test-"):
                    active_test += 1
                item = transient.setdefault(
                    pid, {"container": name, "peak_pss_kib": 0, "peak_rss_kib": 0, "faults_first": None, "faults_last": None},
                )
                pss, rss = process_memory_kib(pid)
                if pss is not None:
                    item["peak_pss_kib"] = max(item["peak_pss_kib"], pss)
                    if name in NODE_NAMES:
                        active_pss += pss
                if rss is not None:
                    item["peak_rss_kib"] = max(item["peak_rss_kib"], rss)
                value = faults(pid)
                if value:
                    item["faults_first"] = item["faults_first"] or value
                    item["faults_last"] = value
        peak_simultaneous_probes = max(peak_simultaneous_probes, active_node)
        peak_simultaneous_test_probes = max(peak_simultaneous_test_probes, active_test)
        peak_simultaneous_pss_kib = max(peak_simultaneous_pss_kib, active_pss)
        swap_now = key_value("/proc/vmstat", "pswpout")
        if swap_now is not None and last_swap is not None:
            if active:
                swap_during_transient += max(0, swap_now - last_swap)
            last_swap = swap_now
        available = key_value("/proc/meminfo", "MemAvailable")
        if available is not None:
            minimum_available = min(minimum_available or available, available)
            available_samples.append(available)
        if args.cutover_guard:
            swap_free = key_value("/proc/meminfo", "SwapFree")
            if swap_free is not None:
                minimum_swap_free = min(minimum_swap_free or swap_free, swap_free)
            disk_free_mib = os.statvfs("/").f_bavail * os.statvfs("/").f_frsize // 1048576
            minimum_disk_free_mib = min(minimum_disk_free_mib or disk_free_mib, disk_free_mib)
            if time.monotonic() >= next_http_check:
                next_http_check = time.monotonic() + 10
                for label, url in (
                    ("prod_health", "https://mcp.holymedia.kz/health"),
                    ("prod_ready", "https://mcp.holymedia.kz/ready"),
                    ("test_api", "http://127.0.0.1:14404/ready"),
                    ("test_web_auth", "http://127.0.0.1:13300/auth"),
                    ("test_web_approve", "http://127.0.0.1:13300/mcp/approve"),
                ):
                    started = time.monotonic()
                    try:
                        with urllib.request.urlopen(url, timeout=3) as response:
                            status = response.status
                    except (OSError, urllib.error.URLError):
                        status = 0
                    latency = time.monotonic() - started
                    if label == "prod_ready":
                        maximum_prod_latency = max(maximum_prod_latency, latency)
                    if status != 200 or (label == "prod_ready" and latency >= 0.8):
                        failed_http_checks.append({"check": label, "status": status, "latency_s": round(latency, 3)})
        try:
            for line in pathlib.Path("/proc/pressure/memory").read_text().splitlines():
                if line.startswith("full "):
                    peak_full_psi = max(peak_full_psi, float(line.split()[1].split("=")[1]))
        except (OSError, ValueError, IndexError):
            pass
        observer_pss = max(observer_pss, process_memory_kib(os.getpid())[0] or 0)
        time.sleep(args.interval)

    by_container = {}
    for item in transient.values():
        first, last = item["faults_first"], item["faults_last"]
        item["minor_faults_observed"] = (last[0] - first[0]) if first and last else None
        item["major_faults_observed"] = (last[1] - first[1]) if first and last else None
        del item["faults_first"], item["faults_last"]
        bucket = by_container.setdefault(item["container"], {"count": 0, "peak_pss_kib": 0, "peak_rss_kib": 0, "minor_faults_observed": 0, "major_faults_observed": 0})
        bucket["count"] += 1
        bucket["peak_pss_kib"] = max(bucket["peak_pss_kib"], item["peak_pss_kib"])
        bucket["peak_rss_kib"] = max(bucket["peak_rss_kib"], item["peak_rss_kib"])
        bucket["minor_faults_observed"] += item["minor_faults_observed"] or 0
        bucket["major_faults_observed"] += item["major_faults_observed"] or 0
    vm_after = {
        key: key_value("/proc/vmstat", key)
        for key in vm_before
    }
    print(json.dumps({
        "duration_s": args.seconds,
        "interval_s": args.interval,
        "samples": samples,
        "observer_cpu_seconds": round(time.process_time() - cpu_start, 3),
        "observer_peak_pss_kib": observer_pss,
        "minimum_mem_available_kib": minimum_available,
        "median_mem_available_kib": int(statistics.median(available_samples)) if available_samples else None,
        "minimum_swap_free_kib": minimum_swap_free,
        "minimum_disk_free_mib": minimum_disk_free_mib,
        "maximum_prod_ready_latency_s": round(maximum_prod_latency, 3) if args.cutover_guard else None,
        "failed_http_checks": failed_http_checks,
        "swap_out_pages": (last_swap - swap_before) if last_swap is not None and swap_before is not None else None,
        "swap_out_pages_while_transient_seen": swap_during_transient,
        "vmstat_deltas": {
            key: vm_after[key] - before
            for key, before in vm_before.items()
            if before is not None and vm_after[key] is not None
        },
        "peak_memory_full_psi_avg10": peak_full_psi,
        "peak_simultaneous_probes": peak_simultaneous_probes,
        "peak_simultaneous_test_probes": peak_simultaneous_test_probes,
        "peak_simultaneous_probe_pss_kib": peak_simultaneous_pss_kib,
        "transient_processes": by_container,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
