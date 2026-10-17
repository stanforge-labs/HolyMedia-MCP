#!/usr/bin/env python3
"""One authorized, fail-closed TEST Web/API maintenance attempt on the VPS.

This is deliberately pinned to the October 17 Batch 2 images and account.
Use `prepare` before `execute`; execute is single-use and restores old TEST
images exactly once if any post-stop step fails. Never touches production.
"""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request


BASE = Path("/opt/holymedia-qrs-test")
STAGE = BASE / "batch2-staging"
RUN = BASE / "rollback" / "batch2-maintenance-20261017-phase-v2-once"
COMPOSE = BASE / "docker-compose.yml"
CLONE = BASE / "qrs-clone.override.yml"
ENV = Path("/opt/holymedia-google-acceptance/acceptance.env")
LOGIN_ENV = BASE / "vault" / "google-login.env"
REGISTRY = "ghcr.io/stanforge-labs/holymedia-mcp-v2@"
OLD_WEB = REGISTRY + "sha256:5e131625e622fe91aa578c0a53a586ffc5f30d49bf8ba39c8080bbd18835a0d6"
OLD_API = REGISTRY + "sha256:35e95779d59df2b83eb45f3dfc481ffa9e2e09d494ee26315c6ae656d7111595"
NEW_WEB = REGISTRY + "sha256:3e8b44908bc9f6752ea996aa699da49b91a85953a98f5c41638811719c888669"
NEW_API = REGISTRY + "sha256:68d718998795dd6a0d6229fda0d747c0cb503dbd625d772542b1edacaf48a76f"
WEB_REV = "6b212d4bdebd1dcfc191de27a03ad4963c09b7d3"
API_REV = "e5216c8f66a5e6b9c8afd1290b221accff069f41"
BASE_SHA = "4dab03f890eb4d27a0f42776ec7ac152806ffe6b7e96f877c8d8f265497e51ec"
CLONE_SHA = "bd643bc374c04db473f195976128431966e57e79388f3baebd780cc691e74877"
API_NAME = "holymedia-qrs-test-qrs_api-1"
WEB_NAME = "holymedia-qrs-test-qrs_web-1"
PG_NAME = "holymedia-google-acceptance-postgres-1"
REDIS_NAME = "holymedia-google-acceptance-redis-1"
PROD_NAMES = ("holymedia-v2-api-1", "holymedia-v2-web-1", "holymedia-v2-worker-1",
              "holymedia-v2-postgres-1", "holymedia-v2-redis-1")
PREVIEW_SQL = (
    "SELECT count(*) FILTER (WHERE consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>now()), "
    "count(*) FILTER (WHERE confirmed_at IS NOT NULL AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>now()), "
    "count(*) FILTER (WHERE commit_attempted_at IS NOT NULL AND commit_status IS NULL) FROM mcp_previews"
)
OAUTH_SQL = (
    "SELECT (SELECT count(*) FROM oauth_authorization_transactions WHERE expires_at>now() AND consumed_at IS NULL), "
    "(SELECT count(*) FROM oauth_authorization_codes WHERE expires_at>now() AND used_at IS NULL)"
)
ACTIVE_SQL = (
    "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() "
    "AND pid<>pg_backend_pid() AND (state='idle in transaction' OR "
    "(state='active' AND xact_start IS NOT NULL AND now()-xact_start>interval '5 seconds'))"
)
ROOT_FREE_REQUIRED = 10240
ROLLBACK_RESERVE_MIB = 128
# New OCI layer tar expansions and compressed blobs were streamed locally,
# without touching the VPS: API 623.63+179.30, Web 411.61+137.23 MiB.
IMAGE_PEAK_BUDGET_MIB = 1352


