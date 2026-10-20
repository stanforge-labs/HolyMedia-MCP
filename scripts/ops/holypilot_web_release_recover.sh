#!/usr/bin/env bash
# One protected recovery for the five-production-container topology.
# Historical nine-container run directories fail closed; TEST is never started.
set -Eeuo pipefail

run_dir=${1:?protected run directory required}
[[ -f "$run_dir/production-only-plan.json" ]] || {
  echo 'PRODUCTION_ONLY_CHECKPOINT_REQUIRED' >&2; exit 80;
}
[[ -f "$run_dir/cutover-attempted" ]] || exit 0
[[ ! -f "$run_dir/published" ]] || exit 0

python3 - "$run_dir" <<'PY'
import json
import hashlib
from pathlib import Path
import subprocess
import sys
import time

run_dir = Path(sys.argv[1])
plan = json.loads((run_dir / "production-only-plan.json").read_text())
service = plan["service"]
if service not in ("api", "web"):
    raise SystemExit("INVALID_RELEASE_SERVICE")
target = "holymedia-v2-" + service + "-1"
base = "/opt/adforge-mcp-v2/infra/docker-compose.v2.production.yml"
envfile = "/etc/holymedia-v2/compose.env"
if any(hashlib.sha256(Path(path).read_bytes()).hexdigest() != plan["config_sha256"][name]
       for name, path in plan["config_paths"].items()):
    raise SystemExit("PROTECTED_CONFIG_CHANGED")

def output(args):
    return subprocess.check_output(args, text=True, timeout=90).strip()

def inspect(name, template):
    return output(["docker", "inspect", name, "--format", template])

def test_still_retired():
    for name, expected in plan["test_checkpoint"].items():
        if (inspect(name, "{{.Id}}") != expected["id"] or
                inspect(name, "{{.Image}}") != expected["image"] or
                inspect(name, "{{.State.Status}}") != "exited" or
                inspect(name, "{{.HostConfig.RestartPolicy.Name}}") != "no"):
            raise RuntimeError("TEST_STATE_CHANGED:" + name)

def other_production_healthy():
    for name, expected in plan["production_baseline"].items():
        if name == target:
            continue
        if (inspect(name, "{{.Id}}") != expected["id"] or
                inspect(name, "{{.Image}}") != expected["image"] or
                inspect(name, "{{if .State.Health}}{{.State.Health.Status}}{{end}}") != "healthy"):
            raise RuntimeError("OTHER_PRODUCTION_CHANGED:" + name)

def ready():
    subprocess.run(["curl", "-fsS", "--max-time", "5",
                    "https://mcp.holymedia.kz/ready"], check=True,
                   stdout=subprocess.DEVNULL, timeout=10)

test_still_retired()
other_production_healthy()
current_image = inspect(target, "{{.Image}}")
current_health = inspect(target, "{{if .State.Health}}{{.State.Health.Status}}{{end}}")
current_status = inspect(target, "{{.State.Status}}")
if (current_image == plan["old_image_id"] and current_health == "healthy" and
        current_status == "running"):
    ready()
    print("BASELINE_ALREADY_HEALTHY; TEST_STILL_STOPPED")
    raise SystemExit(0)
marker = run_dir / "rollback-attempted"
if marker.exists():
    raise SystemExit("ROLLBACK_REPEAT_BLOCKED")
marker.touch(mode=0o600)
subprocess.run(["docker", "stop", target], check=False, stdout=subprocess.DEVNULL,
               stderr=subprocess.DEVNULL, timeout=60)
if inspect(target, "{{.State.Status}}") != "exited":
    raise RuntimeError("NEW_CONTAINER_NOT_STOPPED_FOR_ROLLBACK")
command = ["docker", "compose", "--env-file", envfile, "-f", base,
           "-f", str(run_dir / ("old-" + service + ".yml")),
           "up", "-d", "--no-deps", "--no-build", "--pull", "never",
           "--force-recreate", service]
subprocess.run(command, check=True, timeout=180)
for _ in range(60):
    if inspect(target, "{{if .State.Health}}{{.State.Health.Status}}{{end}}") == "healthy":
        break
    time.sleep(2)
else:
    raise RuntimeError("ROLLBACK_UNHEALTHY")
if (inspect(target, "{{.Image}}") != plan["old_image_id"] or
        inspect(target, "{{.State.Status}}") != "running"):
    raise RuntimeError("ROLLBACK_IMAGE_MISMATCH")
test_still_retired()
other_production_healthy()
ready()
print("ROLLBACK_VERIFIED; TEST_STILL_STOPPED")
PY
