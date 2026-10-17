#!/usr/bin/env python3
"""One future owner-authorized, no-pull TEST-only Web/API maintenance attempt.

Prepare and execute are separate, single-use commands. This file must not be
run against the VPS until the owner separately authorizes the TEST cutover.
"""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import time

import batch2_test_maintenance_once_v2 as prior
import no_pull_api_bundle as bundle_tool


RUN = prior.BASE / "rollback" / "batch2-no-pull-20261018-once"
STAGE = prior.BASE / "batch2-no-pull-staging"
ARCHIVE_SHA256 = "999d9ba21329217c7f71b76f8cda180190ac3fc8be7006bb13bf03840622cf32"
MANIFEST_SHA256 = "7c062c11bb1ab0eda1bcc7b71682d77f32dd6450bcfbeada23f1c27080c7594a"
OLD_WEB_SOURCE = "367a634c063492a6592e708b179ac240f9a68b61"
OLD_API_SOURCE = "207ddbe3708be5cde28dfc250c30e29360e9d246"
NEW_API_SOURCE = prior.API_REV
EXPECTED_FILES = 36
MAX_ARCHIVE_BYTES = 2 * 1024 * 1024
MAX_EXPANDED_BYTES = 3 * 1024 * 1024
SOURCE_HASHES = {
    "batch2_test_maintenance_once_v2.py": "2a51f40e2b4327222bf009658a1c2124e3f94d06b2b88ee3357a36daae6349ab",
    "batch2_test_maintenance_guard.py": "ba393db3d1bd67bbefe562b1e150b8158ce078c24b5ddda1a894d6188bd990d8",
    "maintenance_guard_policy.py": "9e7a631a34a7ac84f3c902553d13f20b09a11abcbb3854ccd3e858ff23295a9a",
    "web_only_guard_policy.py": "812c9e899546460d7a220943cf08ccb21f2ce436266a2c4b95d5f759724097bf",
    "no_pull_api_bundle.py": "ef64a00a5dda57bc5d76327af817bac72bd50cf31fbcd10cb8f1cefbff77826a",
    "no-pull-web-health.override.yml": "bb1e9f1e7bfa95545afc7a9a92ed7f1e4b933e938c536c5fe810d2d8fd7294c7",
}
prior.RUN = RUN


def safe_extract(archive: Path, target: Path) -> None:
    """Extract only manifest and listed code files; reject links and traversal."""
    if not archive.is_file() or archive.is_symlink() or archive.stat().st_size > MAX_ARCHIVE_BYTES:
        raise RuntimeError("release_archive_missing_or_oversize")
    if prior.digest(archive) != ARCHIVE_SHA256:
        raise RuntimeError("release_archive_sha_mismatch")
    total = 0
    seen = set()
    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            name = member.name.removeprefix("./")
            if member.isdir() or name == ".":
                continue
            if (not member.isfile() or name in seen or
                    (name != "manifest.json" and not name.startswith("files/")) or
                    ".." in Path(name).parts or Path(name).is_absolute()):
                raise RuntimeError("release_archive_unsafe_member")
            seen.add(name)
            total += member.size
            if total > MAX_EXPANDED_BYTES:
                raise RuntimeError("release_archive_expansion_limit")
            destination = target / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            with source.extractfile(member) as incoming, destination.open("xb") as outgoing:
                shutil.copyfileobj(incoming, outgoing)
            destination.chmod(0o444)
    if "manifest.json" not in seen or prior.digest(target / "manifest.json") != MANIFEST_SHA256:
        raise RuntimeError("release_manifest_sha_mismatch")
    manifest = bundle_tool.verify(target)
    if (manifest.get("old_image") != prior.OLD_API or
            manifest.get("candidate_image") != prior.NEW_API or
            manifest.get("source_sha") != NEW_API_SOURCE or
            len(manifest["files"]) != EXPECTED_FILES):
        raise RuntimeError("release_manifest_contract_mismatch")


