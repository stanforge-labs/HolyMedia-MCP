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
                    patch.object(release.legacy, "immediate", return_value={"disk_mib": 11704}), \
                    patch.object(release.legacy, "ensure_immediate_preflight"), \
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
        rows = observations[0]["containers"]
        release.verify_topology(rows, checkpoint)
        production_baseline = {name: rows[name].copy() for name in PROD}
        release.verify_topology(rows, checkpoint, production_baseline)
        incomplete_baseline = {name: rows[name].copy() for name in PROD[1:]}
        with self.assertRaisesRegex(RuntimeError, "container_baseline_incomplete"):
            release.verify_topology(rows, checkpoint, incomplete_baseline)
        production_baseline[PROD[0]]["image"] = "sha256:unexpected"
        with self.assertRaisesRegex(RuntimeError, "container_changed"):
            release.verify_topology(rows, checkpoint, production_baseline)
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

    def test_release_guard_requires_exact_duration_from_result(self):
        for exact, expected_pass in ((599.999737, False), (600.0, True)):
            with self.subTest(exact=exact), tempfile.TemporaryDirectory() as tmp:
                directory = Path(tmp)

                def completed(_args, **kwargs):
                    kwargs["stdout"].write(json.dumps({"status": "PASS", "duration_s": 600.0,
                                                       "duration_exact_s": exact}))
                    kwargs["stdout"].flush()
                    return type("Result", (), {"returncode": 0})()

                with patch.object(release.subprocess, "run", side_effect=completed):
                    if expected_pass:
                        self.assertEqual(release.guard(directory, directory / "checkpoint.json",
                                                       "precutover")["duration_exact_s"], exact)
                    else:
                        with self.assertRaisesRegex(RuntimeError, "precutover_guard_incomplete"):
                            release.guard(directory, directory / "checkpoint.json", "precutover")

    def test_phase_log_is_ordered_and_private(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            for phase in ("before-stop", "stopping-old", "old-stopped",
                          "starting-candidate", "candidate-running"):
                release.record_phase(directory, "web", phase)
            events = [json.loads(line) for line in
                      (directory / "release-phases.jsonl").read_text().splitlines()]
            self.assertEqual([event["phase"] for event in events],
                             ["before-stop", "stopping-old", "old-stopped",
                              "starting-candidate", "candidate-running"])
            self.assertEqual((directory / "release-phases.jsonl").stat().st_mode & 0o777, 0o600)
            self.assertTrue(all("monotonic" in event and "epoch" in event for event in events))
            with self.assertRaises(FileExistsError):
                release.record_phase(directory, "web", "stopping-old")

    def test_swap_fail_during_old_stop_blocks_candidate_and_rolls_back_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            plan = {"service": "web", "test_checkpoint": {}}
            (directory / "production-only-plan.json").write_text(json.dumps(plan))

            class Watcher:
                returncode = None

                def poll(self):
                    return None

                def terminate(self):
                    pass

                def wait(self, timeout=None):
                    return 0

            def arm(_directory):
                (directory / "startup-watch-unexecuted.py").write_text("# fake\n")
                (directory / "startup-watch.ready").touch()

            def stop(args, **_kwargs):
                self.assertEqual(args[:2], ["docker", "stop"])
                (directory / "startup-watch.fail").write_text("swap_in")

            with patch.object(release, "verify_plan"), \
                    patch.object(release, "guard"), \
                    patch.object(release.legacy, "immediate", return_value={}), \
                    patch.object(release.legacy, "ensure_immediate_preflight"), \
                    patch.object(release.legacy, "prepare_startup_watcher", side_effect=arm), \
                    patch.object(release.subprocess, "Popen", return_value=Watcher()), \
                    patch.object(release, "command", side_effect=stop), \
                    patch.object(release, "docker_state", return_value={
                        "holymedia-v2-web-1": {"status": "exited"}}), \
                    patch.object(release, "compose_replace") as compose, \
                    patch.object(release.subprocess, "run", return_value=type(
                        "Result", (), {"returncode": 0})()) as rollback:
                with self.assertRaisesRegex(RuntimeError, "startup_resource_fail_before_start"):
                    release.execute(directory)
            compose.assert_not_called()
            rollback.assert_called_once()
            self.assertTrue((directory / "web-phase.stopping-old").exists())
            self.assertTrue((directory / "web-phase.old-stopped").exists())
            self.assertFalse((directory / "web-phase.starting-candidate").exists())
            self.assertFalse((directory / "web-start.begin").exists())

    def test_phase_record_failure_blocks_stop_and_candidate(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "production-only-plan.json").write_text(json.dumps(
                {"service": "web", "test_checkpoint": {}}))

            class Watcher:
                returncode = None

                def poll(self):
                    return None

                def terminate(self):
                    pass

                def wait(self, timeout=None):
                    return 0

            def arm(_directory):
                (directory / "startup-watch-unexecuted.py").write_text("# fake\n")
                (directory / "startup-watch.ready").touch()

            with patch.object(release, "verify_plan"), \
                    patch.object(release, "guard"), \
                    patch.object(release.legacy, "immediate", return_value={}), \
                    patch.object(release.legacy, "ensure_immediate_preflight"), \
                    patch.object(release.legacy, "prepare_startup_watcher", side_effect=arm), \
                    patch.object(release.subprocess, "Popen", return_value=Watcher()), \
                    patch.object(release, "record_phase", side_effect=OSError("trace_unavailable")), \
                    patch.object(release, "command") as command, \
                    patch.object(release, "compose_replace") as compose, \
                    patch.object(release.subprocess, "run") as rollback:
                with self.assertRaisesRegex(OSError, "trace_unavailable"):
                    release.execute(directory)
            command.assert_not_called()
            compose.assert_not_called()
            rollback.assert_not_called()

    def test_candidate_start_is_marked_only_after_old_container_stops(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "production-only-plan.json").write_text(json.dumps({
                "service": "web", "test_checkpoint": {}, "new_image_id": "sha256:new"}))
            operations = []

            class Watcher:
                returncode = None

                def poll(self):
                    return None

                def terminate(self):
                    pass

                def wait(self, timeout=None):
                    return 0

            def arm(_directory):
                (directory / "startup-watch-unexecuted.py").write_text("# fake\n")
                (directory / "startup-watch.ready").touch()

            def stop(args, **_kwargs):
                operations.append("stop")
                self.assertEqual(args[:2], ["docker", "stop"])
                self.assertTrue((directory / "web-phase.stopping-old").exists())
                self.assertFalse((directory / "web-start.begin").exists())

            def start(_directory, _service, _variant):
                operations.append("start")
                self.assertTrue((directory / "web-phase.old-stopped").exists())
                self.assertTrue((directory / "web-start.begin").exists())

            with patch.object(release, "verify_plan", return_value={
                    "holymedia-v2-web-1": {"image": "sha256:new"}}), \
                    patch.object(release, "guard"), \
                    patch.object(release.legacy, "immediate", return_value={}), \
                    patch.object(release.legacy, "ensure_immediate_preflight"), \
                    patch.object(release.legacy, "prepare_startup_watcher", side_effect=arm), \
                    patch.object(release.subprocess, "Popen", return_value=Watcher()), \
                    patch.object(release, "command", side_effect=stop), \
                    patch.object(release, "docker_state", return_value={
                        "holymedia-v2-web-1": {"status": "exited"}}), \
                    patch.object(release, "compose_replace", side_effect=start), \
                    patch.object(release, "wait_healthy"), \
                    patch.object(release, "verify_web_functionality"), \
                    patch.object(release.subprocess, "run") as rollback:
                release.execute(directory)
            self.assertEqual(operations, ["stop", "start"])
            rollback.assert_not_called()
            phases = [json.loads(line)["phase"] for line in
                      (directory / "release-phases.jsonl").read_text().splitlines()]
            self.assertEqual(phases, ["before-stop", "stopping-old", "old-stopped",
                                      "starting-candidate", "candidate-running"])
            self.assertTrue((directory / "published").exists())

    def test_late_watchdog_fail_still_blocks_candidate_compose(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "production-only-plan.json").write_text(json.dumps(
                {"service": "web", "test_checkpoint": {}}))

            class Watcher:
                returncode = None

                def poll(self):
                    return None

                def terminate(self):
                    pass

                def wait(self, timeout=None):
                    return 0

            def arm(_directory):
                (directory / "startup-watch-unexecuted.py").write_text("# fake\n")
                (directory / "startup-watch.ready").touch()

            original_record_phase = release.record_phase

            def phase(run_dir, service, label):
                original_record_phase(run_dir, service, label)
                if label == "starting-candidate":
                    (directory / "startup-watch.fail").write_text("swap_in")

            with patch.object(release, "verify_plan"), \
                    patch.object(release, "guard"), \
                    patch.object(release.legacy, "immediate", return_value={}), \
                    patch.object(release.legacy, "ensure_immediate_preflight"), \
                    patch.object(release.legacy, "prepare_startup_watcher", side_effect=arm), \
                    patch.object(release.subprocess, "Popen", return_value=Watcher()), \
                    patch.object(release, "record_phase", side_effect=phase), \
                    patch.object(release, "command"), \
                    patch.object(release, "docker_state", return_value={
                        "holymedia-v2-web-1": {"status": "exited"}}), \
                    patch.object(release, "compose_replace") as compose, \
                    patch.object(release.subprocess, "run", return_value=type(
                        "Result", (), {"returncode": 0})()) as rollback:
                with self.assertRaisesRegex(RuntimeError,
                                            "startup_resource_fail_before_candidate_compose"):
                    release.execute(directory)
            compose.assert_not_called()
            rollback.assert_called_once()

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

            # The observed failure stopped the original Web before a candidate
            # existed. Current recovery must still restore it exactly once.
            (run / "rollback-attempted").unlink()
            (run / "rolled-back").unlink()
            (run / "web-phase.stopping-old").touch()
            state.write_text(json.dumps({"web_image": "sha256:old", "web_status": "exited"}))
            log.write_text("")
            before_candidate = subprocess.run(["bash", str(script), str(run)], env=env,
                                              capture_output=True, text=True)
            self.assertEqual(before_candidate.returncode, 0,
                             before_candidate.stdout + before_candidate.stderr)
            self.assertEqual(log.read_text().count("compose --env-file"), 1)
            self.assertNotIn("start ", log.read_text())
            self.assertTrue((run / "rolled-back").exists())


if __name__ == "__main__":
    unittest.main()
