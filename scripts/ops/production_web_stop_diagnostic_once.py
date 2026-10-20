#!/usr/bin/env python3
"""One approved old-Web stop/restore diagnosis; no candidate image is referenced.

Prepare is read-only on production. Observe requires an armed systemd service
with ExecStopPost calling --recover. All saved evidence is root-only.
"""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid

import holypilot_web_release_once as legacy
import production_only_release_once as release
import production_web_swap_probe as probe
from production_only_guard_policy import PROD, TEST
from production_only_resource_guard import docker_state, load_checkpoint

HERE = Path(__file__).resolve().parent
WEB = "holymedia-v2-web-1"
SOURCE_NAMES = ("production_only_guard_policy.py", "production_only_resource_guard.py",
                "production_only_release_once.py", "holypilot_web_release_once.py",
                "production_web_swap_probe.py", "production_web_stop_diagnostic_once.py")
PREFLIGHT_MAX_AGE_S = 300
PROBE_P95_MAX_MS = 20
PROBE_MAX_MS = 40
DIAGNOSTIC_RUNTIME_S = 300
UNIT_PREFIX = "holypilot-web-stop-diagnostic-"


def secured_append(path, payload):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        out.write(json.dumps(payload, sort_keys=True) + "\n")


def mark(run_dir, label):
    release.write_secure(run_dir / label, "")
    secured_append(run_dir / "diagnostic-events.jsonl", {
        "epoch": time.time(), "monotonic": time.monotonic(), "event": label})


def web_pid():
    value = release.command(["docker", "inspect", WEB, "--format", "{{.State.Pid}}"],
                            timeout=10).stdout.strip()
    pid = int(value)
    if pid <= 1:
        raise RuntimeError("web_pid_unavailable")
    return pid


def prepare(run_dir):
    if run_dir.exists() or not run_dir.is_absolute() or run_dir.is_symlink():
        raise RuntimeError("new_absolute_run_directory_required")
    checkpoint = load_checkpoint(release.CHECKPOINT)
    rows = docker_state()
    release.verify_topology(rows, checkpoint)
    release.pending_operations()
    legacy.ensure_immediate_preflight(legacy.immediate())
    old_ref = release.baseline_image(rows[WEB]["image"])
    pid = web_pid()
    selection = probe.select(pid)
    if legacy.sha(legacy.OLD_PACKAGE / "startup-watch-unexecuted.py") != legacy.WATCH_SHA:
        raise RuntimeError("startup_watch_source_sha_mismatch")
    run_dir.mkdir(mode=0o700, parents=True)
    run_dir.chmod(0o700)
    for name in SOURCE_NAMES:
        source = HERE / name
        shutil.copy2(source, run_dir / name)
        (run_dir / name).chmod(0o600)
    plan = {"profile": "OLD_WEB_STOP_DIAGNOSTIC_V1", "web_id": rows[WEB]["id"],
            "web_image": rows[WEB]["image"], "web_pid": pid, "old_ref": old_ref,
            "production_baseline": {name: rows[name] for name in PROD},
            "test_checkpoint": checkpoint,
            "config_paths": {name: str(path) for name, path in release.CONFIGS.items()},
            "config_sha256": {name: release.sha(path) for name, path in release.CONFIGS.items()},
            "source_sha256": {name: release.sha(HERE / name) for name in SOURCE_NAMES}}
    release.write_secure(run_dir / "diagnostic-plan.json", json.dumps(plan, sort_keys=True))
    release.write_secure(run_dir / "test-checkpoint.json", json.dumps(checkpoint, sort_keys=True))
    release.write_secure(run_dir / "probe-selection.json", json.dumps(selection, sort_keys=True))
    release.write_secure(run_dir / "old-web.yml", "services:\n  web:\n    image: " + old_ref +
                         "\n    pull_policy: never\n")
    mark(run_dir, "prepared")
    return plan


def load_plan(run_dir):
    path = run_dir / "diagnostic-plan.json"
    if path.is_symlink() or path.stat().st_mode & 0o077:
        raise RuntimeError("plan_permissions_invalid")
    plan = json.loads(path.read_text())
    if plan.get("profile") != "OLD_WEB_STOP_DIAGNOSTIC_V1":
        raise RuntimeError("diagnostic_profile_mismatch")
    return plan


def verify_sources_and_config(plan, run_dir):
    for name, digest in plan["source_sha256"].items():
        if release.sha(run_dir / name) != digest:
            raise RuntimeError("diagnostic_source_changed:" + name)
    for name, raw_path in plan["config_paths"].items():
        if release.sha(Path(raw_path)) != plan["config_sha256"][name]:
            raise RuntimeError("protected_config_changed:" + name)
    if release.baseline_image(plan["web_image"]) != plan["old_ref"]:
        raise RuntimeError("baseline_image_changed")