def event(name, **data):
    row = {"at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "event": name, **data}
    path = RUN / "events.jsonl"
    if not path.exists():
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(fd)
    path.chmod(0o600)
    with path.open("a", encoding="utf-8") as out:
        out.write(json.dumps(row, sort_keys=True) + "\n")
        out.flush()
        os.fsync(out.fileno())
    print(json.dumps(row, sort_keys=True), flush=True)


def run(cmd, *, timeout=45, stdin=None, output=None):
    done = subprocess.run(cmd, stdin=stdin, stdout=output or subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, check=False, timeout=timeout)
    if done.returncode:
        raise RuntimeError("command_failed_" + cmd[0].replace("/", "_"))


def output(cmd, timeout=20):
    return subprocess.check_output(cmd, stderr=subprocess.DEVNULL,
                                   text=True, timeout=timeout).strip()


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def docker(name):
    fmt = "{{.Id}}|{{.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}|{{.State.OOMKilled}}|{{.HostConfig.AutoRemove}}"
    cid, image, state, health, restarts, oom, auto_remove = output(
        ["docker", "inspect", "--format", fmt, name]).split("|")
    return {"id": cid, "image": image, "state": state, "health": health,
            "restarts": int(restarts), "oom": oom == "true", "auto_remove": auto_remove == "true"}


def image(ref, revision=None):
    fmt = '{{.Id}}|{{index .Config.Labels "org.opencontainers.image.revision"}}'
    image_id, label = output(["docker", "image", "inspect", ref, "--format", fmt]).split("|")
    if revision and label != revision:
        raise RuntimeError("image_revision_mismatch")
    return image_id


def counts(sql):
    result = output(["docker", "exec", PG_NAME, "sh", "-c",
                     'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F " " -c "$1"',
                     "sh", sql]).split()
    if not result or any(not x.isdecimal() for x in result):
        raise RuntimeError("database_count_invalid")
    return [int(x) for x in result]


def no_pending():
    previews, oauth = counts(PREVIEW_SQL), counts(OAUTH_SQL)
    long_transactions = counts(ACTIVE_SQL)
    event("test_work_state", previews=previews, oauth=oauth,
          long_transactions=long_transactions)
    if previews != [0, 0, 0] or oauth != [0, 0] or long_transactions != [0]:
        raise RuntimeError("test_work_in_progress")


def metric():
    mem = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        bits = line.split()
        if bits and bits[0] in ("MemAvailable:", "SwapFree:"):
            mem[bits[0][:-1]] = int(bits[1])
    vm = {}
    for line in Path("/proc/vmstat").read_text().splitlines():
        bits = line.split()
        if bits and bits[0] in ("pswpout", "pswpin", "pgmajfault", "oom_kill"):
            vm[bits[0]] = int(bits[1])
    psi = {}
    for line in Path("/proc/pressure/memory").read_text().splitlines():
        bits = line.split()
        if bits and bits[0] in ("some", "full"):
            psi[bits[0]] = float(bits[1].split("=")[1])
    fs = os.statvfs("/")
    if set(mem) != {"MemAvailable", "SwapFree"} or set(vm) != {"pswpout", "pswpin", "pgmajfault", "oom_kill"} or set(psi) != {"some", "full"}:
        raise RuntimeError("resource_metric_missing")
    return {"mem_kib": mem["MemAvailable"], "swap_free_kib": mem["SwapFree"],
            "disk_free_mib": fs.f_bavail * fs.f_frsize // 1048576,
            "psi_full": psi["full"], "psi_some": psi["some"], **vm}


def http(url, expected):
    req = urllib.request.Request(url)
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=3) as response:
            code = response.status
    except urllib.error.HTTPError as err:
        code = err.code
    except (OSError, urllib.error.URLError):
        code = 0
    elapsed = time.monotonic() - started
    if code != expected:
        raise RuntimeError("http_status_mismatch")
    return round(elapsed, 3)


