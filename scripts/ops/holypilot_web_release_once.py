#!/usr/bin/env python3
"""One authorized HolyPilot Web-only release attempt on the existing VPS.

Stages the already reviewed release-one shell script and immutable source image.
Every resource guard is the original, unmodified production Web guard.
"""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time


OLD_PACKAGE = Path("/var/backups/adforge-mcp/holypilot-brand-web-20261016T180408Z")
OLD_SCRIPT_SHA = "273d1cb348c9eb4dbdaaaf3a60f78c83b691c7a5bf60e5e63b66bb6d699393cd"
GUARD = Path("/var/backups/adforge-mcp/holypilot-brand-only-20261016T173131Z/resource-guard.py")
GUARD_SHA = "6f256d9b68bc6c909a6a4754bfda003333fe01ab80027e4c0d5db799374a5fa4"
OLD_IMAGE = "sha256:09c08234278a6eee22c866bd260d5c6ddc66806a977afc2e6b51077c0677a833"
NEW_DIGEST = "sha256:1c39775ffbb095cc7d9037dfbea874be146ad25fe88ce255eaa794b0ccfd9ec0"
NEW_IMAGE = "ghcr.io/stanforge-labs/holymedia-mcp-v2@" + NEW_DIGEST
SOURCE_SHA = "fa9805b0adeed1b225e34605b02ad0b67d5ebc33"
TEST = ("holymedia-qrs-test-qrs_api-1", "holymedia-qrs-test-qrs_web-1")
PROD = ("holymedia-v2-api-1", "holymedia-v2-web-1", "holymedia-v2-worker-1",
        "holymedia-v2-postgres-1", "holymedia-v2-redis-1")
DATA = ("holymedia-google-acceptance-postgres-1", "holymedia-google-acceptance-redis-1")
ALL = PROD + DATA + TEST
CONFIGS = {
    "base-compose.yml": Path("/opt/adforge-mcp-v2/infra/docker-compose.v2.production.yml"),
    "compose.env": Path("/etc/holymedia-v2/compose.env"),
    "web.env": Path("/etc/holymedia-v2/web.env"),
    "nginx-site": Path("/etc/nginx/sites-enabled/adforge-mcp"),
}
SQL = (
    "SELECT "
    "(SELECT count(*) FROM mcp_previews WHERE consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>now()),"
    "(SELECT count(*) FROM mcp_previews WHERE confirmed_at IS NOT NULL AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>now()),"
    "(SELECT count(*) FROM mcp_previews WHERE commit_attempted_at IS NOT NULL AND commit_status IS NULL),"
    "(SELECT count(*) FROM oauth_authorization_transactions WHERE consumed_at IS NULL AND expires_at>now()),"
    "(SELECT count(*) FROM oauth_states WHERE consumed_at IS NULL AND expires_at>now()),"
    "(SELECT count(*) FROM google_login_states WHERE consumed_at IS NULL AND expires_at>now());"
)


def run(args, *, timeout=90, stdout=None):
    return subprocess.run(args, check=True, text=True, timeout=timeout,
                          stdout=stdout or subprocess.PIPE, stderr=subprocess.STDOUT)


def output(args, *, timeout=90):
    return run(args, timeout=timeout).stdout.strip()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def append_event(directory, event, **details):
    with (directory / "events.jsonl").open("a", encoding="utf-8", buffering=1) as file:
        file.write(json.dumps(dict(utc=time.time(), event=event, **details), sort_keys=True) + "\n")


def inventory():
    fmt = "{{.Name}}|{{.Id}}|{{.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.OOMKilled}}"
    rows = output(["docker", "inspect", "--format", fmt, *ALL]).splitlines()
    if len(rows) != len(ALL):
        raise RuntimeError("container_inventory_incomplete")
    result = {}
    for row in rows:
        name, cid, image, status, health, oom = row.split("|")
        result[name.removeprefix("/")] = dict(id=cid, image=image,
            status=status, health=health, oom=oom)
    return result


def operations():
    raw = output(["docker", "exec", DATA[0], "sh", "-c",
        'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "|" -c "$1"', "sh", SQL])
    values = [int(value) for value in raw.split("|")]
    if len(values) != 6 or any(values):
        raise RuntimeError("test_operations_not_quiescent")
    return values


def immediate():
    mem = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        key, *rest = line.split()
        if key in ("MemAvailable:", "SwapFree:"):
            mem[key[:-1]] = int(rest[0])
    psi = {}
    for line in Path("/proc/pressure/memory").read_text().splitlines():
        parts = line.split()
        if parts[0] in ("full", "some"):
            psi[parts[0]] = float(parts[1].split("=")[1])
    stat = os.statvfs("/")
    disk_mib = stat.f_bavail * stat.f_frsize // 1048576
    return dict(mem=mem["MemAvailable"], swapfree=mem["SwapFree"],
                full=psi["full"], some=psi["some"], disk_mib=disk_mib)


def run_guard(directory, filename):
    append_event(directory, "guard_start", file=filename)
    with (directory / filename).open("w", encoding="utf-8") as log:
        result = subprocess.run([sys.executable, str(GUARD), "--seconds", "600"],
                                stdout=log, stderr=subprocess.STDOUT, check=False, timeout=690)
    append_event(directory, "guard_end", file=filename, returncode=result.returncode)
    if result.returncode != 0:
        raise RuntimeError("resource_guard_fail:" + filename)
    verdict = json.loads((directory / filename).read_text())
    if verdict.get("status") != "PASS" or verdict.get("duration_s", 0) < 600:
        raise RuntimeError("resource_guard_incomplete:" + filename)