def source_gate() -> None:
    if not STAGE.is_dir() or STAGE.is_symlink() or STAGE.stat().st_mode & 0o077:
        raise RuntimeError("protected_staging_missing")
    for name, want in SOURCE_HASHES.items():
        path = STAGE / name
        if not path.is_file() or path.is_symlink() or path.stat().st_mode & 0o077 or prior.digest(path) != want:
            raise RuntimeError("staged_source_sha_mismatch_" + name)


def compose(args, *, candidate: bool, timeout: int = 90):
    cmd = ["docker", "compose", "-p", "holymedia-qrs-test", "-f",
           str(RUN / "docker-compose.yml"), "-f", str(RUN / "qrs-clone.override.yml")]
    if candidate:
        cmd += ["-f", str(RUN / "no-pull-web-health.override.yml"),
                "-f", str(RUN / "api-mounts.json")]
    cmd += args
    result = subprocess.run(cmd, env=prior.compose_env(prior.OLD_API, prior.OLD_WEB),
                            stdout=subprocess.PIPE if args[:2] == ["config", "--format"] else subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError("compose_command_failed")
    return result.stdout


def model_gate() -> None:
    current = json.loads(compose(["config", "--format", "json"], candidate=False))
    proposed = json.loads(compose(["config", "--format", "json"], candidate=True))
    if set(current["services"]) != {"qrs_api", "qrs_web"} or set(proposed["services"]) != set(current["services"]):
        raise RuntimeError("compose_services_drift")
    for service in ("qrs_api", "qrs_web"):
        old, new = dict(current["services"][service]), dict(proposed["services"][service])
        if old["image"] != (prior.OLD_API if service == "qrs_api" else prior.OLD_WEB) or new["image"] != old["image"]:
            raise RuntimeError("compose_image_drift")
        if service == "qrs_api":
            mounts = new.pop("volumes", [])
            if len(mounts) != EXPECTED_FILES or any(x.get("read_only") is not True for x in mounts):
                raise RuntimeError("compose_read_only_mounts_invalid")
            old.pop("volumes", None)
        else:
            probe = new.pop("healthcheck", {})
            old.pop("healthcheck", None)
            if probe.get("test", [])[:3] != ["CMD", "bash", "-ec"] or probe.get("interval") != "15s" or probe.get("timeout") != "5s":
                raise RuntimeError("compose_web_probe_invalid")
        if old != new:
            raise RuntimeError("compose_unapproved_service_change")
    env = proposed["services"]["qrs_api"]["environment"]
    if (env.get("GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST") != "8590146099" or
            env.get("QRS_TEST_RESTRICTED_AUTH") != "true" or
            env.get("QRS_TEST_CONVERSION_ACTION_CONFIRMED_WRITE_ENABLED", "false") != "false" or
            env.get("QRS_TEST_PMAX_CONFIRMED_WRITE_ENABLED") != "false" or
            env.get("V2_CONFIRMED_WRITE_ENABLED") != "false"):
        raise RuntimeError("test_write_gate_drift")


def runtime_shape(name: str) -> dict:
    mounts = json.loads(prior.output(["docker", "inspect", name,
                                     "--format", "{{json .Mounts}}"] ))
    probe = json.loads(prior.output(["docker", "inspect", name,
                                    "--format", "{{json .Config.Healthcheck.Test}}"] ))
    return {"mounts": sorted([item["Source"], item["Destination"], item["RW"]]
                             for item in mounts), "healthcheck": probe}


def preflight() -> dict:
    if prior.digest(prior.COMPOSE) != prior.BASE_SHA or prior.digest(prior.CLONE) != prior.CLONE_SHA:
        raise RuntimeError("protected_compose_drift")
    for path in (prior.COMPOSE, prior.CLONE, prior.ENV, prior.LOGIN_ENV):
        if not path.is_file() or path.is_symlink() or path.stat().st_mode & 0o077:
            raise RuntimeError("protected_config_missing_or_mode")
    for ref, name, source in ((prior.OLD_API, prior.API_NAME, OLD_API_SOURCE),
                              (prior.OLD_WEB, prior.WEB_NAME, OLD_WEB_SOURCE)):
        if prior.image(ref, source) != prior.docker(name)["image"]:
            raise RuntimeError("installed_image_drift")
    for name in (prior.API_NAME, prior.WEB_NAME, prior.PG_NAME, prior.REDIS_NAME, *prior.PROD_NAMES):
        row = prior.docker(name)
        if row["state"] != "running" or row["health"] != "healthy" or row["oom"] or row["auto_remove"]:
            raise RuntimeError("container_preflight_failed")
    if prior.output(["systemctl", "list-jobs", "--no-legend"]):
        raise RuntimeError("systemd_job_active")
    if any(x in {"apt", "apt-get", "dpkg", "pg_dump", "pg_restore"} for x in prior.output(["ps", "-eo", "comm="]).splitlines()):
        raise RuntimeError("background_maintenance_active")
    prior.no_pending()
    prior.prod_check()
    for url in ("http://127.0.0.1:14404/ready", "http://127.0.0.1:13300/auth",
                "http://127.0.0.1:13300/mcp/approve"):
        prior.http(url, 200)
    values = prior.metric()
    if (values["disk_free_mib"] < prior.ROOT_FREE_REQUIRED + prior.ROLLBACK_RESERVE_MIB + 32 or
            values["swap_free_kib"] < 262144 or values["psi_full"] >= 1.5 or values["oom_kill"] != 0):
        raise RuntimeError("initial_host_unsafe")
    return values


def prepare(archive: Path) -> None:
    if RUN.exists():
        raise RuntimeError("one_attempt_directory_exists")
    source_gate()
    baseline = preflight()
    RUN.mkdir(mode=0o700)
    prior.event("prepare_started", baseline=baseline, source_gate="PASS")
    for src, name in ((prior.COMPOSE, "docker-compose.yml"), (prior.CLONE, "qrs-clone.override.yml"),
                      (prior.ENV, "acceptance.env"), (prior.LOGIN_ENV, "google-login.env"),
                      (Path(__file__), "batch2_no_pull_test_once.py"),
                      *[(STAGE / name, name) for name in SOURCE_HASHES]):
        target = RUN / name
        shutil.copyfile(src, target)
        target.chmod(0o600)
    release = RUN / "release"
    release.mkdir(mode=0o700)
    safe_extract(archive, release)
    bundle_tool.compose(release, RUN / "api-mounts.json", "qrs_api")
    (RUN / "api-mounts.json").chmod(0o600)
    model_gate()
    db, redis = RUN / "test-db.dump", RUN / "test-redis.rdb"
    prior.backup_one(db, ["docker", "exec", prior.PG_NAME, "sh", "-c",
                          'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'])
    prior.backup_one(redis, ["docker", "exec", prior.REDIS_NAME, "sh", "-c",
                             'exec env REDISCLI_AUTH="$ACCEPTANCE_REDIS_PASSWORD" redis-cli --rdb -'])
    if db.open("rb").read(5) != b"PGDMP" or redis.open("rb").read(5) != b"REDIS":
        raise RuntimeError("backup_header_invalid")
    with db.open("rb") as source:
        prior.run(["docker", "exec", "-i", prior.PG_NAME, "pg_restore", "-l"], stdin=source)
    if prior.metric()["disk_free_mib"] < prior.ROOT_FREE_REQUIRED + prior.ROLLBACK_RESERVE_MIB:
        raise RuntimeError("post_backup_disk_floor")
    prior.no_pending()
    prior.prod_check()
    manifest = {
        "archive_sha256": ARCHIVE_SHA256,
        "old_api_id": prior.image(prior.OLD_API), "old_web_id": prior.image(prior.OLD_WEB),
        "base_sha256": prior.digest(prior.COMPOSE), "clone_sha256": prior.digest(prior.CLONE),
        "runner_sha256": prior.digest(RUN / "batch2_no_pull_test_once.py"),
        "files": {name: prior.digest(RUN / name) for name in SOURCE_HASHES},
        "api_mounts_sha256": prior.digest(RUN / "api-mounts.json"),
        "backups": {"db": {"sha256": prior.digest(db), "bytes": db.stat().st_size},
                    "redis": {"sha256": prior.digest(redis), "bytes": redis.stat().st_size}},
        "production": {name: prior.docker(name) for name in prior.PROD_NAMES},
        "test_runtime": {name: runtime_shape(name) for name in (prior.API_NAME, prior.WEB_NAME)},
    }
    (RUN / "manifest.json").write_text(json.dumps(manifest, sort_keys=True) + "\n", encoding="utf-8")
    (RUN / "manifest.json").chmod(0o600)
    prior.event("prepared", disk_free_mib=prior.metric()["disk_free_mib"])


def candidate_gate() -> None:
    for name, ref in ((prior.API_NAME, prior.OLD_API), (prior.WEB_NAME, prior.OLD_WEB)):
        if prior.docker(name)["image"] != prior.image(ref) or prior.docker(name)["health"] != "healthy":
            raise RuntimeError("candidate_image_or_health_invalid")
    manifest = bundle_tool.verify(RUN / "release")
    mounts = json.loads(prior.output(["docker", "inspect", prior.API_NAME,
                                    "--format", "{{json .Mounts}}"] ))
    if len(mounts) != EXPECTED_FILES or any(x.get("RW") is not False for x in mounts):
        raise RuntimeError("candidate_mounts_not_read_only")
    for entry in manifest["files"]:
        actual = prior.output(["docker", "exec", prior.API_NAME, "sha256sum",
                               "/workspace/" + entry["path"]]).split()[0]
        if actual != entry["sha256"]:
            raise RuntimeError("candidate_compiled_file_drift")
    model = json.loads(compose(["config", "--format", "json"], candidate=True))
    expected_probe = model["services"]["qrs_web"]["healthcheck"]["test"]
    actual_probe = json.loads(prior.output(["docker", "inspect", prior.WEB_NAME,
                                           "--format", "{{json .Config.Healthcheck.Test}}"] ))
    if actual_probe != expected_probe:
        raise RuntimeError("candidate_web_probe_drift")
    env_lines = prior.output(["docker", "inspect", prior.API_NAME, "--format",
                              "{{range .Config.Env}}{{println .}}{{end}}"] ).splitlines()
    env = dict(line.split("=", 1) for line in env_lines if "=" in line)
    for key, value in (("QRS_TEST_RESTRICTED_AUTH", "true"),
                       ("GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST", "8590146099"),
                       ("QRS_TEST_CONVERSION_ACTION_CONFIRMED_WRITE_ENABLED", "false"),
                       ("QRS_TEST_PMAX_CONFIRMED_WRITE_ENABLED", "false"),
                       ("V2_CONFIRMED_WRITE_ENABLED", "false")):
        if env.get(key, "false" if value == "false" else None) != value:
            raise RuntimeError("candidate_flag_drift")
    routes = (("http://127.0.0.1:14404/health", 200),
              ("http://127.0.0.1:14404/ready", 200),
              ("http://127.0.0.1:13300/auth", 200),
              ("http://127.0.0.1:13300/en/auth", 200),
              ("http://127.0.0.1:13300/mcp/approve", 200),
              ("http://127.0.0.1:13300/connect/claude", 200),
              ("https://mcp-test.holymedia.kz/.well-known/oauth-authorization-server", 200),
              ("https://mcp-test.holymedia.kz/api/v1/auth/csrf", 200))
    for url, code in routes:
        prior.http(url, code)
    # A protected route must still reject unauthenticated requests.
    prior.http("http://127.0.0.1:14404/mcp", 401)
    prior.no_pending()
    prior.event("candidate_routes_pass", checked=len(routes) + 1)


def execute() -> None:
    marker = RUN / "EXECUTION_STARTED"
    if not (RUN / "manifest.json").is_file() or marker.exists():
        raise RuntimeError("not_prepared_or_attempt_already_used")
    marker.write_text(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + "\n")
    marker.chmod(0o600)
    stopped = False
    try:
        manifest = json.loads((RUN / "manifest.json").read_text())
        source_gate()
        preflight()
        model_gate()
        if (prior.digest(Path(__file__)) != manifest["runner_sha256"] or
                prior.digest(RUN / "batch2_no_pull_test_once.py") != manifest["runner_sha256"]):
            raise RuntimeError("runner_source_drift")
        if (prior.digest(RUN / "docker-compose.yml") != prior.BASE_SHA or
                prior.digest(RUN / "qrs-clone.override.yml") != prior.CLONE_SHA or
                prior.digest(RUN / "api-mounts.json") != manifest["api_mounts_sha256"]):
            raise RuntimeError("protected_execution_file_drift")
        for name, expected in manifest["files"].items():
            if prior.digest(RUN / name) != expected:
                raise RuntimeError("staged_file_drift")
        bundle_tool.verify(RUN / "release")
        for key, name in (("db", "test-db.dump"), ("redis", "test-redis.rdb")):
            path = RUN / name
            if (path.stat().st_mode & 0o077 or path.stat().st_size != manifest["backups"][key]["bytes"] or
                    prior.digest(path) != manifest["backups"][key]["sha256"]):
                raise RuntimeError("backup_drift")
        before = prior.metric()
        prior.event("before_stop", metric=before)
        prior.run(["docker", "stop", "--time", "30", prior.WEB_NAME], timeout=45)
        stopped = True
        prior.run(["docker", "stop", "--time", "30", prior.API_NAME], timeout=45)
        prior.test_stopped()
        prior.no_pending()
        after = prior.metric()
        prior.event("after_stop", metric=after, mem_gain_kib=after["mem_kib"] - before["mem_kib"])
        prior.guard("maintenance")
        baseline = prior.metric()
        prior.host_gate(baseline, reserve=prior.ROLLBACK_RESERVE_MIB)
        compose(["up", "-d", "--no-deps", "--no-build", "--pull", "never", "qrs_api"], candidate=True)
        prior.wait_health(prior.API_NAME, baseline, "http://127.0.0.1:14404/ready")
        compose(["up", "-d", "--no-deps", "--no-build", "--pull", "never", "qrs_web"], candidate=True)
        prior.wait_health(prior.WEB_NAME, baseline, "http://127.0.0.1:13300/auth")
        candidate_gate()
        prior.prod_check()
        prior.check_production_unchanged(manifest)
        prior.guard("full")
        prior.check_production_unchanged(manifest)
        prior.no_pending()
        prior.event("BATCH2_NO_PULL_PASS", final_metric=prior.metric())
        (RUN / "BATCH2_NO_PULL_PASS").write_text("PASS\n", encoding="utf-8")
    except Exception as error:
        reason = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        prior.event("attempt_failed", reason=reason)
        if stopped:
            restored = prior.rollback(reason)
            if restored:
                try:
                    for name, original in manifest["test_runtime"].items():
                        if runtime_shape(name) != original:
                            raise RuntimeError("rollback_test_runtime_shape_drift")
                except Exception as rollback_error:
                    (RUN / "ROLLED_BACK").unlink(missing_ok=True)
                    (RUN / "ROLLBACK_UNVERIFIED").write_text(
                        type(rollback_error).__name__ + "\n", encoding="utf-8")
                    prior.event("rollback_shape_unverified", reason=type(rollback_error).__name__)
        else:
            (RUN / "BLOCKED_BEFORE_STOP").write_text(reason + "\n", encoding="utf-8")
        raise


def main() -> None:
    if os.geteuid() != 0 or len(sys.argv) not in (2, 3):
        raise RuntimeError("root_and_prepare_archive_or_execute_required")
    if sys.argv[1] == "prepare" and len(sys.argv) == 3:
        prepare(Path(sys.argv[2]))
    elif sys.argv[1] == "execute" and len(sys.argv) == 2:
        execute()
    else:
        raise RuntimeError("invalid_action")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"status": "FAIL", "error_type": type(error).__name__,
                          "reason": str(error) if isinstance(error, RuntimeError) else "redacted"}), flush=True)
        sys.exit(1)