def prod_check():
    http("https://mcp.holymedia.kz/health", 200)
    ready = http("https://mcp.holymedia.kz/ready", 200)
    if ready >= 0.8:
        raise RuntimeError("production_latency")
    lines = output(["docker", "inspect", "--format",
                    "{{.Name}}|{{.State.Status}}|{{.State.Health.Status}}|{{.State.OOMKilled}}",
                    *PROD_NAMES]).splitlines()
    if len(lines) != len(PROD_NAMES):
        raise RuntimeError("production_inventory_incomplete")
    for line in lines:
        name, state, health, oom = line.split("|")
        if name.lstrip("/") not in PROD_NAMES or state != "running" or health != "healthy" or oom != "false":
            raise RuntimeError("production_container_bad")
    return ready


def host_gate(baseline, *, strict_swap=True, reserve=0, context="unspecified"):
    value = metric()
    reason = None
    if value["mem_kib"] < 819200 or value["swap_free_kib"] < 262144:
        reason = "memory_floor"
    elif value["disk_free_mib"] < ROOT_FREE_REQUIRED + reserve:
        reason = "disk_floor"
    elif value["psi_full"] >= 1.5 or value["psi_some"] >= 2.0:
        reason = "memory_psi"
    elif value["oom_kill"] != baseline["oom_kill"]:
        reason = "new_oom"
    elif strict_swap and value["pswpout"] != baseline["pswpout"]:
        reason = "new_swap_out"
    if reason:
        event("host_gate_failed", context=context, reason=reason, metric=value,
              baseline_pswpout=baseline["pswpout"], baseline_oom=baseline["oom_kill"],
              limits={"mem_kib": 819200, "swap_free_kib": 262144,
                      "disk_free_mib": ROOT_FREE_REQUIRED + reserve,
                      "psi_full": 1.5, "psi_some": 2.0})
        raise RuntimeError(reason)
    return value


def compose_env(api, web):
    return {**os.environ, "QRS_TEST_API_IMAGE": api, "QRS_TEST_WEB_IMAGE": web,
            "QRS_TEST_ENV_FILE": str(ENV), "QRS_TEST_LOGIN_ENV_FILE": str(LOGIN_ENV)}


def compose(args, api, web, *, new=False, timeout=90):
    cmd = ["docker", "compose", "-p", "holymedia-qrs-test",
           "-f", str(RUN / "docker-compose.yml"), "-f", str(RUN / "qrs-clone.override.yml")]
    if new:
        cmd += ["-f", str(RUN / "batch2-healthcheck.override.yml")]
    cmd += args
    done = subprocess.run(cmd, env=compose_env(api, web), stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, timeout=timeout)
    if done.returncode:
        raise RuntimeError("compose_command_failed")


def check_compose_model():
    cmd = ["docker", "compose", "-p", "holymedia-qrs-test",
           "-f", str(RUN / "docker-compose.yml"),
           "-f", str(RUN / "qrs-clone.override.yml"),
           "-f", str(RUN / "batch2-healthcheck.override.yml"),
           "config", "--format", "json"]
    model = json.loads(subprocess.check_output(
        cmd, env=compose_env(NEW_API, NEW_WEB), stderr=subprocess.DEVNULL,
        timeout=30))
    services = model["services"]
    if set(services) != {"qrs_api", "qrs_web"}:
        raise RuntimeError("compose_services_drift")
    for key, ref, port, path in (("qrs_api", NEW_API, "4000", "/ready"),
                                 ("qrs_web", NEW_WEB, "3000", "/auth")):
        service = services[key]
        if service["image"] != ref or service["healthcheck"]["test"] != [
            "CMD", "bash", "/usr/local/bin/holymedia-test-http-health", port, path,
        ]:
            raise RuntimeError("compose_candidate_drift")
    env = services["qrs_api"]["environment"]
    if env.get("QRS_TEST_CLONE_CONFIRMED_WRITE_ENABLED") != "true" or env.get("QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED") != "false":
        raise RuntimeError("compose_existing_gate_drift")
    if env.get("QRS_TEST_CONVERSION_ACTION_CONFIRMED_WRITE_ENABLED", "false") != "false" or env.get("QRS_TEST_PMAX_CONFIRMED_WRITE_ENABLED", "false") != "false":
        raise RuntimeError("compose_new_gate_enabled")


