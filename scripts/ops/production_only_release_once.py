#!/usr/bin/env python3
"""Prepare/execute one approved API- or Web-only replacement in the five-service topology.

This is a narrow adapter around the existing Compose image and startup watcher.
It never pulls/builds and never starts TEST. Nothing executes without --execute.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

from production_only_guard_policy import PROD, TEST, container_reasons
from production_only_resource_guard import docker_state, load_checkpoint
import holypilot_web_release_once as legacy

BASE = Path("/opt/adforge-mcp-v2/infra/docker-compose.v2.production.yml")
ENV = Path("/etc/holymedia-v2/compose.env")
CONFIGS = {"base-compose.yml": BASE, "compose.env": ENV,
           "app.env": Path("/etc/holymedia-v2/app.env"),
           "web.env": Path("/etc/holymedia-v2/web.env"),
           "nginx-site": Path("/etc/nginx/sites-enabled/adforge-mcp")}
CHECKPOINT = Path("/var/backups/adforge-mcp/holypilot-test-retire-20261020T0858Z/checkpoint.json")
HERE = Path(__file__).resolve().parent
RECOVER = HERE / "holypilot_web_release_recover.sh"
CANDIDATES = {
    "web": (legacy.NEW_DIGEST, legacy.SOURCE_SHA),
    "api": ("sha256:dfc2c3a36d8371b3143da9035bb2dc1ad9ec30772470af8d78422693418a4347",
            "6e1f886ece8d4dc807cf7d8be8e306dce31b04a2"),
}
BASELINE_ID = "sha256:09c08234278a6eee22c866bd260d5c6ddc66806a977afc2e6b51077c0677a833"
BASELINE_REVISION = "a00817b746211a295bcb966f7fd7ef12cd6178fb"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command(args, *, timeout=90, capture=True):
    return subprocess.run(args, check=True, text=True, timeout=timeout,
                          stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.STDOUT if capture else None)


def image_document(reference):
    result = json.loads(command(["docker", "image", "inspect", reference]).stdout)
    if not isinstance(result, list) or len(result) != 1:
        raise RuntimeError("image_inspect_incomplete")
    return result[0]


def candidate_image(service):
    digest, revision = CANDIDATES[service]
    reference = "ghcr.io/stanforge-labs/holymedia-mcp-v2@" + digest
    image = image_document(reference)  # local cache only
    if (not str(image.get("Id", "")).startswith("sha256:") or
            reference not in image.get("RepoDigests", []) or
            image.get("Config", {}).get("Labels", {}).get("org.opencontainers.image.revision") != revision):
        raise RuntimeError("candidate_digest_or_revision_mismatch")
    return reference


def baseline_image(image_id):
    image = image_document(image_id)
    if (image_id != BASELINE_ID or image.get("Id") != image_id or
            image.get("Config", {}).get("Labels", {}).get(
                "org.opencontainers.image.revision") != BASELINE_REVISION):
        raise RuntimeError("rollback_image_or_revision_mismatch")
    refs = [ref for ref in image.get("RepoDigests", [])
            if ref.startswith("ghcr.io/stanforge-labs/holymedia-mcp-v2@")]
    if not refs:
        raise RuntimeError("rollback_repo_digest_missing")
    return refs[0]


def verify_topology(rows, test_checkpoint, baseline=None):
    reasons = container_reasons(rows, test_checkpoint, baseline)
    if reasons:
        raise RuntimeError("topology_fail:" + ",".join(reasons))


def pending_operations():
    sql = legacy.SQL
    raw = command(["docker", "exec", "holymedia-v2-postgres-1", "sh", "-c",
        'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "|" -c "$1"',
        "sh", sql]).stdout.strip()
    values = [int(value) for value in raw.split("|")]
    if len(values) != 6 or any(values):
        raise RuntimeError("production_operations_not_quiescent")
    return values


def write_secure(path, content):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        out.write(content)


def prepare(service, run_dir):
    if run_dir.exists():
        raise RuntimeError("run_directory_already_exists")
    test_checkpoint = load_checkpoint(CHECKPOINT)
    rows = docker_state()
    verify_topology(rows, test_checkpoint)
    if service == "web":
        legacy.ensure_immediate_preflight(legacy.immediate())
    pending_operations()
    target = "holymedia-v2-" + service + "-1"
    old_id = rows[target]["image"]
    old_ref = baseline_image(old_id)
    new_ref = candidate_image(service)
    new_id = image_document(new_ref)["Id"]
    watcher_source = legacy.OLD_PACKAGE / "startup-watch-unexecuted.py"
    if legacy.sha(watcher_source) != legacy.WATCH_SHA:
        raise RuntimeError("startup_watcher_source_sha_mismatch")
    sources = (HERE / "production_only_guard_policy.py",
               HERE / "production_only_resource_guard.py",
               HERE / "production_only_release_once.py",
               HERE / "holypilot_web_release_once.py", RECOVER)
    if any(not path.is_file() for path in sources):
        raise RuntimeError("production_guard_source_missing")
    run_dir.mkdir(mode=0o700, parents=True)
    run_dir.chmod(0o700)
    for name, source in CONFIGS.items():
        shutil.copy2(source, run_dir / name)
        (run_dir / name).chmod(0o600)
    for path in sources:
        shutil.copy2(path, run_dir / path.name)
        (run_dir / path.name).chmod(0o700 if path == RECOVER else 0o600)
    old_override = f"services:\n  {service}:\n    image: {old_ref}\n    pull_policy: never\n"
    new_override = f"services:\n  {service}:\n    image: {new_ref}\n    pull_policy: never\n"
    write_secure(run_dir / f"old-{service}.yml", old_override)
    write_secure(run_dir / f"new-{service}.yml", new_override)
    plan = dict(service=service, old_image_id=old_id, old_ref=old_ref,
                new_ref=new_ref, new_image_id=new_id,
                candidate_digest=CANDIDATES[service][0],
                candidate_revision=CANDIDATES[service][1],
                production_baseline={name: rows[name] for name in PROD},
                test_checkpoint=test_checkpoint,
                config_paths={name: str(path) for name, path in CONFIGS.items()},
                config_sha256={name: sha(path) for name, path in CONFIGS.items()},
                source_sha256={path.name: sha(path) for path in sources})
    write_secure(run_dir / "production-only-plan.json", json.dumps(plan, sort_keys=True))
    return plan


def verify_plan(plan, run_dir, *, after_cutover=False):
    service = plan["service"]
    if service not in CANDIDATES or (plan["candidate_digest"], plan["candidate_revision"]) != CANDIDATES[service]:
        raise RuntimeError("candidate_plan_changed")
    if any(sha(path) != plan["config_sha256"][name] for name, path in CONFIGS.items()):
        raise RuntimeError("protected_config_changed")
    for name, expected in plan["source_sha256"].items():
        if sha(run_dir / name) != expected:
            raise RuntimeError("release_source_changed:" + name)
    rows = docker_state()
    baseline = plan["production_baseline"]
    # The target is necessarily new after cutover; every other production
    # identity and restart counter must remain unchanged.
    if after_cutover:
        target = "holymedia-v2-" + service + "-1"
        if rows[target]["status"] != "running" or rows[target]["health"] != "healthy":
            raise RuntimeError("target_unhealthy_after_cutover")
        if rows[target]["image"] != plan["new_image_id"]:
            raise RuntimeError("started_image_mismatch")
        check = {name: rows[name] for name in PROD + TEST}
        check[target] = baseline[target]
        verify_topology(check, plan["test_checkpoint"], baseline)
    else:
        verify_topology(rows, plan["test_checkpoint"], baseline)
    candidate_image(service)
    baseline_image(plan["old_image_id"])
    if not after_cutover:
        pending_operations()
    return rows


def guard(run_dir, checkpoint_path, name):
    trace = run_dir / (name + "-trace.jsonl")
    result_path = run_dir / (name + "-result.json")
    with result_path.open("x", encoding="utf-8") as out:
        os.chmod(result_path, 0o600)
        completed = subprocess.run([sys.executable, str(run_dir / "production_only_resource_guard.py"),
            "--checkpoint", str(checkpoint_path), "--trace-output", str(trace)],
            stdout=out, stderr=subprocess.STDOUT, check=False, timeout=690)
    if completed.returncode:
        raise RuntimeError(name + "_guard_fail")
    result = json.loads(result_path.read_text())
    if result.get("status") != "PASS" or result.get("duration_exact_s", 0) < 600:
        raise RuntimeError(name + "_guard_incomplete")
    return result


def compose_replace(run_dir, service, variant):
    command(["docker", "compose", "--env-file", str(ENV), "-f", str(BASE),
             "-f", str(run_dir / f"{variant}-{service}.yml"), "up", "-d",
             "--no-deps", "--no-build", "--pull", "never", "--force-recreate", service],
            timeout=180)


def record_phase(run_dir, service, phase):
    """Persist the cutover boundary before the operation it describes."""
    marker = run_dir / f"{service}-phase.{phase}"
    write_secure(marker, "")
    event = json.dumps(dict(epoch=time.time(), monotonic=time.monotonic(),
                            service=service, phase=phase), sort_keys=True) + "\n"
    fd = os.open(run_dir / "release-phases.jsonl", os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        out.write(event)


def wait_healthy(name, watcher=None, fail_path=None):
    for _ in range(60):
        if fail_path and fail_path.exists():
            raise RuntimeError("startup_resource_fail")
        state = docker_state()[name]
        if state["health"] == "healthy" and state["status"] == "running":
            return
        if state["health"] == "unhealthy" or (watcher and watcher.poll() is not None and watcher.returncode):
            raise RuntimeError("container_unhealthy_after_start")
        time.sleep(2)
    raise RuntimeError("container_health_timeout")


def verify_web_functionality():
    """Check the published brand and existing public/API boundaries before PASS."""
    origin = "https://mcp.holymedia.kz"

    def fetch(path):
        raw = command(["curl", "-fsS", "--max-time", "5", "-w", "\n%{http_code}",
                       origin + path], timeout=10).stdout
        body, separator, status = raw.rpartition("\n")
        if not separator or status.strip() != "200":
            raise RuntimeError("public_route_http_status:" + path)
        return body

    ru = fetch("/")
    en = fetch("/en")
    symbol = "/assets/brand/holy-pilot-symbol.svg"
    for html, tagline in ((ru, "Ваш персональный AI-маркетолог"),
                          (en, "Your personal AI marketer")):
        if (html.count("HolyPilot") < 2 or html.count(symbol) < 2 or
                tagline not in html):
            raise RuntimeError("published_brand_content_mismatch")
    if "<svg" not in fetch(symbol) or "<svg" not in fetch("/icon.svg"):
        raise RuntimeError("brand_asset_or_favicon_missing")
    for route in ("/health", "/ready", "/auth", "/mcp/approve",
                  "/.well-known/oauth-authorization-server",
                  "/.well-known/oauth-protected-resource/mcp"):
        fetch(route)
    status = command(["curl", "-sS", "--max-time", "5", "-o", "/dev/null",
                      "-w", "%{http_code}", origin + "/mcp"], timeout=10).stdout.strip()
    if status != "401":
        raise RuntimeError("mcp_unauthorized_boundary_changed")


def execute(run_dir):
    plan = json.loads((run_dir / "production-only-plan.json").read_text())
    service = plan["service"]
    target = "holymedia-v2-" + service + "-1"
    if (run_dir / "cutover-attempted").exists() or (run_dir / "published").exists():
        raise RuntimeError("release_attempt_already_consumed")
    def interrupted(signum, _frame):
        raise InterruptedError("release_interrupted_signal:" + str(signum))
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    checkpoint_path = run_dir / "test-checkpoint.json"
    write_secure(checkpoint_path, json.dumps(plan["test_checkpoint"], sort_keys=True))
    verify_plan(plan, run_dir)
    guard(run_dir, checkpoint_path, "precutover")
    verify_plan(plan, run_dir)
    if service == "web":
        # Preserve the separately approved 11,500 MiB cache-only preflight.
        legacy.ensure_immediate_preflight(legacy.immediate())
    # Reuse the exact-SHA existing 180-second startup watchdog. It is staged
    # only after the pre-cutover guard, with no TEST restoration code.
    legacy.prepare_startup_watcher(run_dir)
    watch_path = run_dir / "startup-watch-unexecuted.py"
    if service == "api":
        watch_path.write_text(watch_path.read_text().replace("web-phase", "api-phase"))
        watch_path.chmod(0o600)
    with (run_dir / "startup-watch.log").open("x") as out:
        os.chmod(run_dir / "startup-watch.log", 0o600)
        watcher = subprocess.Popen([sys.executable, str(watch_path), str(run_dir)],
                                   stdout=out, stderr=subprocess.STDOUT)
    cutover = False
    try:
        for _ in range(20):
            if (run_dir / "startup-watch.ready").exists():
                break
            if watcher.poll() is not None:
                raise RuntimeError("startup_watcher_failed_to_arm")
            time.sleep(0.25)
        else:
            raise RuntimeError("startup_watcher_not_ready")
        if (run_dir / "startup-watch.fail").exists():
            raise RuntimeError("startup_resource_fail_before_cutover")
        record_phase(run_dir, service, "before-stop")
        (run_dir / "cutover-attempted").touch(mode=0o600)
        cutover = True
        record_phase(run_dir, service, "stopping-old")
        command(["docker", "stop", target], timeout=60)
        if docker_state()[target]["status"] != "exited":
            raise RuntimeError("old_container_not_stopped")
        record_phase(run_dir, service, "old-stopped")
        if (run_dir / "startup-watch.fail").exists():
            raise RuntimeError("startup_resource_fail_before_start")
        record_phase(run_dir, service, "starting-candidate")
        (run_dir / f"{service}-start.begin").touch(mode=0o600)
        compose_replace(run_dir, service, "new")
        record_phase(run_dir, service, "candidate-running")
        (run_dir / f"{service}-start.running").touch(mode=0o600)
        wait_healthy(target, watcher, run_dir / "startup-watch.fail")
        rows = verify_plan(plan, run_dir, after_cutover=True)
        if rows[target]["image"] != plan["new_image_id"]:
            raise RuntimeError("started_image_mismatch")
        if service == "web":
            verify_web_functionality()
        if watcher.wait(timeout=190):
            raise RuntimeError("startup_watchdog_fail")
        guard(run_dir, checkpoint_path, "poststart")
        verify_plan(plan, run_dir, after_cutover=True)
        if service == "web":
            verify_web_functionality()
        (run_dir / "published").touch(mode=0o600)
    except BaseException as error:
        if cutover:
            restored = subprocess.run(["bash", str(run_dir / RECOVER.name), str(run_dir)],
                                      check=False, timeout=240)
            if restored.returncode:
                raise RuntimeError("rollback_failed_manual_recovery_required") from error
        raise
    finally:
        if watcher.poll() is None:
            watcher.terminate()
            watcher.wait(timeout=10)


def main():
    parser = argparse.ArgumentParser()
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument("--prepare", choices=tuple(CANDIDATES))
    actions.add_argument("--execute", action="store_true")
    parser.add_argument("--run-dir", required=True, type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0 or not args.run_dir.is_absolute():
        parser.error("root_and_absolute_run_directory_required")
    if args.prepare:
        prepare(args.prepare, args.run_dir)
    else:
        execute(args.run_dir)


if __name__ == "__main__":
    main()