def verify_baseline(plan, run_dir):
    verify_sources_and_config(plan, run_dir)
    rows = docker_state()
    release.verify_topology(rows, plan["test_checkpoint"], plan["production_baseline"])
    if rows[WEB]["id"] != plan["web_id"] or web_pid() != plan["web_pid"]:
        raise RuntimeError("web_identity_or_pid_changed")
    release.pending_operations()
    return rows


def preflight(run_dir):
    plan = load_plan(run_dir)
    if (run_dir / "preflight-result.json").exists():
        raise RuntimeError("preflight_already_consumed")
    verify_baseline(plan, run_dir)
    result = release.guard(run_dir, run_dir / "test-checkpoint.json", "preflight")
    verify_baseline(plan, run_dir)
    mark(run_dir, "preflight-pass")
    return result


def verify_restored(plan, *, require_original_id=False):
    rows = docker_state()
    for name in PROD:
        row = rows[name]
        if row["status"] != "running" or row["health"] != "healthy":
            raise RuntimeError("production_unhealthy:" + name)
        if name != WEB and (row["id"] != plan["production_baseline"][name]["id"] or
                            row["image"] != plan["production_baseline"][name]["image"]):
            raise RuntimeError("other_production_changed:" + name)
    if rows[WEB]["image"] != plan["web_image"]:
        raise RuntimeError("web_image_changed")
    if require_original_id and rows[WEB]["id"] != plan["web_id"]:
        raise RuntimeError("original_web_id_changed")
    for name in TEST:
        expected = plan["test_checkpoint"][name]
        row = rows[name]
        if (row["id"] != expected["id"] or row["image"] != expected["image"] or
                row["status"] != "exited" or row["restart"] != "no"):
            raise RuntimeError("retired_test_changed:" + name)
    return rows


def verify_unrelated(plan, rows):
    """Never use Compose fallback if a different service or retired TEST drifted."""
    for name in PROD:
        if name == WEB:
            continue
        row, expected = rows[name], plan["production_baseline"][name]
        if row["id"] != expected["id"] or row["image"] != expected["image"]:
            raise RuntimeError("other_production_changed:" + name)
    for name in TEST:
        row, expected = rows[name], plan["test_checkpoint"][name]
        if (row["id"] != expected["id"] or row["image"] != expected["image"] or
                row["status"] != "exited" or row["restart"] != "no"):
            raise RuntimeError("retired_test_changed:" + name)


def verify_routes():
    origin = "https://mcp.holymedia.kz"
    for path in ("/", "/en", "/auth", "/mcp/approve", "/health", "/ready",
                 "/.well-known/oauth-authorization-server",
                 "/.well-known/oauth-protected-resource/mcp"):
        status = release.command(["curl", "-sS", "--max-time", "3", "-o", "/dev/null",
                                  "-w", "%{http_code}", origin + path], timeout=5).stdout.strip()
        if status != "200":
            raise RuntimeError("route_unhealthy:" + path)
    mcp_status = release.command(["curl", "-sS", "--max-time", "3", "-o", "/dev/null",
                                  "-w", "%{http_code}", origin + "/mcp"], timeout=5).stdout.strip()
    if mcp_status != "401":
        raise RuntimeError("mcp_permission_boundary_changed")


def wait_web_healthy(seconds=25):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        row = docker_state()[WEB]
        if row["status"] == "running" and row["health"] == "healthy":
            return
        time.sleep(2)
    raise RuntimeError("web_recovery_health_timeout")