def current_preflight():
    if digest(COMPOSE) != BASE_SHA or digest(CLONE) != CLONE_SHA:
        raise RuntimeError("protected_compose_drift")
    for p in (COMPOSE, CLONE, ENV, LOGIN_ENV):
        if not p.is_file() or p.is_symlink() or p.stat().st_mode & 0o077:
            raise RuntimeError("protected_config_missing_or_mode")
    if image(OLD_API) != docker(API_NAME)["image"] or image(OLD_WEB) != docker(WEB_NAME)["image"]:
        raise RuntimeError("running_test_image_drift")
    for name in (API_NAME, WEB_NAME, PG_NAME, REDIS_NAME, *PROD_NAMES):
        item = docker(name)
        if item["state"] != "running" or item["health"] != "healthy" or item["oom"] or item["auto_remove"]:
            raise RuntimeError("container_preflight_failed")
    if output(["systemctl", "list-jobs", "--no-legend"]):
        raise RuntimeError("systemd_job_active")
    active = output(["ps", "-eo", "comm="]).splitlines()
    if any(name in {"apt", "apt-get", "dpkg", "pg_dump", "pg_restore"} for name in active):
        raise RuntimeError("background_maintenance_active")
    no_pending()
    prod_check()
    http("http://127.0.0.1:14404/ready", 200)
    http("http://127.0.0.1:13300/auth", 200)
    http("http://127.0.0.1:13300/mcp/approve", 200)
    values = metric()
    if values["disk_free_mib"] < ROOT_FREE_REQUIRED + IMAGE_PEAK_BUDGET_MIB + ROLLBACK_RESERVE_MIB + 32:
        raise RuntimeError("combined_image_disk_budget")
    if values["swap_free_kib"] < 262144 or values["psi_full"] >= 1.5 or values["oom_kill"] != 0:
        raise RuntimeError("initial_host_unsafe")
    event("baseline", metric=values)
    return values


def backup_one(path, cmd):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as dest:
        run(cmd, timeout=120, output=dest)
        dest.flush()
        os.fsync(dest.fileno())
    if path.stat().st_size < 16:
        raise RuntimeError("backup_empty")
    return {"bytes": path.stat().st_size, "sha256": digest(path)}


def prepare():
    if RUN.exists():
        raise RuntimeError("one_attempt_directory_exists")
    RUN.mkdir(mode=0o700)
    event("prepare_started")
    current_preflight()
    for src, dest in ((COMPOSE, "docker-compose.yml"), (CLONE, "qrs-clone.override.yml"),
                      (ENV, "acceptance.env"), (LOGIN_ENV, "google-login.env"),
                      (Path(__file__), "batch2_test_maintenance_once_v2.py"),
                      (STAGE / "batch2_test_maintenance_guard.py", "batch2_test_maintenance_guard.py"),
                      (STAGE / "web_only_guard_policy.py", "web_only_guard_policy.py"),
                      (STAGE / "maintenance_guard_policy.py", "maintenance_guard_policy.py")):
        target = RUN / dest
        shutil.copyfile(src, target)
        target.chmod(0o600)
    overlay = RUN / "batch2-healthcheck.override.yml"
    overlay.write_text(
        "services:\n"
        "  qrs_api:\n"
        "    healthcheck:\n"
        "      test: [CMD, bash, /usr/local/bin/holymedia-test-http-health, \"4000\", /ready]\n"
        "      interval: 15s\n      timeout: 5s\n      retries: 5\n      start_period: 30s\n"
        "  qrs_web:\n"
        "    healthcheck:\n"
        "      test: [CMD, bash, /usr/local/bin/holymedia-test-http-health, \"3000\", /auth]\n"
        "      interval: 15s\n      timeout: 5s\n      retries: 5\n      start_period: 30s\n",
        encoding="utf-8")
    overlay.chmod(0o600)
    compose(["config", "--quiet"], NEW_API, NEW_WEB, new=True)
    check_compose_model()
    db = RUN / "test-db.dump"
    redis = RUN / "test-redis.rdb"
    backup_one(db, ["docker", "exec", PG_NAME, "sh", "-c",
                    'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'])
    backup_one(redis, ["docker", "exec", REDIS_NAME, "sh", "-c",
                       'exec env REDISCLI_AUTH="$ACCEPTANCE_REDIS_PASSWORD" redis-cli --rdb -'])
    finalize_preparation()


