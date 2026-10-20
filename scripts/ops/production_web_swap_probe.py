#!/usr/bin/env python3
"""Small procfs/cgroup snapshot for a separately approved Web-stop diagnosis.

No Docker CLI, network, command lines, environment values or process memory is read.
Missing PIDs/cgroups are explicit because the old Web can exit between samples.
"""

import json
import os
from pathlib import Path, PurePosixPath
import statistics
import time

PROC = Path("/proc")
CGROUP = Path("/sys/fs/cgroup")
HOST_KEYS = {"pswpin", "pswpout", "pgmajfault", "pgscan_direct",
             "pgscan_kswapd", "oom_kill"}
GROUP_KEYS = {"pgmajfault", "workingset_refault_anon", "pgscan", "pgsteal"}
DAEMONS = ("dockerd", "containerd", "containerd-shim")
MAX_PIDS = 64
MAX_GROUPS = 16
MAX_PASSIVE_PIDS = 16
MAX_PASSIVE_GROUPS = 16


def numeric_fields(path, keys):
    result = {}
    for line in path.read_text().splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0].rstrip(":") in keys:
            result[parts[0].rstrip(":")] = int(parts[1])
    return result


def process_group(pid):
    for line in (PROC / str(pid) / "cgroup").read_text().splitlines():
        if line.startswith("0::"):
            value = line[3:]
            if not value.startswith("/") or ".." in Path(value).parts:
                raise ValueError("invalid_cgroup_path")
            return value
    raise ValueError("cgroup_v2_required")


def process_info(pid):
    stat = (PROC / str(pid) / "stat").read_text()
    left, right = stat.find("("), stat.rfind(")")
    if left < 0 or right <= left:
        raise ValueError("invalid_proc_stat")
    tail = stat[right + 2:].split()
    name = stat[left + 1:right][:64]
    swap = numeric_fields(PROC / str(pid) / "status", {"VmSwap"}).get("VmSwap", 0)
    return {"pid": pid, "name": name, "major_faults": int(tail[9]),
            "start_ticks": int(tail[19]), "vm_swap_kib": swap,
            "cgroup": process_group(pid)}


def select(web_pid):
    if not isinstance(web_pid, int) or web_pid <= 1:
        raise ValueError("invalid_web_pid")
    web = process_info(web_pid)
    chosen = {web_pid: web}
    for entry in PROC.iterdir():
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        if pid == web_pid:
            continue
        try:
            name = (entry / "comm").read_text().strip()
            if name.startswith(DAEMONS) or process_group(pid) == web["cgroup"]:
                chosen[pid] = process_info(pid)
        except (OSError, ValueError, IndexError):
            continue  # A short-lived process disappeared during selection.
        if len(chosen) > MAX_PIDS:
            raise ValueError("too_many_selected_pids")
    groups = sorted({item["cgroup"] for item in chosen.values()})
    if len(groups) > MAX_GROUPS:
        raise ValueError("too_many_selected_cgroups")
    return {"web_pid": web_pid,
            "pids": {str(pid): item["start_ticks"] for pid, item in chosen.items()},
            "cgroups": groups}


def select_passive():
    """Select current processes and their cgroups without asking Docker.

    The PID/cgroup lists are bounded. Broad slice parents and the most relevant
    leaf groups are preferred; omissions are explicit and forbid a complete
    per-process attribution claim.
    """
    found = []
    groups = {"/"}
    attempted = 0
    skipped = 0
    for entry in PROC.iterdir():
        if not entry.name.isdigit():
            continue
        attempted += 1
        try:
            info = process_info(int(entry.name))
        except (OSError, ValueError, IndexError):
            skipped += 1
            continue
        found.append(info)
        path = PurePosixPath(info["cgroup"])
        while path != PurePosixPath("/"):
            groups.add(str(path))
            path = path.parent
    if not found:
        raise ValueError("passive_selection_incomplete")
    found.sort(key=lambda row: (row["name"].startswith(DAEMONS),
                                row["vm_swap_kib"]), reverse=True)
    chosen = found[:MAX_PASSIVE_PIDS]
    priority = []
    for name in ("/system.slice", "/user.slice", "/machine.slice"):
        if name in groups:
            priority.append(name)
    for row in chosen:
        if row["name"].startswith(DAEMONS) and row["cgroup"] not in priority:
            priority.append(row["cgroup"])

    def score(name):
        path = CGROUP / name.lstrip("/")
        try:
            swap = int((path / "memory.swap.current").read_text())
            memory = int((path / "memory.current").read_text())
            return swap, memory
        except (OSError, ValueError):
            return 0, 0

    remainder = sorted(groups.difference(priority),
                       key=lambda name: (score(name), name), reverse=True)
    selected_groups = (priority + remainder)[:MAX_PASSIVE_GROUPS]
    return {"pids": {str(row["pid"]): row["start_ticks"] for row in chosen},
            "cgroups": selected_groups,
            "coverage": {"attempted_pids": attempted, "skipped_pids": skipped,
                         "discovered_pids": len(found), "selected_pids": len(chosen),
                         "discovered_cgroups": len(groups),
                         "selected_cgroups": len(selected_groups)}}


