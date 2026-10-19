#!/usr/bin/env python3
"""One owner-authorized TEST-stop diagnosis with fail-safe TEST restoration.

The existing production Web resource guard is executed byte-for-byte unchanged.
This observer reads procfs/cgroupfs only; it never pulls images or changes config.
Run under a transient systemd service with an ExecStopPost --restore backstop.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time


TEST = ("holymedia-qrs-test-qrs_api-1", "holymedia-qrs-test-qrs_web-1")
PROD = ("holymedia-v2-api-1", "holymedia-v2-web-1", "holymedia-v2-worker-1",
        "holymedia-v2-postgres-1", "holymedia-v2-redis-1")
TEST_DATA = ("holymedia-google-acceptance-postgres-1",
             "holymedia-google-acceptance-redis-1")
ALL = PROD + TEST_DATA + TEST
DB = TEST_DATA[0]
GUARD = Path("/var/backups/adforge-mcp/holypilot-brand-only-20261016T173131Z/resource-guard.py")
GUARD_SHA256 = "6f256d9b68bc6c909a6a4754bfda003333fe01ab80027e4c0d5db799374a5fa4"
SQL = (
    "SELECT "
    "(SELECT count(*) FROM mcp_previews WHERE consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>now()),"
    "(SELECT count(*) FROM mcp_previews WHERE confirmed_at IS NOT NULL AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>now()),"
    "(SELECT count(*) FROM mcp_previews WHERE commit_attempted_at IS NOT NULL AND commit_status IS NULL),"
    "(SELECT count(*) FROM oauth_authorization_transactions WHERE consumed_at IS NULL AND expires_at>now()),"
    "(SELECT count(*) FROM oauth_states WHERE consumed_at IS NULL AND expires_at>now()),"
    "(SELECT count(*) FROM google_login_states WHERE consumed_at IS NULL AND expires_at>now());"
)


def command(args, timeout=35):
    return subprocess.check_output(args, text=True, timeout=timeout).strip()


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n")


def inspect():
    fmt = "{{.Name}}|{{.Id}}|{{.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.OOMKilled}}|{{.RestartCount}}|{{.HostConfig.RestartPolicy.Name}}"
    rows = command(["docker", "inspect", "--format", fmt, *ALL]).splitlines()
    if len(rows) != len(ALL):
        raise RuntimeError("container_inventory_incomplete")
    result = {}
    for row in rows:
        name, cid, image, status, health, oom, restarts, restart_policy = row.split("|")
        result[name.removeprefix("/")] = dict(id=cid, image=image, status=status,
            health=health, oom=oom, restarts=int(restarts), restart_policy=restart_policy)
    return result


def compose_hashes():
    fmt = '{{index .Config.Labels "com.docker.compose.project.config_files"}}'
    paths = set()
    for row in command(["docker", "inspect", "--format", fmt, *ALL]).splitlines():
        paths.update(part for part in row.split(",") if part)
    return {path: hashlib.sha256(Path(path).read_bytes()).hexdigest() for path in sorted(paths)}


def operations():
    sql = command(["docker", "exec", DB, "sh", "-c",
                   'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "|" -c "$1"',
                   "sh", SQL])
    counts = [int(x) for x in sql.split("|")]
    if len(counts) != 6:
        raise RuntimeError("incomplete_operation_counts")
    return dict(zip(("open_previews", "confirmed_previews", "inflight_commits",
                     "oauth_transactions", "oauth_states", "login_states"), counts))


def proc_values():
    result = {}
    for entry in os.scandir("/proc"):
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        try:
            raw = Path(f"/proc/{pid}/stat").read_text()
            tail = raw[raw.rfind(")") + 2:].split()
            name = raw[raw.find("(") + 1:raw.rfind(")")]
            major = int(tail[9])       # stat field 12
            start = int(tail[19])       # stat field 22, protects against PID reuse
            group = Path(f"/proc/{pid}/cgroup").read_text().splitlines()[0].split("::", 1)[-1]
            swap = 0
            for line in Path(f"/proc/{pid}/status").read_text().splitlines():
                if line.startswith("VmSwap:"):
                    swap = int(line.split()[1])
                    break
            result[str(pid)] = dict(name=name, major=major, start=start, group=group, swap_kib=swap)
        except (OSError, ValueError, IndexError):
            continue
    return result


def value_file(path, keys):
    result = {}
    for line in path.read_text().splitlines():
        parts = line.split()
        if parts and parts[0].rstrip(":") in keys:
            result[parts[0].rstrip(":")] = int(parts[1])
    return result


def cgroup_paths():
    base = Path("/sys/fs/cgroup")
    paths = [base / "system.slice", base / "user.slice"]
    for parent in tuple(paths):
        paths.extend(path for path in parent.iterdir() if path.is_dir() and (path / "memory.stat").exists())
    return paths


def snapshot(groups):
    vm = value_file(Path("/proc/vmstat"),
        {"pswpin", "pswpout", "pgmajfault", "oom_kill", "pgscan_direct", "pgscan_kswapd"})
    mem = value_file(Path("/proc/meminfo"), {"MemAvailable", "SwapFree"})
    psi = {}
    for line in Path("/proc/pressure/memory").read_text().splitlines():
        parts = line.split()
        if parts and parts[0] in ("some", "full"):
            psi[parts[0]] = {key: float(value) for key, value in
                             (piece.split("=", 1) for piece in parts[1:])}
    cg = {}
    for path in groups:
        try:
            stats = value_file(path / "memory.stat",
                {"pgmajfault", "workingset_refault_anon", "pgscan", "pgsteal"})
            stats["swap_bytes"] = int((path / "memory.swap.current").read_text())
            cg[str(path.relative_to("/sys/fs/cgroup"))] = stats
        except (OSError, ValueError):
            continue
    return dict(utc=time.time(), mono=time.monotonic(), vm=vm, mem=mem,
                psi=psi, cgroups=cg, processes=proc_values())


def compact(now, old):
    changed_cg = {}
    for group, values in now["cgroups"].items():
        before = old["cgroups"].get(group)
        if before is None:
            continue
        delta = {key: val - before.get(key, val) for key, val in values.items()}
        if any(delta.values()):
            changed_cg[group] = delta
    changed_proc = []
    for pid, values in now["processes"].items():
        before = old["processes"].get(pid)
        if before is None or before["start"] != values["start"]:
            continue
        major = values["major"] - before["major"]
        swap = values["swap_kib"] - before["swap_kib"]
        if major or swap:
            changed_proc.append(dict(pid=int(pid), name=values["name"], group=values["group"],
                                     major=major, swap_kib=swap))
    return dict(utc=now["utc"], mono=now["mono"],
        vm={k: v - old["vm"].get(k, v) for k, v in now["vm"].items()},
        mem=now["mem"], psi=now["psi"], cgroups=changed_cg,
        processes=changed_proc)


def restore(run_dir):
    state_path = run_dir / "state.json"
    if not state_path.exists():
        return
    state = json.loads(state_path.read_text())
    errors = []
    for name in TEST:
        try:
            current = inspect()[name]
            if current["id"] != state["containers"][name]["id"] or \
               current["image"] != state["containers"][name]["image"]:
                raise RuntimeError("container_id_changed")
            if current["status"] != "running":
                command(["docker", "start", name], timeout=45)
        except Exception as exc:
            errors.append(f"{name}:{type(exc).__name__}:{exc}")
    deadline = time.monotonic() + 180
    last = {}
    while time.monotonic() < deadline:
        try:
            last = inspect()
            if all(last[n]["status"] == "running" and last[n]["health"] == "healthy" and
                   last[n]["id"] == state["containers"][n]["id"] and
                   last[n]["image"] == state["containers"][n]["image"] for n in ALL):
                break
        except Exception as exc:
            errors.append(f"health:{type(exc).__name__}:{exc}")
        time.sleep(5)
    else:
        errors.append("full_stack_not_healthy_within_180s")
    try:
        if compose_hashes() != state["compose_sha256"]:
            errors.append("compose_hash_changed")
    except Exception as exc:
        errors.append(f"compose_hash_check:{type(exc).__name__}:{exc}")
    save(run_dir / "restore.json", dict(utc=time.time(), errors=errors, containers=last))
    if errors:
        raise RuntimeError("restore_failed:" + ",".join(errors))


def run(run_dir):
    run_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(run_dir, 0o700)
    if hashlib.sha256(GUARD.read_bytes()).hexdigest() != GUARD_SHA256:
        raise RuntimeError("guard_sha_mismatch")
    before = inspect()
    if any(before[n]["status"] != "running" or before[n]["health"] != "healthy" or
           before[n]["oom"] != "false" for n in ALL):
        raise RuntimeError("initial_health_failed")
    save(run_dir / "state.json", dict(utc=time.time(), guard_sha256=GUARD_SHA256,
                                     containers=before, compose_sha256=compose_hashes()))
    counts = operations()
    save(run_dir / "operations.json", counts)
    if any(counts.values()):
        raise RuntimeError("pending_test_operations")
    stop_attempted = False
    try:
        for name in TEST:
            stop_attempted = True
            command(["docker", "stop", "--time", "25", name], timeout=45)
        after_stop = inspect()
        if any(after_stop[n]["id"] != before[n]["id"] or after_stop[n]["status"] != "exited"
               for n in TEST):
            raise RuntimeError("test_stop_not_confirmed")
        if any(after_stop[n]["status"] != "running" or after_stop[n]["health"] != "healthy"
               for n in PROD + TEST_DATA):
            raise RuntimeError("other_service_health_after_stop")
        groups = cgroup_paths()
        previous = snapshot(groups)
        with (run_dir / "trace.jsonl").open("w", buffering=1) as trace:
            trace.write(json.dumps(dict(kind="baseline", data=previous)) + "\n")
            with (run_dir / "guard.log").open("w", buffering=1) as guard_log:
                guard = subprocess.Popen([sys.executable, str(GUARD), "--seconds", "600"],
                    stdout=guard_log, stderr=subprocess.STDOUT)
                while guard.poll() is None:
                    time.sleep(2)
                    current = snapshot(groups)
                    trace.write(json.dumps(dict(kind="sample", data=compact(current, previous))) + "\n")
                    previous = current
                trace.write(json.dumps(dict(kind="guard_exit", utc=time.time(),
                                            returncode=guard.returncode)) + "\n")
        save(run_dir / "result.json", dict(utc=time.time(), guard_returncode=guard.returncode,
                                           guard_sha256=GUARD_SHA256))
    finally:
        if stop_attempted:
            restore(run_dir)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("run", "restore"))
    parser.add_argument("run_dir", type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError("root_required")
    if args.mode == "restore":
        restore(args.run_dir)
    else:
        run(args.run_dir)


if __name__ == "__main__":
    main()
