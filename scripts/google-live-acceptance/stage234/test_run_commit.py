"""Supervisor pure/mocked tests: never Docker, provider, credential or real authorization."""
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('stage234_n_commit_supervisor', Path(__file__).with_name('run-commit.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

UUID = '16224a43-2389-4062-9ffb-766a9abaf1d3'
NOW = datetime.now(timezone.utc)


def options(**change):
    values = dict(head='a' * 40, harness_head='c' * 40,
                  image='ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:' + 'b' * 64,
                  run_id='20261009T120000Z-test', authorize_exact_preview=UUID, check_only=True)
    return SimpleNamespace(**dict(values, **change))


def context_evidence():
    before = {'resourceName': 'customers/8590146099/adGroups/206587491811', 'cpcBidMicros': '100000', 'status': 'PAUSED', 'name': 'Acceptance Group'}
    context = {'service_token': 'synthetic-secret-not-a-credential', 'preview': {
        'preview_id': UUID, 'preview_token': 'synthetic-opaque-not-a-token', 'provider': 'GOOGLE_ADS', 'account_id': '8590146099',
        'provider_validation': 'passed', 'operation_count': 1, 'expires_at': (NOW + timedelta(minutes=10)).isoformat(),
        'items': [{'campaign_id': '24324170853', 'ad_group_id': '206587491811', 'before': before, 'after': dict(before, cpcBidMicros='110000')}]}}
    evidence = {'preview_id': UUID, 'source_head': 'a' * 40, 'image_digest': 'sha256:' + 'b' * 64, 'persisted_preview_immutable': True,
                'before_after_unchanged': True, 'committed': False, 'real_provider_write_call_count': 0, 'provider_validation': 'passed'}
    return context, evidence


class CommitSupervisorTests(unittest.TestCase):
    def test_explicit_uuid_required_even_check_only(self):
        runner.validate_options(options())
        for value in [None, '', 'yes', UUID.upper(), '0000']:
            with self.assertRaises(RuntimeError):
                runner.validate_options(options(authorize_exact_preview=value))
        for change in [dict(image='production'), dict(image='latest'), dict(head='main'), dict(harness_head='latest'), dict(run_id='../state')]:
            with self.assertRaises(RuntimeError):
                runner.validate_options(options(**change))

    def test_matching_exact_context_source_digest_and_semantics(self):
        context, evidence = context_evidence()
        runner.assert_authorization(options(), context, evidence, NOW)
        for change in [lambda c, e: c['preview'].update(preview_id='00000000-0000-0000-0000-000000000000'),
                       lambda c, e: e.update(source_head='d' * 40), lambda c, e: e.update(image_digest='sha256:' + 'e' * 64),
                       lambda c, e: e.update(before_after_unchanged=False), lambda c, e: e.update(committed=True),
                       lambda c, e: e.update(real_provider_write_call_count=1), lambda c, e: c['preview'].update(account_id='4378327049'),
                       lambda c, e: c['preview']['items'][0]['after'].update(status='ENABLED'),
                       lambda c, e: c['preview']['items'][0]['after'].update(cpcBidMicros='110001')]:
            c, e = copy.deepcopy(context), copy.deepcopy(evidence)
            change(c, e)
            with self.assertRaises(RuntimeError):
                runner.assert_authorization(options(), c, e, NOW)

    def test_expired_missing_and_naive_expiry_rejected(self):
        context, evidence = context_evidence()
        for expiry in [(NOW - timedelta(seconds=1)).isoformat(), NOW.replace(tzinfo=None).isoformat(), 'invalid', None]:
            context['preview']['expires_at'] = expiry
            with self.assertRaises(RuntimeError):
                runner.assert_authorization(options(), context, evidence, NOW)

    def test_protected_files_require_uid1000_private_mode_and_no_symlink(self):
        path = unittest.mock.Mock()
        path.is_symlink.return_value = False
        path.is_file.return_value = True
        path.stat.return_value = SimpleNamespace(st_uid=1000, st_mode=0o100600)
        runner.protected(path)
        for uid, mode, symlink in [(0, 0o100600, False), (1000, 0o100644, False), (1000, 0o100600, True)]:
            path.stat.return_value = SimpleNamespace(st_uid=uid, st_mode=mode)
            path.is_symlink.return_value = symlink
            with self.assertRaises(RuntimeError):
                runner.protected(path)

    def test_manifest_checks_exact_files_complete_bytes_and_pinned_harness(self):
        with TemporaryDirectory() as temp:
            directory = Path(temp)
            for name in runner.FILES:
                (directory / name).write_bytes(b'// synthetic MOCK source\n')
            manifest = {'head': 'c' * 40, 'files': {name: hashlib.sha256((directory / name).read_bytes()).hexdigest() for name in runner.FILES}}
            runner.verify_manifest(manifest, 'c' * 40, directory)
            wrong = copy.deepcopy(manifest)
            wrong['head'] = 'd' * 40
            with self.assertRaises(RuntimeError):
                runner.verify_manifest(wrong, 'c' * 40, directory)
            (directory / 'commit-guard.mjs').write_bytes(b'// changed\n')
            with self.assertRaises(RuntimeError):
                runner.verify_manifest(manifest, 'c' * 40, directory)

    def test_command_no_ports_gateway_product_mounts_or_production(self):
        o = options()
        args = runner.command(o, Path('/safe/harness'), Path('/opt/holymedia-google-acceptance/state/stage234-' + o.run_id))
        text = ' '.join(args)
        self.assertIn('holymedia-google-acceptance_stage234', text)
        self.assertIn('STAGE234_EXPLICIT_COMMIT_AUTHORIZED=true', text)
        self.assertIn('V2_PREVIEW_ONLY=false', text)
        self.assertIn('V2_CONFIRMED_WRITE_ENABLED=true', text)
        self.assertIn('STAGE234_GUARD_PRELOAD=0', text)
        self.assertIn('PUBLIC_MCP_WRITE_SCOPE_ENABLED=false', text)
        self.assertIn('PUBLIC_MCP_CONTROLLED_WRITE_ENABLED=false', text)
        self.assertIn('PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED=false', text)
        self.assertIn('PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED=false', text)
        self.assertIn('STAGE234_APPROVAL_GATEWAY=false', text)
        self.assertIn('hm-stage234-n-commit-' + o.run_id, text)
        self.assertEqual(args[-1], '/stage234/commit-runner.mjs')
        for forbidden in ['-p', '--publish', '--network=host', '--volumes-from', '--restart']:
            self.assertNotIn(forbidden, args)
        self.assertNotIn('/etc/holymedia-v2', text)
        self.assertNotIn(':/workspace', text)
        self.assertNotIn('/acceptance:ro', text)
        self.assertEqual(args.count('-v'), 2)

    def test_check_only_never_launches_or_writes_claims_and_keeps_gateway(self):
        with patch.object(runner.os, 'geteuid', return_value=0, create=True), \
                patch.object(runner.preview_supervisor, 'production_state', return_value={'healthy': True}), \
                patch.object(runner, 'gateway_state', return_value=['same', 'image', 'start', 0]) as gateway, \
                patch.object(runner.preview_supervisor, 'inspect_ready', return_value='safehash'), \
                patch.object(runner, 'inspect_state', return_value=(Path('/synthetic'), {}, 'safehash')), \
                patch.object(runner.subprocess, 'run') as launch, patch.object(runner.os, 'open') as opened, \
                patch('sys.stdout', new_callable=io.StringIO) as output:
            runner.execute(options())
            launch.assert_not_called()
            opened.assert_not_called()
            self.assertEqual(gateway.call_count, 2)
            self.assertEqual(json.loads(output.getvalue())['real_writes'], 0)

    def test_no_authorization_stops_before_any_docker_call(self):
        with patch.object(runner.preview_supervisor, 'production_state') as production, patch.object(runner.subprocess, 'run') as launch:
            with self.assertRaises(RuntimeError):
                runner.execute(options(authorize_exact_preview=None))
            production.assert_not_called()
            launch.assert_not_called()

    def test_mock_runner_failure_emits_one_safe_report_retains_claim_and_never_retries(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            state = root / 'state' / ('stage234-' + options().run_id)
            state.mkdir(parents=True)
            (root / 'acceptance.env').write_bytes(b'A=synthetic\n')
            (state / 'runtime.env').write_bytes(b'A=synthetic\n')
            env_hash = hashlib.sha256(b'A=synthetic\n').hexdigest()
            blocked = {'result': 'BLOCKED', 'code': 'stage234_commit_stock_mcp_rejected_no_retry', 'real_writes': 0}
            with patch.object(runner, 'ROOT', root), patch.object(runner.os, 'geteuid', return_value=0, create=True), \
                    patch.object(runner.os, 'chown', create=True), \
                    patch.object(runner.preview_supervisor, 'production_state', return_value={'healthy': True}), \
                    patch.object(runner, 'gateway_state', return_value=['same', 'image', 'start', 0]), \
                    patch.object(runner.preview_supervisor, 'inspect_ready', return_value=env_hash), \
                    patch.object(runner, 'inspect_state', return_value=(state, {'A': 'synthetic'}, env_hash)), \
                    patch.object(runner.subprocess, 'run', return_value=SimpleNamespace(stdout=json.dumps(blocked), returncode=1)) as launch, \
                    patch('sys.stdout', new_callable=io.StringIO) as output:
                with self.assertRaises(SystemExit):
                    runner.execute(options(check_only=False))
                self.assertEqual(json.loads(output.getvalue()), blocked)
                self.assertTrue((state / 'n-supervisor-launch.claim').is_file())
                self.assertTrue((state / 'commit.runtime.env').is_file())
                # Even if a caller incorrectly repeats the entry point, O_EXCL
                # retains the claim and prevents a second Docker launch.
                with self.assertRaises(FileExistsError):
                    runner.execute(options(check_only=False))
                self.assertEqual(launch.call_count, 1)

    def test_safe_report_never_prints_protected_values_or_nonce_url(self):
        self.assertEqual(runner.safe_report({'result': 'BLOCKED', 'code': 'safe', 'real_writes': 0,
                                            'service_token': 'synthetic', 'preview_token': 'synthetic', 'approval_url': 'synthetic', 'stderr': 'synthetic'}),
                         {'result': 'BLOCKED', 'code': 'safe', 'real_writes': 0})

    def test_existing_quote_parser_is_reused(self):
        self.assertEqual(runner.preview_supervisor.docker_env_values("A='one'\nB=\"two\"\nC=value$literal\n"), {'A': 'one', 'B': 'two', 'C': 'value$literal'})


if __name__ == '__main__':
    unittest.main()