def finalize_preparation():
    db = RUN / "test-db.dump"
    redis = RUN / "test-redis.rdb"
    overlay = RUN / "batch2-healthcheck.override.yml"
    if (RUN / "manifest.json").exists() or (RUN / "EXECUTION_STARTED").exists():
        raise RuntimeError("preparation_already_finalized")
    if db.open("rb").read(5) != b"PGDMP" or redis.open("rb").read(5) != b"REDIS":
        raise RuntimeError("backup_header_invalid")
    with db.open("rb") as source:
        run(["docker", "exec", "-i", PG_NAME, "pg_restore", "-l"], stdin=source)
    backups = {
        "db": {"bytes": db.stat().st_size, "sha256": digest(db)},
        "redis": {"bytes": redis.stat().st_size, "sha256": digest(redis)},
    }
    if metric()["disk_free_mib"] < ROOT_FREE_REQUIRED + IMAGE_PEAK_BUDGET_MIB + ROLLBACK_RESERVE_MIB:
        raise RuntimeError("post_backup_disk_budget")
    no_pending()
    prod_check()
    manifest = {"old_web": OLD_WEB, "old_api": OLD_API,
                "old_web_id": image(OLD_WEB), "old_api_id": image(OLD_API),
                "new_web": NEW_WEB, "new_api": NEW_API, "backups": backups,
                "base_sha256": digest(COMPOSE), "clone_sha256": digest(CLONE),
                "overlay_sha256": digest(overlay),
                "guard_sha256": digest(RUN / "batch2_test_maintenance_guard.py"),
                "policy_sha256": digest(RUN / "web_only_guard_policy.py"),
                "maintenance_policy_sha256": digest(RUN / "maintenance_guard_policy.py"),
                "runner_sha256": digest(RUN / "batch2_test_maintenance_once_v2.py"),
                "production": {name: docker(name) for name in PROD_NAMES}}
    (RUN / "manifest.json").write_text(json.dumps(manifest, sort_keys=True) + "\n", encoding="utf-8")
    (RUN / "manifest.json").chmod(0o600)
    event("prepared", backup_bytes=backups["db"]["bytes"] + backups["redis"]["bytes"],
          disk_free_mib=metric()["disk_free_mib"])


def resume_preparation():
    if not RUN.is_dir() or RUN.is_symlink() or RUN.stat().st_mode & 0o077:
        raise RuntimeError("protected_attempt_directory_missing")
    if (RUN / "EXECUTION_STARTED").exists():
        raise RuntimeError("execution_already_started")
    event("prepare_resumed_after_backup_format_check")
    current_preflight()
    for src, name in ((STAGE / "batch2_test_maintenance_once_v2.py", "batch2_test_maintenance_once_v2.py"),
                      (STAGE / "batch2_test_maintenance_guard.py", "batch2_test_maintenance_guard.py"),
                      (STAGE / "web_only_guard_policy.py", "web_only_guard_policy.py"),
                      (STAGE / "maintenance_guard_policy.py", "maintenance_guard_policy.py")):
        shutil.copyfile(src, RUN / name)
        (RUN / name).chmod(0o600)
    if digest(RUN / "docker-compose.yml") != BASE_SHA or digest(RUN / "qrs-clone.override.yml") != CLONE_SHA:
        raise RuntimeError("protected_rollback_config_drift")
    compose(["config", "--quiet"], NEW_API, NEW_WEB, new=True)
    check_compose_model()
    finalize_preparation()


