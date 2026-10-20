#!/usr/bin/env python3
"""One guarded HolyPilot Web-only release from already cached immutable images.

Stages the previously reviewed release-one shell script. This path never pulls
or builds images. Every resource guard is the original, unmodified Web guard.
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
WATCH_SHA = "ba441496935195597a45dc846ef8dc76fcde32a36c32e9710d546f4ee4e64fe2"
GUARD = Path("/var/backups/adforge-mcp/holypilot-brand-only-20261016T173131Z/resource-guard.py")
GUARD_SHA = "6f256d9b68bc6c909a6a4754bfda003333fe01ab80027e4c0d5db799374a5fa4"
OLD_IMAGE = "sha256:09c08234278a6eee22c866bd260d5c6ddc66806a977afc2e6b51077c0677a833"
OLD_REF = ("ghcr.io/stanforge-labs/holymedia-mcp-v2:"
           "public-mcp-candidate-a00817b746211a295bcb966f7fd7ef12cd6178fb@" + OLD_IMAGE)
OLD_SOURCE_SHA = "a00817b746211a295bcb966f7fd7ef12cd6178fb"
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


def ensure_immediate_preflight(current):
    # Owner-approved cache-only release floor; the original 10,240 MiB guard is unchanged.
    if (current["mem"] < 819200 or current["swapfree"] < 262144 or
            current["disk_mib"] < 11500 or current["full"] >= 1.5 or
            current["some"] >= 2.0):
        raise RuntimeError("immediate_preflight_fail")


def verify_cached_image(reference, expected_digest, expected_revision, expected_id):
    """Inspect the local Docker cache only; missing or mismatched images fail closed."""
    document = json.loads(output(["docker", "image", "inspect", reference]))
    if not isinstance(document, list) or len(document) != 1:
        raise RuntimeError("cached_image_inspect_incomplete")
    image = document[0]
    if image.get("Id") != expected_id:
        raise RuntimeError("cached_image_id_mismatch")
    if image.get("Config", {}).get("Labels", {}).get(
            "org.opencontainers.image.revision") != expected_revision:
        raise RuntimeError("cached_image_revision_mismatch")
    expected_ref = "ghcr.io/stanforge-labs/holymedia-mcp-v2@" + expected_digest
    if expected_ref not in image.get("RepoDigests", []):
        raise RuntimeError("cached_image_repo_digest_mismatch")
    return image["Id"]


def prepare_startup_watcher(directory):
    source = OLD_PACKAGE / "startup-watch-unexecuted.py"
    if sha(source) != WATCH_SHA:
        raise RuntimeError("startup_watch_source_sha_mismatch")
    content = source.read_text()
    anchor = "    current = first\n    while time.monotonic() - start < 180:\n"
    replacement = ("    current = first\n"
                   "    trace = (directory / 'startup-watch-trace.jsonl').open('w', buffering=1)\n"
                   "    while time.monotonic() - start < 180:\n")
    if content.count(anchor) != 1:
        raise RuntimeError("startup_trace_anchor_mismatch")
    content = content.replace(anchor, replacement, 1)
    anchor = "        current = sample()\n        for key in low:"
    replacement = ("        current = sample()\n"
                   "        phase = ('candidate-running' if (directory / 'web-phase.candidate-running').exists() else\n"
                   "                 'starting-candidate' if (directory / 'web-phase.starting-candidate').exists() else\n"
                   "                 'old-stopped' if (directory / 'web-phase.old-stopped').exists() else\n"
                   "                 'stopping-old' if (directory / 'web-phase.stopping-old').exists() else\n"
                   "                 'before-stop')\n"
                   "        trace.write(json.dumps(dict(epoch=time.time(), phase=phase, **current), sort_keys=True) + '\\n')\n"
                   "        for key in low:")
    if content.count(anchor) != 1:
        raise RuntimeError("startup_sample_anchor_mismatch")
    content = content.replace(anchor, replacement, 1)
    anchor = "    result = dict(status='FAIL' if reason else 'PASS', reason=reason,"
    replacement = ("    if not reason and (directory / 'cutover-attempted').exists() and not "
                   "(directory / 'web-phase.candidate-running').exists():\n"
                   "        reason = 'candidate_not_running_in_watch_window'\n"
                   "        (directory / 'startup-watch.fail').write_text(reason)\n"
                   + anchor)
    if content.count(anchor) != 1:
        raise RuntimeError("startup_window_anchor_mismatch")
    content = content.replace(anchor, replacement, 1)
    destination = directory / "startup-watch-unexecuted.py"
    destination.write_text(content)
    destination.chmod(0o600)
    run([sys.executable, "-m", "py_compile", str(destination)])
    return sha(destination)


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
    replacements = {
        "image: $newref\nEOF": "image: $newref\n    pull_policy: never\nEOF",
        "image: $oldref\nEOF": "image: $oldref\n    pull_policy: never\nEOF",
        "new up -d --no-deps --no-build --force-recreate web":
            "new up -d --no-deps --no-build --pull never --force-recreate web",
        "old up -d --no-deps --no-build --force-recreate web":
            "old up -d --no-deps --no-build --pull never --force-recreate web",
        "touch \"$backup/cutover-attempted\"\ncutover=1":
            "[[ ! -e \"$backup/startup-watch.json\" && ! -e \"$backup/startup-watch.fail\" ]]\n"
            "touch \"$backup/web-phase.before-stop\"\n"
            "touch \"$backup/cutover-attempted\"\ncutover=1",
        "docker stop \"$web\" >/dev/null\n[[ $(docker inspect":
            "touch \"$backup/web-phase.stopping-old\"\n"
            "docker stop \"$web\" >/dev/null\n[[ $(docker inspect",
        "new up -d --no-deps --no-build --pull never --force-recreate web\nstatus=''":
            "touch \"$backup/web-phase.starting-candidate\"\n"
            "touch \"$backup/web-start.begin\"\n"
            "new up -d --no-deps --no-build --pull never --force-recreate web\n"
            "touch \"$backup/web-phase.candidate-running\"\n"
            "touch \"$backup/web-start.running\"\nstatus=''",
    }
    for anchor, replacement in replacements.items():
        if content.count(anchor) != 1:
            raise RuntimeError("release_cache_anchor_mismatch:" + anchor)
        content = content.replace(anchor, replacement, 1)
    stop_check = 'docker stop "$web" >/dev/null\n[[ $(docker inspect'
    check_start = content.find(stop_check)
    check_end = content.find("\n", check_start + len(stop_check)) if check_start >= 0 else -1
    if check_end < 0 or "== false ]]" not in content[check_start:check_end]:
        raise RuntimeError("old_web_stopped_check_anchor_mismatch")
    content = (content[:check_end + 1] + 'touch "$backup/web-phase.old-stopped"\n' +
               content[check_end + 1:])
    destination = directory / "release-one.sh"
    destination.write_text(content)
    destination.chmod(0o700)
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
    if all(first[name]["status"] == "exited" for name in TEST + DATA):
        raise RuntimeError("legacy_nine_container_release_disabled_for_production_only_topology")
    if any(first[name]["status"] != "running" or first[name]["health"] != "healthy" or
           first[name]["oom"] != "false" for name in ALL):
        raise RuntimeError("initial_container_health_fail")
    if first["holymedia-v2-web-1"]["image"] != OLD_IMAGE:
        raise RuntimeError("production_web_baseline_changed")
    verify_cached_image(OLD_REF, OLD_IMAGE, OLD_SOURCE_SHA, OLD_IMAGE)
    verify_cached_image(NEW_IMAGE, NEW_DIGEST, SOURCE_SHA, NEW_DIGEST)
    current = immediate()
    ensure_immediate_preflight(current)
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
    watcher_sha = prepare_startup_watcher(directory)
    append_event(directory, "rollback_ready", release_script_sha256=release_sha,
                 startup_watcher_sha256=watcher_sha, cached_digest=NEW_DIGEST)

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
    run_guard(directory, "precutover-guard.json")
    append_event(directory, "cached_image_pre_cutover_pass", digest=NEW_DIGEST)

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
    if len(sys.argv) != 3 or sys.argv[1] != "--from-cache":
        raise SystemExit("explicit --from-cache and one protected run directory required")
    main(Path(sys.argv[2]))