def correlate(before, after):
    """Return contemporaneous counter deltas, never a causal attribution."""
    host_before = before["host"]["vm"]
    host_after = after["host"]["vm"]
    host = {key: host_after[key] - host_before[key]
            for key in HOST_KEYS if key in host_before and key in host_after}
    groups = {}
    missing = []
    for name in before["cgroups"].keys() | after["cgroups"].keys():
        a = before["cgroups"].get(name, {"gone": True})
        b = after["cgroups"].get(name, {"gone": True})
        if a.get("gone") or b.get("gone"):
            missing.append("cgroup:" + name)
            continue
        delta = {key: b[key] - a[key] for key in a.keys() & b.keys()
                 if isinstance(a[key], int) and isinstance(b[key], int)}
        if any(value != 0 for value in delta.values()):
            groups[name] = delta
    pids = {}
    for pid in before["pids"].keys() | after["pids"].keys():
        a = before["pids"].get(pid, {"gone": True})
        b = after["pids"].get(pid, {"gone": True})
        if a.get("gone") or b.get("gone") or a["start_ticks"] != b["start_ticks"]:
            missing.append("pid:" + pid)
            continue
        delta = {"major_faults": b["major_faults"] - a["major_faults"],
                 "vm_swap_kib": b["vm_swap_kib"] - a["vm_swap_kib"]}
        if any(value != 0 for value in delta.values()):
            pids[pid] = {"cgroup": b["cgroup"], **delta}
    return {"host": host, "cgroups": groups, "pids": pids,
            "missing": sorted(missing), "attribution": "correlation_only"}


def capture(selection, phase):
    if not isinstance(selection, dict) or not isinstance(selection.get("pids"), dict):
        raise ValueError("invalid_probe_selection")
    vm = numeric_fields(PROC / "vmstat", HOST_KEYS)
    if not {"pswpin", "pswpout", "pgmajfault", "oom_kill"} <= vm.keys():
        raise ValueError("host_vmstat_incomplete")
    mem = numeric_fields(PROC / "meminfo", {"MemAvailable", "SwapFree"})
    if len(mem) != 2:
        raise ValueError("host_meminfo_incomplete")
    psi = {}
    for line in (PROC / "pressure" / "memory").read_text().splitlines():
        parts = line.split()
        if parts and parts[0] in ("some", "full"):
            fields = dict(part.split("=", 1) for part in parts[1:])
            psi[parts[0]] = {"avg10": float(fields["avg10"]),
                             "total_us": int(fields["total"])}
    if set(psi) != {"some", "full"}:
        raise ValueError("host_psi_incomplete")
    pids = {}
    for raw_pid, expected_start in selection["pids"].items():
        pid = int(raw_pid)
        try:
            info = process_info(pid)
            pids[raw_pid] = info if info["start_ticks"] == expected_start else {"gone": True}
        except (OSError, ValueError, IndexError):
            pids[raw_pid] = {"gone": True}
    groups = {}
    for group in selection.get("cgroups", []):
        if not isinstance(group, str) or not group.startswith("/") or ".." in Path(group).parts:
            raise ValueError("invalid_cgroup_path")
        path = CGROUP / group.lstrip("/")
        try:
            groups[group] = {**numeric_fields(path / "memory.stat", GROUP_KEYS),
                             "swap_bytes": int((path / "memory.swap.current").read_text())}
        except (OSError, ValueError):
            groups[group] = {"gone": True}
    return {"epoch": time.time(), "monotonic": time.monotonic(), "phase": phase,
            "host": {"vm": vm, "mem": mem, "psi": psi}, "pids": pids,
            "cgroups": groups}


def benchmark(selection, count=40):
    if count < 5 or count > 100:
        raise ValueError("invalid_probe_count")
    durations = []
    for _ in range(count):
        start = time.monotonic()
        capture(selection, "benchmark")
        durations.append((time.monotonic() - start) * 1000)
    ordered = sorted(durations)
    return {"samples": count, "median_ms": statistics.median(ordered),
            "p95_ms": ordered[int(0.95 * (count - 1))], "max_ms": ordered[-1]}


def read_selection(path):
    if path.is_symlink() or path.stat().st_mode & 0o077:
        raise ValueError("selection_permissions_or_type")
    return json.loads(path.read_text())
