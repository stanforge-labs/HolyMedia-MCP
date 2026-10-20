#!/usr/bin/env python3
"""Opt-in V2 production guard; V1 remains unchanged and is the default."""

import argparse
from collections import deque
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import urllib.error
import urllib.request

from production_only_guard_policy import (
    LIMITS, PROD, TEST, container_reasons, http_reasons,
)
from production_only_guard_policy_v2 import (
    PROFILE, episode_streaming_reasons, evaluate_trace, streaming_reasons,
)

URLS = {"health": "https://mcp.holymedia.kz/health",
        "ready": "https://mcp.holymedia.kz/ready"}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def docker_state():
    fmt = ("{{.Name}}|{{.Id}}|{{.Image}}|{{.State.Status}}|"
           "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|"
           "{{.HostConfig.RestartPolicy.Name}}|{{.RestartCount}}|{{.State.OOMKilled}}")
    output = subprocess.check_output(
        ["docker", "inspect", "--format", fmt, *(PROD + TEST)],
        text=True, timeout=20)
    rows = {}
    for line in output.splitlines():
        fields = line.split("|")
        if len(fields) != 8:
            raise ValueError("container_inspect_malformed")
        name, cid, image, status, health, restart, restarts, oom = fields
        rows[name.lstrip("/")] = dict(id=cid, image=image, status=status,
            health=health, restart=restart, restarts=int(restarts), oom=oom == "true")
    if set(rows) != set(PROD + TEST):
        raise ValueError("container_inventory_incomplete")
    return rows


def host_sample(start):
    mem = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        parts = line.split()
        if parts and parts[0] in ("MemAvailable:", "SwapFree:"):
            mem[parts[0][:-1]] = int(parts[1])
    vm = {}
    for line in Path("/proc/vmstat").read_text().splitlines():
        parts = line.split()
        if parts and parts[0] in ("pswpout", "pswpin", "pgmajfault", "oom_kill",
                                  "pgscan_direct"):
            vm[parts[0]] = int(parts[1])
    psi = {}
    for line in Path("/proc/pressure/memory").read_text().splitlines():
        parts = line.split()
        if parts and parts[0] in ("some", "full"):
            psi[parts[0]] = float(parts[1].split("=")[1])
    if set(mem) != {"MemAvailable", "SwapFree"} or set(vm) != {
            "pswpout", "pswpin", "pgmajfault", "oom_kill", "pgscan_direct"} or set(psi) != {"some", "full"}:
        raise ValueError("host_metric_unavailable")
    disk = os.statvfs("/")
    return dict(t=time.monotonic() - start, mem_available_kib=mem["MemAvailable"],
        swap_free_kib=mem["SwapFree"],
        disk_free_mib=disk.f_bavail * disk.f_frsize // 1048576,
        psi_full_avg10=psi["full"], psi_some_avg10=psi["some"], **vm)


def probe_route(opener, name, url):
    start = time.monotonic()
    status, error = None, None
    try:
        with opener.open(url, timeout=3) as response:
            status = response.status
            response.read(1)
    except urllib.error.HTTPError as exc:
        status = exc.code
    except (TimeoutError, socket.timeout):
        error = "timeout"
    except urllib.error.URLError as exc:
        error = "timeout" if isinstance(exc.reason, (TimeoutError, socket.timeout)) else "network"
    except OSError:
        error = "network"
    return {"route": name, "status": status, "duration_s": round(time.monotonic() - start, 4),
            "timeout_s": 3, "error": error}


def probe_http(opener):
    # Independent clocks and statuses: no sum is treated as /ready latency.
    return {name: probe_route(opener, name, url) for name, url in URLS.items()}


def load_checkpoint(path):
    stat = path.stat()
    if stat.st_mode & 0o077 or not path.is_file():
        raise ValueError("checkpoint_permissions_or_type")
    payload = json.loads(path.read_text())
    if set(payload) != set(TEST) or any(
            not isinstance(payload[name].get("id"), str) or
            not isinstance(payload[name].get("image"), str)
            for name in TEST):
        raise ValueError("checkpoint_incomplete")
    return payload


