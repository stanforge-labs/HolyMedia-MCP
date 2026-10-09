"""Offline H launch boundaries; no Docker or provider."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
spec=importlib.util.spec_from_file_location('h_launch',Path(__file__).with_name('run-h-warning.py'))
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)

class HSupervisorTests(unittest.TestCase):
    def test_one_off_preview_only_no_ports_or_api(self):
        opts=SimpleNamespace(head='a'*40,harness_head='b'*40,image='image@sha256:'+'c'*64,run_id='test')
        args=runner.command(opts,Path('/code'),Path('/state'));text=' '.join(args)
        self.assertEqual(args[-1],'/stage234/h-warning-only.mjs')
        self.assertEqual(args[-2],opts.image)
        self.assertIn('STAGE234_H_WARNING_ONLY_AUTHORIZED=true',text)
        self.assertIn('V2_CONFIRMED_WRITE_ENABLED=false',text)
        self.assertIn('PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED=true',text)
        self.assertIn('GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST=8590146099',text)
        for value in ['-p','--privileged','--restart','--volumes-from']:self.assertNotIn(value,args)
        for stage in ['STAGE3','STAGE4']:self.assertIn('PROVIDER_GOOGLE_ADS_'+stage+'_WRITE_ENABLED=false',text)

    def test_manifest_pins_stock_diagnostic_dependencies(self):
        result=runner.manifest(Path(__file__).parent)
        for name in ['h-warning-only.mjs','context-vault.mjs','live-guard.mjs','targeting-readiness-runner.mjs','targeting-discovery.mjs']:
            self.assertRegex(result[name],r'^[a-f0-9]{64}$')

if __name__=='__main__':unittest.main()