def recover(run_dir):
    plan = load_plan(run_dir)
    if not (run_dir / "diagnostic-attempted").exists():
        return "NO_STOP_ATTEMPTED"
    rows = docker_state()
    verify_unrelated(plan, rows)
    web = rows[WEB]
    fallback_used = (run_dir / "compose-fallback-used").exists()
    if web["image"] == plan["web_image"] and web["status"] == "running" and web["health"] == "healthy":
        verify_restored(plan, require_original_id=not fallback_used)
        verify_routes()
        if not (run_dir / "web-phase.restored").exists():
            release.record_phase(run_dir, "web", "restored")
        return "ORIGINAL_WEB_HEALTHY"
    recovery_started = (run_dir / "recovery-attempted").exists()
    if recovery_started and fallback_used:
        raise RuntimeError("recovery_repeat_blocked")
    if not recovery_started:
        mark(run_dir, "recovery-attempted")
        release.record_phase(run_dir, "web", "restoring-old")
    else:
        secured_append(run_dir / "diagnostic-events.jsonl", {
            "epoch": time.time(), "event": "external_backstop_resumed_recovery"})
    if (run_dir / "web-phase.starting-candidate").exists():
        raise RuntimeError("candidate_marker_forbidden")
    if web["id"] != plan["web_id"] or web["image"] != plan["web_image"]:
        raise RuntimeError("original_web_identity_changed")
    method = "docker_start_original"
    direct_start_failed = recovery_started
    if not recovery_started:
        try:
            if web["status"] == "exited":
                release.command(["docker", "start", WEB], timeout=15)
            elif web["status"] != "running":
                raise RuntimeError("original_web_not_startable")
            wait_web_healthy(25)
        except (RuntimeError, subprocess.SubprocessError, OSError):
            direct_start_failed = True
    if direct_start_failed:
        # One fallback within the same recovery, from the already cached image.
        method = "single_compose_rollback"
        mark(run_dir, "compose-fallback-used")
        current_rows = docker_state()
        verify_unrelated(plan, current_rows)
        current = current_rows[WEB]
        if current["id"] != plan["web_id"] or current["image"] != plan["web_image"]:
            raise RuntimeError("web_identity_changed_before_fallback")
        if release.baseline_image(plan["web_image"]) != plan["old_ref"]:
            raise RuntimeError("cached_rollback_image_invalid")
        verify_sources_and_config(plan, run_dir)
        if current["status"] == "running":
            release.command(["docker", "stop", "--time", "5", WEB], timeout=12)
        release.command(["docker", "compose", "--env-file", str(release.ENV),
                         "-f", str(release.BASE), "-f", str(run_dir / "old-web.yml"),
                         "up", "-d", "--no-deps", "--no-build", "--pull", "never",
                         "--force-recreate", "web"], timeout=90)
        wait_web_healthy(25)
    verify_restored(plan, require_original_id=not direct_start_failed)
    verify_routes()
    release.record_phase(run_dir, "web", "restored")
    secured_append(run_dir / "recovery-result.jsonl", {"epoch": time.time(),
                   "status": "RESTORED", "method": method})
    return method


def boundary(run_dir, selection, phase):
    secured_append(run_dir / "boundary-attribution.jsonl", probe.capture(selection, phase))


def observe(run_dir):
    unit = os.environ.get("HOLYPILOT_DIAG_UNIT", "")
    marker = run_dir / "backstop-armed"
    if (not os.environ.get("INVOCATION_ID") or not unit.startswith(UNIT_PREFIX) or
            not marker.is_file() or marker.read_text() != unit):
        raise RuntimeError("systemd_backstop_required")
    properties = release.command(["systemctl", "show", unit,
                                  "--property=ExecStopPost,RuntimeMaxUSec"], timeout=5).stdout
    if ("--recover" not in properties or str(run_dir) not in properties or
            "RuntimeMaxUSec=" not in properties):
        raise RuntimeError("systemd_recovery_backstop_unverified")
    plan = load_plan(run_dir)
    result_path = run_dir / "preflight-result.json"
    if not (run_dir / "preflight-pass").exists() or not result_path.is_file():
        raise RuntimeError("full_preguard_required")
    result = json.loads(result_path.read_text())
    if result.get("status") != "PASS" or result.get("duration_exact_s", 0) < 600:
        raise RuntimeError("full_preguard_required")
    if time.time() - result_path.stat().st_mtime > PREFLIGHT_MAX_AGE_S:
        raise RuntimeError("preguard_stale")
    if (run_dir / "diagnostic-attempted").exists():
        raise RuntimeError("diagnostic_attempt_already_consumed")
    verify_baseline(plan, run_dir)
    selection = probe.read_selection(run_dir / "probe-selection.json")
    overhead = probe.benchmark(selection)
    release.write_secure(run_dir / "probe-overhead.json", json.dumps(overhead, sort_keys=True))
    if overhead["p95_ms"] > PROBE_P95_MAX_MS or overhead["max_ms"] > PROBE_MAX_MS:
        raise RuntimeError("probe_overhead_too_high")
    legacy.prepare_startup_watcher(run_dir, diagnostic=True)
    log = run_dir / "startup-watch.log"
    with log.open("x") as out:
        log.chmod(0o600)
        watcher = subprocess.Popen([sys.executable, str(run_dir / "startup-watch-unexecuted.py"),
                                    str(run_dir)], stdout=out, stderr=subprocess.STDOUT)
    try:
        for _ in range(20):
            if (run_dir / "startup-watch.ready").exists():
                break
            if watcher.poll() is not None:
                raise RuntimeError("watchdog_failed_to_arm")
            time.sleep(0.25)
        else:
            raise RuntimeError("watchdog_not_ready")
        release.require_watcher_alive(watcher, run_dir / "startup-watch.fail")
        release.record_phase(run_dir, "web", "before-stop")
        boundary(run_dir, selection, "before-stop")
        mark(run_dir, "diagnostic-attempted")
        release.require_watcher_alive(watcher, run_dir / "startup-watch.fail")
        release.record_phase(run_dir, "web", "stopping-old")
        try:
            release.command(["docker", "stop", "--time", "5", WEB], timeout=12)
            if docker_state()[WEB]["status"] != "exited":
                raise RuntimeError("old_web_not_stopped")
            release.record_phase(run_dir, "web", "old-stopped")
        finally:
            try:
                boundary(run_dir, selection, "after-docker-stop")
            except (OSError, ValueError):
                mark(run_dir, "poststop-probe-incomplete")
    finally:
        if (run_dir / "diagnostic-attempted").exists():
            try:
                recover(run_dir)
                boundary(run_dir, selection, "restored")
            except BaseException:
                mark(run_dir, "recovery-needs-attention")
                raise
        if watcher.poll() is None:
            try:
                watcher.wait(timeout=190)
            except subprocess.TimeoutExpired:
                watcher.terminate()
                watcher.wait(timeout=5)
                mark(run_dir, "watchdog-incomplete")
        if (run_dir / "startup-watch.json").is_file():
            secured_append(run_dir / "diagnostic-events.jsonl", {
                "epoch": time.time(), "event": "watchdog-result",
                "result": json.loads((run_dir / "startup-watch.json").read_text())})
    if not (run_dir / "web-phase.restored").exists():
        raise RuntimeError("restoration_not_verified")
    return "RESTORED_DIAGNOSTIC_COMPLETE"


