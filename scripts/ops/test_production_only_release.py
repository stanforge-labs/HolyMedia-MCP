"""Offline fail-closed release and recovery contract regressions."""

import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import production_only_release_once as release  # noqa: E402
from production_only_guard_policy import PROD, TEST  # noqa: E402
from test_production_only_guard import fixture  # noqa: E402


class ReleaseTests(unittest.TestCase):
    def test_web_functionality_checks_brand_routes_and_mcp_boundary(self):
        def response(args, **_kwargs):
            path = args[-1]
            if path == "https://mcp.holymedia.kz/mcp":
                return type("Result", (), {"stdout": "401"})()
            if path.endswith("/en"):
                body = "HolyPilot HolyPilot " + "/assets/brand/holy-pilot-symbol.svg " * 2 + "Your personal AI marketer"
            elif path == "https://mcp.holymedia.kz/":
                body = "HolyPilot HolyPilot " + "/assets/brand/holy-pilot-symbol.svg " * 2 + "Ваш персональный AI-маркетолог"
            elif path.endswith(".svg"):
                body = "<svg></svg>"
            else:
                body = "OK"
            return type("Result", (), {"stdout": body + "\n200"})()

        with patch.object(release, "command", side_effect=response) as command:
            release.verify_web_functionality()
        self.assertEqual(command.call_count, 11)

        def no_brand(args, **kwargs):
            result = response(args, **kwargs)
            if args[-1] == "https://mcp.holymedia.kz/en":
                result = type("Result", (), {"stdout": "old brand\n200"})()
            return result

        with patch.object(release, "command", side_effect=no_brand):
            with self.assertRaisesRegex(RuntimeError, "published_brand_content_mismatch"):
                release.verify_web_functionality()

        def redirected_auth(args, **kwargs):
            result = response(args, **kwargs)
            if args[-1] == "https://mcp.holymedia.kz/auth":
                result = type("Result", (), {"stdout": "\n302"})()
            return result

        with patch.object(release, "command", side_effect=redirected_auth):
            with self.assertRaisesRegex(RuntimeError, "public_route_http_status:/auth"):
                release.verify_web_functionality()

        def open_mcp(args, **kwargs):
            result = response(args, **kwargs)
            if args[-1] == "https://mcp.holymedia.kz/mcp":
                result = type("Result", (), {"stdout": "200"})()
            return result

        with patch.object(release, "command", side_effect=open_mcp):
            with self.assertRaisesRegex(RuntimeError, "mcp_unauthorized_boundary_changed"):
                release.verify_web_functionality()

    def test_prepare_stages_protected_checkpoint_without_container_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            config = base / "compose.yml"
            config.write_text("services: {}\n")
            _, events, checkpoint = fixture()
            rows = events[0]["containers"]
            target = "holymedia-v2-web-1"
            rows[target]["image"] = release.BASELINE_ID
            config_map = {"base-compose.yml": config}
            with patch.object(release, "CONFIGS", config_map), \
                    patch.object(release, "load_checkpoint", return_value=checkpoint), \
                    patch.object(release, "docker_state", return_value=rows), \
                    patch.object(release, "pending_operations", return_value=[0] * 6), \
                    patch.object(release, "baseline_image", return_value="ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:old"), \
                    patch.object(release, "candidate_image", return_value="ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:new"), \
                    patch.object(release, "image_document", return_value={"Id": "sha256:new"}), \
                    patch.object(release.legacy, "sha", return_value=release.legacy.WATCH_SHA), \
                    patch.object(release, "command") as command:
                run = base / "run"
                plan = release.prepare("web", run)
            command.assert_not_called()
            self.assertEqual(plan["old_image_id"], release.BASELINE_ID)
            self.assertEqual(plan["new_image_id"], "sha256:new")
            self.assertEqual((run / "production-only-plan.json").stat().st_mode & 0o777, 0o600)
            self.assertEqual(run.stat().st_mode & 0o777, 0o700)
            self.assertIn("pull_policy: never", (run / "old-web.yml").read_text())
            self.assertIn("pull_policy: never", (run / "new-web.yml").read_text())

    def test_stopped_test_passes_and_running_test_blocks(self):
        _, observations, checkpoint = fixture()
        release.verify_topology(observations[0]["containers"], checkpoint)
        observations[0]["containers"][TEST[0]]["status"] = "running"
        with self.assertRaisesRegex(RuntimeError, "test_not_stopped"):
            release.verify_topology(observations[0]["containers"], checkpoint)

    def test_compose_is_cache_only_one_service(self):
        with patch.object(release, "command") as command:
            release.compose_replace(Path("/protected"), "api", "new")
        args = command.call_args.args[0]
        self.assertEqual(args[-2:], ["--force-recreate", "api"])
        self.assertIn("--pull", args)
        self.assertEqual(args[args.index("--pull") + 1], "never")
        self.assertIn("--no-deps", args)
        self.assertIn("--no-build", args)
        self.assertNotIn("web", args)

    def test_candidate_revision_and_digest_mismatch_fail(self):
        digest, revision = release.CANDIDATES["web"]
        ref = "ghcr.io/stanforge-labs/holymedia-mcp-v2@" + digest
        valid = {"Id": digest, "RepoDigests": [ref],
                 "Config": {"Labels": {"org.opencontainers.image.revision": revision}}}
        with patch.object(release, "image_document", return_value=valid):
            self.assertEqual(release.candidate_image("web"), ref)
        for field, value in (("Id", "wrong"), ("RepoDigests", [])):
            with self.subTest(field=field):
                invalid = {**valid, field: value}
                with patch.object(release, "image_document", return_value=invalid):
                    with self.assertRaisesRegex(RuntimeError, "candidate_digest_or_revision_mismatch"):
                        release.candidate_image("web")
        invalid = json.loads(json.dumps(valid))
        invalid["Config"]["Labels"]["org.opencontainers.image.revision"] = "wrong"
        with patch.object(release, "image_document", return_value=invalid):
            with self.assertRaisesRegex(RuntimeError, "candidate_digest_or_revision_mismatch"):
                release.candidate_image("web")

    def test_missing_cached_api_image_fails_closed(self):
        with patch.object(release, "image_document", side_effect=subprocess.CalledProcessError(
                1, ["docker", "image", "inspect"])):
            with self.assertRaises(subprocess.CalledProcessError):
                release.candidate_image("api")

    def test_no_execute_without_explicit_action(self):
        result = subprocess.run([sys.executable, str(HERE / "production_only_release_once.py"),
                                 "--run-dir", "/tmp/not-a-run"], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("required", result.stderr)

    def test_recovery_rolls_back_once_without_starting_test(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            fakebin = directory / "bin"
            fakebin.mkdir()
            run = directory / "run"
            run.mkdir()
            test_checkpoint = {name: {"id": "id-" + name, "image": "sha256:test"}
                               for name in TEST}
            config = directory / "safe-config"
            config.write_text("snapshot")
            prod_baseline = {name: {"id": "id-" + name,
                                    "image": "sha256:old" if name.endswith("-web-1") else "sha256:other"}
                             for name in PROD}
            (run / "production-only-plan.json").write_text(json.dumps(dict(
                service="web", old_image_id="sha256:old", test_checkpoint=test_checkpoint,
                production_baseline=prod_baseline,
                config_paths={"safe-config": str(config)},
                config_sha256={"safe-config": hashlib.sha256(b"snapshot").hexdigest()})))
            (run / "cutover-attempted").touch()
            (run / "published").touch()  # A late functional failure can still roll back once.
            (run / "old-web.yml").write_text("services: {}\n")
            state = directory / "state.json"
            state.write_text(json.dumps({"web_image": "sha256:new", "web_status": "running"}))
            log = directory / "docker.log"
            fake = fakebin / "docker"
            fake.write_text('''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
state=Path(os.environ['FAKE_DOCKER_STATE'])
data=json.loads(state.read_text())
args=sys.argv[1:]
with open(os.environ['FAKE_DOCKER_LOG'],'a') as out: out.write(' '.join(args)+'\\n')
if args[0]=='inspect':
    name=args[1]; fmt=args[3]
    if name=='holymedia-v2-web-1':
        if fmt=='{{.Image}}': value=data['web_image']
        elif fmt=='{{.State.Status}}': value=data['web_status']
        else: value='healthy'
    elif name.startswith('holymedia-v2-'):
        if fmt=='{{.Id}}': value='id-'+name
        elif fmt=='{{.Image}}': value='sha256:other'
        elif fmt=='{{if .State.Health}}{{.State.Health.Status}}{{end}}': value='healthy'
        else: value='unknown'
    elif fmt=='{{.Id}}': value='id-'+name
    elif fmt=='{{.Image}}': value='sha256:test'
    elif fmt=='{{.State.Status}}': value='exited'
    elif fmt=='{{.HostConfig.RestartPolicy.Name}}': value='no'
    else: value='unknown'
    print(value)
elif args[0]=='compose':
    data['web_image']='sha256:old'; data['web_status']='running'; state.write_text(json.dumps(data))
elif args[0]=='stop':
    data['web_status']='exited'; state.write_text(json.dumps(data))
''')
            fake.chmod(0o755)
            curl = fakebin / "curl"
            curl.write_text("#!/bin/sh\nexit 0\n")
            curl.chmod(0o755)
            env = {**os.environ, "PATH": str(fakebin) + os.pathsep + os.environ["PATH"],
                   "FAKE_DOCKER_STATE": str(state), "FAKE_DOCKER_LOG": str(log)}
            script = HERE / "holypilot_web_release_recover.sh"
            result = subprocess.run(["bash", str(script), str(run)], env=env,
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("ROLLBACK_VERIFIED; TEST_STILL_STOPPED", result.stdout)
            commands = log.read_text()
            self.assertIn("compose --env-file", commands)
            self.assertEqual(commands.count("compose --env-file"), 1)
            self.assertNotIn("start ", commands)
            self.assertIn("--pull never", commands)
            self.assertTrue((run / "rollback-attempted").exists())
            self.assertTrue((run / "rolled-back").exists())


if __name__ == "__main__":
    unittest.main()