def prepare_release_script(directory):
    source = OLD_PACKAGE / "release-one-unexecuted.sh"
    if sha(source) != OLD_SCRIPT_SHA:
        raise RuntimeError("release_source_sha_mismatch")
    content = source.read_text()
    original_path = str(OLD_PACKAGE)
    if content.count("backup=" + original_path) != 1:
        raise RuntimeError("release_backup_anchor_mismatch")
    content = content.replace("backup=" + original_path, "backup=" + str(directory), 1)
    before = 'cp /tmp/holypilot-startup-watch.py "$backup/startup-watch.py"'
    after = 'cp "$backup/startup-watch-unexecuted.py" "$backup/startup-watch.py"'
    if content.count(before) != 1:
        raise RuntimeError("startup_watch_anchor_mismatch")
    content = content.replace(before, after, 1)
    destination = directory / "release-one.sh"
    destination.write_text(content)
    destination.chmod(0o700)
    shutil.copy2(OLD_PACKAGE / "startup-watch-unexecuted.py",
                 directory / "startup-watch-unexecuted.py")
    (directory / "startup-watch-unexecuted.py").chmod(0o600)
    run(["bash", "-n", str(destination)])
    return sha(destination)


def main(directory):
    if os.geteuid() != 0 or not directory.is_absolute():
        raise RuntimeError("root_and_absolute_run_directory_required")
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    directory.chmod(0o700)
    if sha(GUARD) != GUARD_SHA:
        raise RuntimeError("original_guard_sha_mismatch")
    first = inventory()
    if any(first[name]["status"] != "running" or first[name]["health"] != "healthy" or
           first[name]["oom"] != "false" for name in ALL):
        raise RuntimeError("initial_container_health_fail")
    if first["holymedia-v2-web-1"]["image"] != OLD_IMAGE:
        raise RuntimeError("production_web_baseline_changed")
    run(["docker", "image", "inspect", OLD_IMAGE])
    current = immediate()
    if (current["mem"] < 819200 or current["swapfree"] < 262144 or
            current["disk_mib"] < 12000 or current["full"] >= 1.5 or
            current["some"] >= 2.0):
        raise RuntimeError("immediate_preflight_fail")
    counts = operations()
    append_event(directory, "preflight_pass", resources=current, operations=counts)
    with (directory / "container-ids.txt").open("w") as file:
        for name in ALL:
            file.write(f"{name}|{first[name]['id']}|{first[name]['image']}\n")
    (directory / "container-ids.txt").chmod(0o600)
    for target, source in CONFIGS.items():
        shutil.copy2(source, directory / target)
        (directory / target).chmod(0o600)
    (directory / "config-sha256.json").write_text(json.dumps(
        {str(source): sha(source) for source in CONFIGS.values()}, sort_keys=True))
    (directory / "config-sha256.json").chmod(0o600)
    (directory / "old-web-image-id.txt").write_text(OLD_IMAGE + "\n")
    release_sha = prepare_release_script(directory)
    append_event(directory, "rollback_ready", release_script_sha256=release_sha)

    for name in TEST:
        run(["docker", "stop", "--time", "25", name], timeout=50)
    stopped = inventory()
    if any(stopped[name]["status"] != "exited" or stopped[name]["id"] != first[name]["id"]
           for name in TEST):
        raise RuntimeError("test_stop_incomplete")
    if any(stopped[name]["status"] != "running" or stopped[name]["health"] != "healthy"
           for name in PROD + DATA):
        raise RuntimeError("other_service_changed_after_test_stop")
    append_event(directory, "test_stopped")
    time.sleep(15)  # let Docker tear down both TEST application shims
    run_guard(directory, "prepull-guard.json")

    append_event(directory, "image_pull_start", digest=NEW_DIGEST)
    with (directory / "pull.log").open("w", encoding="utf-8") as log:
        pull = subprocess.run(["docker", "pull", NEW_IMAGE], stdout=log,
                              stderr=subprocess.STDOUT, check=False, timeout=900)
    if pull.returncode != 0:
        raise RuntimeError("immutable_image_pull_failed")
    if output(["docker", "image", "inspect", NEW_IMAGE,
               "--format", '{{index .Config.Labels "org.opencontainers.image.revision"}}']) != SOURCE_SHA:
        raise RuntimeError("oci_revision_mismatch")
    digests = output(["docker", "image", "inspect", NEW_IMAGE,
                      "--format", "{{join .RepoDigests \"|\"}}"])
    if NEW_DIGEST not in digests:
        raise RuntimeError("repo_digest_mismatch")
    append_event(directory, "image_verified", digest=NEW_DIGEST, resources=immediate())
    run_guard(directory, "postpull-guard.json")

    append_event(directory, "web_cutover_start")
    with (directory / "release-one.log").open("w", encoding="utf-8") as log:
        result = subprocess.run(["bash", str(directory / "release-one.sh")], stdout=log,
                                stderr=subprocess.STDOUT, check=False, timeout=2400)
    append_event(directory, "web_cutover_end", returncode=result.returncode)
    if result.returncode != 0:
        raise RuntimeError("web_release_fail")
    last = inventory()
    if any(last[name]["status"] != "running" or last[name]["health"] != "healthy"
           for name in ALL):
        raise RuntimeError("final_container_health_fail")
    if any(last[name]["id"] != first[name]["id"] or
           last[name]["image"] != first[name]["image"] for name in ALL if name != "holymedia-v2-web-1"):
        raise RuntimeError("non_web_container_changed")
    if {str(source): sha(source) for source in CONFIGS.values()} != json.loads(
            (directory / "config-sha256.json").read_text()):
        raise RuntimeError("protected_config_changed")
    append_event(directory, "live_pass", containers=last)
    (directory / "published").touch()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("one protected run directory required")
    main(Path(sys.argv[1]))
