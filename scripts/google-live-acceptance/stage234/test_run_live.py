"""Pure launcher tests: no Docker, SSH, provider request or credential files."""
import importlib.util
from pathlib import Path
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import patch
import hashlib
import json
from unittest.mock import patch
import hashlib

spec = importlib.util.spec_from_file_location('stage234_run_live', Path(__file__).with_name('run-live.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class LauncherTests(unittest.TestCase):
    def test_n_only_reuse_options_are_paired_and_command_keeps_write_off(self):
        self.assertIsNone(runner.prior_k_source(None, None))
        for source, sha in [(None, 'a' * 64), ('../acceptance-K-evidence.json', 'a' * 64), ('stage234-20261009T120000Z-test/acceptance-K-evidence.json', None)]:
            with self.assertRaises(RuntimeError): runner.prior_k_source(source, sha)
        args = runner.command('ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:' + 'b' * 64, 'a' * 40, '20261009T120000Z-test', Path('/safe'), prior_k={'source': 'stage234-20261009T120000Z-old/acceptance-K-evidence.json', 'sha256': 'c' * 64})
        self.assertIn('STAGE234_REUSE_K_EVIDENCE_SOURCE=stage234-20261009T120000Z-old/acceptance-K-evidence.json', args)
        self.assertIn('STAGE234_REUSE_K_EVIDENCE_SHA256=' + 'c' * 64, args)
        self.assertIn('V2_CONFIRMED_WRITE_ENABLED=false', args)
        self.assertIn('V2_PREVIEW_ONLY=true', args)

    def test_prior_k_bytes_are_hashed_bound_to_test_identity_and_returned_without_rewriting(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            file = root / 'state/stage234-20261009T120000Z-old/acceptance-K-evidence.json'
            file.parent.mkdir(parents=True)
            prior = {'acceptance_test': 'K', 'result': 'PASS', 'test_customer_id': '8590146099', 'source_head': 'a' * 40,
                     'runtime': 'stock_private_HTTP_MCP_exact_immutable_image', 'invalid_headline_length': 31,
                     'rejection': {'code': 'google_brief_invalid', 'source': 'HOLYMEDIA', 'field_path': 'brief.items[0].rsa.headlines[0].text'},
                     'provider_read_call_count': 0, 'validate_only_call_count': 0, 'real_provider_write_call_count': 0,
                     'preview_created': False, 'production_changed': False, 'main_changed': False, 'timestamp': '2026-10-09T12:00:00Z'}
            raw = json.dumps(prior).encode()
            file.write_bytes(raw)
            sha = hashlib.sha256(raw).hexdigest()
            with patch.object(runner, 'ROOT', root), patch.object(runner, 'permissions'):
                reused = runner.prior_k_source('stage234-20261009T120000Z-old/acceptance-K-evidence.json', sha)
                self.assertEqual(reused['bytes'], raw)
                self.assertEqual(file.read_bytes(), raw)
                with self.assertRaises(RuntimeError): runner.prior_k_source(reused['source'], 'b' * 64)
                prior['test_customer_id'] = '4378327049'
                raw = json.dumps(prior).encode()
                file.write_bytes(raw)
                with self.assertRaises(RuntimeError): runner.prior_k_source(reused['source'], hashlib.sha256(raw).hexdigest())
    def test_context_selection_never_overwrites_or_reads_arbitrary_credentials(self):
        self.assertEqual(runner.context_source('fixture-context.json'), runner.ROOT / 'state/fixture-context.json')
        self.assertEqual(runner.context_source('stage234-scoped-context-20261009T120000Z.json'), runner.ROOT / 'state/stage234-scoped-context-20261009T120000Z.json')
        for name in ['../acceptance.env', '/etc/holymedia-v2/app.env', 'runtime.env', 'latest.json', 'stage234-scoped-context-x.json']:
            with self.assertRaises(RuntimeError): runner.context_source(name)

    def test_new_runtime_copy_and_manifest_are_delegated_only_to_exact_node_owner(self):
        source = Path(runner.__file__).read_text()
        self.assertIn('os.chown(runtime_env, 1000, 1000)', source)
        self.assertIn('os.chown(harness_manifest, 1000, 1000)', source)
        self.assertNotIn('chown -R', source)
        self.assertLess(source.index('os.chown(runtime_env, 1000, 1000)'), source.index('args = command(options.image'))

    def test_harness_manifest_is_closed_and_pins_actual_guard_bytes(self):
        with patch.object(Path, 'is_file', return_value=True), patch.object(Path, 'is_symlink', return_value=False), patch.object(Path, 'read_bytes', return_value=b'synthetic-guard-source'):
            manifest = runner.build_harness_manifest('a' * 40, Path('/synthetic'))
            self.assertEqual(set(manifest), {'head', 'files'})
            self.assertEqual(set(manifest['files']), {'commit-guard.mjs', 'commit-runner.mjs', 'live-guard.mjs', 'live-runner.mjs', 'context-vault.mjs', 'wait-local-ready.mjs', 'startup-diagnostics.mjs'})
            self.assertTrue(all(value == hashlib.sha256(b'synthetic-guard-source').hexdigest() for value in manifest['files'].values()))
        with patch.object(Path, 'is_file', return_value=True), patch.object(Path, 'is_symlink', return_value=True):
            with self.assertRaises(RuntimeError): runner.build_harness_manifest('a' * 40, Path('/synthetic'))
        with self.assertRaises(RuntimeError): runner.build_harness_manifest('latest', Path('/synthetic'))

    def test_immutable_digest_and_source_required(self):
        runner.validate_options('a' * 40, 'ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:' + 'b' * 64, '20261009T120000Z-test')
        for image in ['production', 'latest', 'ghcr.io/stanforge-labs/holymedia-mcp-v2:latest']:
            with self.assertRaises(RuntimeError):
                runner.validate_options('a' * 40, image, '20261009T120000Z-test')

    def test_no_product_bind_or_foreign_network_ports(self):
        args = runner.command('ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:' + 'b' * 64, 'a' * 40, '20261009T120000Z-test', Path('/opt/holymedia-google-acceptance/harness/stage234'), True)
        text = ' '.join(args)
        self.assertIn('holymedia-google-acceptance_stage234', text)
        self.assertIn('127.0.0.1:4402:4001', text)
        self.assertNotIn('/workspace/apps/api/dist:', text)
        self.assertNotIn('--volumes-from', text)
        self.assertNotIn('/etc/holymedia-v2', text)
        self.assertIn('V2_CONFIRMED_WRITE_ENABLED=false', text)
        self.assertIn('PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED=true', text)
        self.assertIn('PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED=false', text)
        self.assertIn('STAGE234_APPROVAL_GATEWAY=true', text)
        self.assertIn(str(runner.ROOT / 'harness') + ':/acceptance:ro', text)
        self.assertNotIn(str(runner.ROOT / 'state') + ':/acceptance-state', text)
        self.assertIn('stage234-20261009T120000Z-test:/acceptance-state/stage234-20261009T120000Z-test', text)

    def test_docker_env_does_not_keep_compose_quotes(self):
        self.assertEqual(runner.docker_env_values("A='one'\nB=\"two\"\nC=value$literal\n"), {'A': 'one', 'B': 'two', 'C': 'value$literal'})
        with self.assertRaises(RuntimeError):
            runner.docker_env_values('A=one\nA=two')

    def test_report_drops_protected_context_and_approval_nonce(self):
        self.assertEqual(runner.safe_report({'result': 'PASS', 'preview_id': 'safe', 'service_token': 'synthetic', 'approval_url': 'synthetic', 'real_writes': 0}), {'result': 'PASS', 'preview_id': 'safe', 'real_writes': 0})

    def test_secondary_network_dependency_proof_does_not_accept_other_project_or_volumes(self):
        import copy
        good = {'Name': '/holymedia-google-acceptance-postgres-1',
                'Config': {'Labels': {'com.docker.compose.project': runner.PROJECT, 'com.docker.compose.service': 'postgres'}},
                'State': {'Running': True, 'Health': {'Status': 'healthy'}},
                'Mounts': [{'Type': 'volume', 'Name': 'holymedia-google-acceptance_pgdata'}]}
        runner.assert_dependency(good, 'postgres')
        for key in ['project', 'volume', 'health']:
            bad = copy.deepcopy(good)
            if key == 'project': bad['Config']['Labels']['com.docker.compose.project'] = 'holymedia-v2'
            if key == 'volume': bad['Mounts'][0]['Name'] = 'holymedia-v2_pgdata'
            if key == 'health': bad['State']['Health']['Status'] = 'unhealthy'
            with self.assertRaises(RuntimeError): runner.assert_dependency(bad, 'postgres')


if __name__ == '__main__':
    unittest.main()