def launch(run_dir):
    """Start the single diagnostic in a transient service with ExecStopPost recovery."""
    if any(char.isspace() for char in str(run_dir)):
        raise RuntimeError("run_directory_must_not_contain_whitespace")
    load_plan(run_dir)
    if (run_dir / "backstop-armed").exists() or (run_dir / "diagnostic-attempted").exists():
        raise RuntimeError("diagnostic_attempt_already_consumed")
    unit = UNIT_PREFIX + uuid.uuid4().hex[:12]
    script = run_dir / "production_web_stop_diagnostic_once.py"
    release.write_secure(run_dir / "backstop-armed", unit)
    args = ["systemd-run", "--unit=" + unit, "--wait", "--collect",
            "--property=RuntimeMaxSec=" + str(DIAGNOSTIC_RUNTIME_S),
            "--property=TimeoutStopSec=180",
            "--property=ExecStopPost=/usr/bin/python3 " + str(script) +
            " --recover --run-dir " + str(run_dir),
            "--setenv=HOLYPILOT_DIAG_UNIT=" + unit,
            "/usr/bin/python3", str(script), "--observe", "--run-dir", str(run_dir)]
    try:
        release.command(args, timeout=DIAGNOSTIC_RUNTIME_S + 180)
    finally:
        # The service backstop runs first; this is an idempotent verification.
        recover(run_dir)
    return postcheck(run_dir)


def postcheck(run_dir):
    plan = load_plan(run_dir)
    if not (run_dir / "web-phase.restored").exists():
        raise RuntimeError("web_not_restored")
    verify_sources_and_config(plan, run_dir)
    verify_restored(plan)
    verify_routes()
    result = release.guard(run_dir, run_dir / "test-checkpoint.json", "postrestore")
    verify_restored(plan)
    verify_routes()
    mark(run_dir, "postcheck-pass")
    return result


def main():
    parser = argparse.ArgumentParser()
    actions = parser.add_mutually_exclusive_group(required=True)
    for action in ("prepare", "preflight", "launch", "observe", "recover", "postcheck"):
        actions.add_argument("--" + action, action="store_true")
    parser.add_argument("--run-dir", required=True, type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0 or not args.run_dir.is_absolute():
        parser.error("root_and_absolute_run_dir_required")
    if args.prepare:
        prepare(args.run_dir)
    elif args.preflight:
        preflight(args.run_dir)
    elif args.observe:
        observe(args.run_dir)
    elif args.launch:
        launch(args.run_dir)
    elif args.recover:
        recover(args.run_dir)
    else:
        postcheck(args.run_dir)


if __name__ == "__main__":
    main()