def observe(checkpoint, trace, *, phase):
    if phase not in ("precutover", "poststart"):
        raise ValueError("invalid_v2_guard_phase")
    start = time.monotonic()
    opener = urllib.request.build_opener(NoRedirect())
    samples, observations, window = [], [], deque()
    reasons = []
    next_external = start
    baseline = None
    while True:
        sample = host_sample(start)
        samples.append(sample)
        full_interval = sample["t"] - samples[0]["t"] >= LIMITS["duration_s"]
        window.append(sample)
        while len(window) > 1 and window[1]["t"] <= sample["t"] - 60:
            window.popleft()
        trace.write(json.dumps({"type": "sample", **sample}, sort_keys=True) + "\n")
        reasons.extend(streaming_reasons(sample, samples[0], window[0], phase=phase))
        reasons.extend(episode_streaming_reasons(samples, phase=phase))
        if len(samples) > 1 and sample["t"] - samples[-2]["t"] > LIMITS["max_sample_gap_s"]:
            reasons.append("sample_gap_or_clock_error")
        if start + sample["t"] >= next_external or full_interval:
            rows = docker_state()
            if baseline is None:
                baseline = rows
            probes = probe_http(opener)
            event = {"t": sample["t"], "containers": rows, "http": probes,
                     "checked_t": time.monotonic() - start,
                     "swap_out_delta": sample["pswpout"] - samples[0]["pswpout"]}
            observations.append(event)
            trace.write(json.dumps({"type": "external", **event}, sort_keys=True) + "\n")
            reasons.extend(container_reasons(rows, checkpoint, baseline))
            reasons.extend(http_reasons(probes, event["swap_out_delta"]))
            next_external = time.monotonic() + 30
        trace.flush()
        if reasons or full_interval:
            break
        deadline = start + samples[0]["t"] + LIMITS["duration_s"]
        time.sleep(min(1, max(0, deadline - time.monotonic())))
    result = evaluate_trace(samples, observations, checkpoint, phase=phase)
    result["reasons"] = sorted(set(result["reasons"] + reasons))
    if result["reasons"]:
        result["status"] = "FAIL"
    trace.write(json.dumps({"type": "result", "profile": PROFILE, "phase": phase,
                            "status": result["status"], "warnings": result["warnings"],
                            "reasons": result["reasons"],
                            "duration_exact_s": result["duration_exact_s"]},
                           sort_keys=True) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--trace-output", required=True, type=Path)
    parser.add_argument("--phase", required=True, choices=("precutover", "poststart"))
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("root_required")
    if args.trace_output.is_symlink() or args.trace_output.exists():
        parser.error("trace_must_be_new")
    fd = os.open(args.trace_output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", buffering=1) as trace:
            try:
                checkpoint = load_checkpoint(args.checkpoint)
                result = observe(checkpoint, trace, phase=args.phase)
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
                known = {"checkpoint_permissions_or_type", "checkpoint_incomplete",
                         "container_inspect_malformed", "container_inventory_incomplete",
                         "host_metric_unavailable"}
                code = (str(exc) if str(exc) in known else
                        "docker_inspect_timeout" if isinstance(exc, subprocess.TimeoutExpired) else
                        "docker_inspect_failed" if isinstance(exc, subprocess.CalledProcessError) else
                        "observation_error:" + type(exc).__name__)
                result = {"profile": PROFILE, "status": "FAIL",
                          "reasons": [code]}
                trace.write(json.dumps({"type": "error", "code": result["reasons"][0]}) + "\n")
        result["trace_sha256"] = hashlib.sha256(args.trace_output.read_bytes()).hexdigest()
        result["trace_path"] = str(args.trace_output)
        print(json.dumps(result, sort_keys=True), flush=True)
        return 0 if result["status"] == "PASS" else 1
    except BaseException:
        # A signal or abrupt termination leaves an incomplete trace, never PASS.
        raise


if __name__ == "__main__":
    raise SystemExit(main())
