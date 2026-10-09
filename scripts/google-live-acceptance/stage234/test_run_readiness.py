"""Pure readiness supervisor tests: no Docker, provider or credentials."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('targeting_readiness_supervisor',Path(__file__).with_name('run-readiness.py'))
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)

def options(**change):
    return SimpleNamespace(**dict(dict(head='a'*40,harness_head='c'*40,image='ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:'+'b'*64,run_id='20261009T120000Z-rdy',context_basename='stage234-scoped-context-20261009T120000Z.json',check_only=True),**change))

class ReadinessSupervisorTests(unittest.TestCase):
    def test_verified_l_is_exact_readonly_third_mount(self):
        args=runner.command(options(verified_l_context=runner.L_CONTEXT),Path('/safe/harness'),Path('/safe/state'));text=' '.join(args)
        self.assertEqual(args.count('-v'),3)
        self.assertIn('/verified-l/l-verified-evidence.json:ro',text)
        self.assertIn('STAGE234_VERIFIED_L=true',text)
        self.assertIn('PROVIDER_GOOGLE_ADS_WRITE_ENABLED=false',text)
        self.assertNotIn('-p',args)
        with patch.object(runner.base,'permissions') as check:
            with self.assertRaises(RuntimeError):runner.verified_l_source('../arbitrary.json')
            check.assert_not_called()
        self.assertIsNone(runner.verified_l_source(None))
    def test_discovery_is_opt_in_and_never_enables_writes(self):
        default=' '.join(runner.command(options(),Path('/safe/harness'),Path('/safe/state')))
        enabled=' '.join(runner.command(options(discovery=True),Path('/safe/harness'),Path('/safe/state')))
        self.assertNotIn('STAGE234_DISCOVERY=true',default)
        self.assertIn('STAGE234_DISCOVERY=true',enabled)
        self.assertIn('V2_CONFIRMED_WRITE_ENABLED=false',enabled)
        self.assertIn('PROVIDER_GOOGLE_ADS_WRITE_ENABLED=false',enabled)

    def test_only_disposable_network_two_mounts_no_ports_all_write_flags_off(self):
        args=runner.command(options(),Path('/safe/harness'),Path('/safe/state'));text=' '.join(args)
        self.assertIn(runner.base.NETWORK,text);self.assertEqual(args.count('-v'),2)
        self.assertIn('V2_CONFIRMED_WRITE_ENABLED=false',text)
        for stage in ['', '_STAGE2','_STAGE3','_STAGE4']:self.assertIn('PROVIDER_GOOGLE_ADS'+stage+'_WRITE_ENABLED=false',text)
        self.assertIn('GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST=8590146099',text)
        for value in ['-p','--publish','--volumes-from','--restart']:self.assertNotIn(value,args)
        self.assertNotIn('/etc/holymedia-v2',text);self.assertNotIn(':/workspace',text)
        self.assertEqual(args[-1],'/stage234/targeting-readiness-runner.mjs')

    def test_invalid_source_or_arbitrary_context_stops_before_docker(self):
        for change in [dict(head='main'),dict(image='latest'),dict(harness_head='latest'),dict(context_basename='../secret'),dict(context_basename='fixture-context.json')]:
            with patch.object(runner.base,'production_state') as calls:
                with self.assertRaises(RuntimeError):runner.execute(options(**change))
                calls.assert_not_called()

    def test_source_contains_no_key_issuance_preview_commit_or_auth_transport(self):
        source=Path(runner.__file__).read_text()
        for value in ['provision-key.mjs','commit-runner.mjs','live-runner.mjs','issued-once.claim','/api/v1/auth/']:self.assertNotIn(value,source)

    def test_static_status_does_not_match_provider_credential_family(self):
        import re
        source=Path(runner.__file__).read_text()
        historical_static_status='R'+'EADINESS_RUNTIME_'+'CHECK_ONLY_PASS'
        self.assertIsNotNone(re.search(r'EA[A-Za-z0-9_-]{30,}',historical_static_status))
        self.assertIsNone(re.search(r'EA[A-Za-z0-9_-]{30,}',source))

if __name__=='__main__':unittest.main()