def test_stopped():
    for name in (API_NAME, WEB_NAME):
        item = docker(name)
        if item["state"] != "exited" or item["auto_remove"]:
            raise RuntimeError("test_stop_unverified")
    for name in (PG_NAME, REDIS_NAME):
        if docker(name)["health"] != "healthy":
            raise RuntimeError("test_data_unhealthy")


def guard(phase):
    path = RUN / "batch2_test_maintenance_guard.py"
    done = subprocess.run(["python3", str(path), "--phase", phase,
                           "--output-dir", str(RUN), "--seconds", "600"],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                          timeout=660)
    result_file = RUN / f"{phase}-result.json"
    result = json.loads(result_file.read_text()) if result_file.exists() else {"status": "FAIL", "reasons": ["result_missing"]}
    event("guard_result", phase=phase, status=result["status"],
          reasons=result.get("reasons", [result.get("error_type", "unknown")]),
          min_mem_kib=result.get("min_mem_available_kib"),
          min_disk_mib=result.get("min_disk_free_mib"),
          swap_out_pages=result.get("strict_api_swap_out_pages"))
    if done.returncode or result["status"] != "PASS":
        raise RuntimeError(phase + "_guard_failed")


def pull(ref, name, baseline):
    log = RUN / f"pull-{name}.log"
    fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as dest:
        proc = subprocess.Popen(["docker", "pull", ref], stdout=dest, stderr=dest)
        started = time.monotonic()
        next_prod_check = started
        try:
            while proc.poll() is None:
                if time.monotonic() - started > 900:
                    raise RuntimeError("pull_timeout")
                host_gate(baseline, reserve=ROLLBACK_RESERVE_MIB)
                if time.monotonic() >= next_prod_check:
                    prod_check()
                    next_prod_check = time.monotonic() + 10
                time.sleep(1)
        except Exception:
            proc.terminate()
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
            raise
        if proc.returncode:
            raise RuntimeError("pull_failed")
    host_gate(baseline, reserve=ROLLBACK_RESERVE_MIB)
    prod_check()
    event("image_pulled", name=name, image_id=image(ref, WEB_REV if name == "web" else API_REV),
          disk_free_mib=metric()["disk_free_mib"])


def wait_health(name, baseline, route):
    for attempt in range(25):
        host_gate(baseline, reserve=ROLLBACK_RESERVE_MIB,
                  context="candidate_health:" + name)
        if attempt % 3 == 0:
            prod_check()
        item = docker(name)
        if item["oom"] or item["restarts"]:
            raise RuntimeError("candidate_restart_or_oom")
        if item["state"] == "running" and item["health"] == "healthy":
            http(route, 200)
            return
        time.sleep(3)
    raise RuntimeError("candidate_health_timeout")


