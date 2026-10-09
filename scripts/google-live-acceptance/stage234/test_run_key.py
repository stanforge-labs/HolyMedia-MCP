"""Pure stock key supervisor tests. Never Docker, auth, tokens or provider calls."""
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('stage234_key_supervisor',Path(__file__).with_name('run-key.py'))
runner=importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

class KeySupervisorTests(unittest.TestCase):
    def test_command_is_disposable_off_no_ports_and_only_minimum_mounts(self):
        args=runner.command('ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:'+'b'*64,'a'*40,Path('/safe/harness'),Path('/safe/stage234-key-20261009T120000Z'),Path('/safe/authority'))
        text=' '.join(args)
        for v in ['PROVIDER_GOOGLE_ADS_WRITE_ENABLED=false','PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED=false','PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED=false','PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED=false','V2_CONFIRMED_WRITE_ENABLED=false','PUBLIC_MCP_WRITE_SCOPE_ENABLED=false']:
            self.assertIn(v,text)
        self.assertIn(runner.base.NETWORK,text)
        self.assertEqual(args.count('-v'),3)
        for v in ['-p','--publish','--volumes-from','--restart']:self.assertNotIn(v,args)
        self.assertNotIn('/etc/holymedia-v2',text)
        self.assertNotIn(':/workspace',text)
        self.assertEqual(args[-1],'/stage234/provision-key.mjs')

    def test_explicit_permission_required_before_docker_even_check_only(self):
        with patch('sys.argv',['run-key.py','--head','a'*40,'--image','ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:'+'b'*64,'--utc-id','20261009T120000Z','--check-only']),patch.object(runner.base,'production_state') as calls:
            with self.assertRaisesRegex(RuntimeError,'explicit_authorization'):runner.main()
            calls.assert_not_called()

    def test_check_only_never_launches_or_creates_claims(self):
        with patch('sys.argv',['run-key.py','--head','a'*40,'--image','ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:'+'b'*64,'--utc-id','20261009T120000Z','--authorize-once-test-key','--check-only']),patch.object(runner.os,'geteuid',return_value=0,create=True),patch.object(runner.base,'production_state',return_value={'healthy':True}),patch.object(runner.base,'inspect_ready',return_value='hash'),patch.object(Path,'exists',return_value=False),patch.object(runner.subprocess,'run') as calls,patch.object(runner.os,'open') as write,patch('sys.stdout',new_callable=io.StringIO) as out:
            runner.main();calls.assert_not_called();write.assert_not_called()
            self.assertEqual(json.loads(out.getvalue())['real_writes'],0)

    def test_existing_once_claim_blocks_new_attempt(self):
        with patch('sys.argv',['run-key.py','--head','a'*40,'--image','ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:'+'b'*64,'--utc-id','20261009T120000Z','--authorize-once-test-key']),patch.object(runner.os,'geteuid',return_value=0,create=True),patch.object(runner.base,'production_state',return_value={'healthy':True}),patch.object(runner.base,'inspect_ready',return_value='hash'),patch.object(Path,'exists',return_value=True),patch.object(Path,'is_symlink',return_value=False),patch.object(Path,'is_dir',return_value=True),patch.object(runner.subprocess,'run') as calls:
            with self.assertRaisesRegex(RuntimeError,'no_second_key'):runner.main()
            calls.assert_not_called()

if __name__=='__main__':unittest.main()