def check_flags_and_routes():
    raw = output(["docker", "inspect", API_NAME,
                  "--format", "{{range .Config.Env}}{{println .}}{{end}}"])
    values = dict(line.split("=", 1) for line in raw.splitlines() if "=" in line)
    expected = {
        "QRS_TEST_RESTRICTED_AUTH": "true",
        "GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST": "8590146099",
        "QRS_TEST_CLONE_CONFIRMED_WRITE_ENABLED": "true",
        "QRS_TEST_CONVERSION_ACTION_CONFIRMED_WRITE_ENABLED": "false",
        "QRS_TEST_PMAX_CONFIRMED_WRITE_ENABLED": "false",
        "V2_CONFIRMED_WRITE_ENABLED": "false",
        "PUBLIC_MCP_WRITE_SCOPE_ENABLED": "false",
        "PUBLIC_MCP_CONTROLLED_WRITE_ENABLED": "false",
    }
    for key, want in expected.items():
        actual = values.get(key, "false" if want == "false" else None)
        if actual != want:
            raise RuntimeError("candidate_flag_drift")
    for key in ("PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED",
                "PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED",
                "PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED"):
        if values.get(key) != "false":
            raise RuntimeError("candidate_stage_gate_drift")
    for name, port, path in ((API_NAME, 4000, "/ready"), (WEB_NAME, 3000, "/auth")):
        expected_test = ["CMD", "bash", "/usr/local/bin/holymedia-test-http-health", str(port), path]
        actual_test = json.loads(output(["docker", "inspect", name, "--format", "{{json .Config.Healthcheck.Test}}"] ))
        if actual_test != expected_test:
            raise RuntimeError("candidate_healthcheck_drift")
    routes = (
        ("http://127.0.0.1:14404/health", 200),
        ("http://127.0.0.1:14404/ready", 200),
        ("http://127.0.0.1:13300/auth", 200),
        ("http://127.0.0.1:13300/en/auth", 200),
        ("http://127.0.0.1:13300/mcp/approve", 200),
        ("http://127.0.0.1:13300/connect/claude", 200),
        ("https://mcp-test.holymedia.kz/.well-known/oauth-authorization-server", 200),
        ("https://mcp-test.holymedia.kz/api/v1/auth/csrf", 200),
    )
    for url, expected in routes:
        http(url, expected)
    no_pending()
    event("candidate_routes_pass", checked=len(routes))


def check_production_unchanged(manifest):
    for name, before in manifest["production"].items():
        after = docker(name)
        if any(after[key] != before[key] for key in ("id", "image", "restarts")):
            raise RuntimeError("production_identity_changed")


def rollback(reason):
    event("rollback_started", reason=reason)
    try:
        for name in (WEB_NAME, API_NAME):
            if docker(name)["state"] == "running":
                run(["docker", "stop", "--time", "30", name], timeout=45)
        compose(["up", "-d", "--no-deps", "--no-build", "--pull", "never", "qrs_api"], OLD_API, OLD_WEB)
        for _ in range(25):
            if docker(API_NAME)["health"] == "healthy":
                break
            time.sleep(3)
        compose(["up", "-d", "--no-deps", "--no-build", "--pull", "never", "qrs_web"], OLD_API, OLD_WEB)
        for _ in range(25):
            if docker(WEB_NAME)["health"] == "healthy":
                break
            time.sleep(3)
        if docker(API_NAME)["image"] != image(OLD_API) or docker(WEB_NAME)["image"] != image(OLD_WEB):
            raise RuntimeError("rollback_image_mismatch")
        if docker(API_NAME)["health"] != "healthy" or docker(WEB_NAME)["health"] != "healthy":
            raise RuntimeError("rollback_unhealthy")
        prod_check()
        check_production_unchanged(json.loads((RUN / "manifest.json").read_text()))
        http("http://127.0.0.1:14404/ready", 200)
        http("http://127.0.0.1:13300/auth", 200)
        http("http://127.0.0.1:13300/mcp/approve", 200)
        event("rollback_complete", metric=metric())
        (RUN / "ROLLED_BACK").write_text(reason + "\n", encoding="utf-8")
        return True
    except Exception as exc:
        event("rollback_failed", error_type=type(exc).__name__, reason=str(exc) if isinstance(exc, RuntimeError) else "redacted")
        (RUN / "ROLLBACK_UNVERIFIED").write_text(reason + "\n", encoding="utf-8")
        return False


def execute():
    if not (RUN / "manifest.json").is_file() or (RUN / "EXECUTION_STARTED").exists():
        raise RuntimeError("not_prepared_or_attempt_already_used")
    (RUN / "EXECUTION_STARTED").write_text(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + "\n")
    event("execution_started")
    stopped = False
    try:
        current_preflight()
        manifest = json.loads((RUN / "manifest.json").read_text())
        if digest(RUN / "docker-compose.yml") != BASE_SHA or digest(RUN / "qrs-clone.override.yml") != CLONE_SHA:
            raise RuntimeError("rollback_files_drift")
        for key, name in (("guard_sha256", "batch2_test_maintenance_guard.py"),
                          ("policy_sha256", "web_only_guard_policy.py"),
                          ("maintenance_policy_sha256", "maintenance_guard_policy.py"),
                          ("runner_sha256", "batch2_test_maintenance_once_v2.py"),
                          ("overlay_sha256", "batch2-healthcheck.override.yml")):
            if digest(RUN / name) != manifest[key]:
                raise RuntimeError("execution_source_drift")
        for key, name in (("db", "test-db.dump"), ("redis", "test-redis.rdb")):
            path = RUN / name
            if not path.is_file() or path.stat().st_mode & 0o077 or path.stat().st_size != manifest["backups"][key]["bytes"] or digest(path) != manifest["backups"][key]["sha256"]:
                raise RuntimeError("backup_missing_or_drift")
        no_pending()
        before = metric()
        event("before_stop", metric=before)
        run(["docker", "stop", "--time", "30", WEB_NAME], timeout=45)
        stopped = True
        run(["docker", "stop", "--time", "30", API_NAME], timeout=45)
        test_stopped()
        no_pending()
        after = metric()
        event("after_stop", metric=after,
              mem_gain_kib=after["mem_kib"] - before["mem_kib"])
        if after["mem_kib"] < 819200:
            raise RuntimeError("post_stop_ram_floor")
        guard("maintenance")
        baseline = metric()
        pull(NEW_WEB, "web", baseline)
        pull(NEW_API, "api", baseline)
        host_gate(baseline, reserve=ROLLBACK_RESERVE_MIB)
        compose(["up", "-d", "--no-deps", "--no-build", "--pull", "never", "qrs_api"], NEW_API, NEW_WEB, new=True)
        if docker(API_NAME)["image"] != image(NEW_API, API_REV):
            raise RuntimeError("new_api_image_mismatch")
        wait_health(API_NAME, baseline, "http://127.0.0.1:14404/ready")
        compose(["up", "-d", "--no-deps", "--no-build", "--pull", "never", "qrs_web"], NEW_API, NEW_WEB, new=True)
        if docker(WEB_NAME)["image"] != image(NEW_WEB, WEB_REV):
            raise RuntimeError("new_web_image_mismatch")
        wait_health(WEB_NAME, baseline, "http://127.0.0.1:13300/auth")
        check_flags_and_routes()
        prod_check()
        check_production_unchanged(manifest)
        guard("full")
        check_production_unchanged(manifest)
        no_pending()
        event("BATCH2_PASS", final_metric=metric(), api=docker(API_NAME)["image"],
              web=docker(WEB_NAME)["image"])
        (RUN / "BATCH2_PASS").write_text("PASS\n", encoding="utf-8")
    except Exception as exc:
        reason = str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__
        event("attempt_failed", reason=reason)
        if stopped:
            rollback(reason)
        else:
            (RUN / "BLOCKED_BEFORE_STOP").write_text(reason + "\n", encoding="utf-8")
        raise


if __name__ == "__main__":
    if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] not in ("prepare", "resume-preparation", "execute"):
        sys.exit("root and prepare|resume-preparation|execute are required")
    try:
        if sys.argv[1] == "prepare":
            prepare()
        elif sys.argv[1] == "resume-preparation":
            resume_preparation()
        else:
            execute()
    except Exception as exc:
        print(json.dumps({"status": "FAIL", "error_type": type(exc).__name__,
                          "reason": str(exc) if isinstance(exc, RuntimeError) else "redacted"}), flush=True)
        sys.exit(1)
