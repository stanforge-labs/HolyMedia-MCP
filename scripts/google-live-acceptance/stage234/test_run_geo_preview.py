import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('j_preview',Path(__file__).with_name('run-geo-preview.py'))
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class GeoSupervisorTests(unittest.TestCase):
    def parent(self):
        return {'Name':'/hm-'+mod.PARENT,'Config':{'Labels':{'com.docker.compose.project':mod.base.PROJECT,'org.holymedia.acceptance-purpose':'I-remove-preview'}},'State':{'Running':True},'NetworkSettings':{'Ports':{'4001/tcp':[{'HostIp':'127.0.0.1','HostPort':'4403'}]}}}
    def test_exact_consumed_disposable_gateway_identity_only(self):
        self.assertTrue(mod.disposable_parent_valid(self.parent()))
        for field in ['name','project','purpose','running','port','bind']:
            p=self.parent()
            if field=='name':p['Name']='/holymedia-v2-api'
            elif field=='project':p['Config']['Labels']['com.docker.compose.project']='holymedia-v2'
            elif field=='purpose':p['Config']['Labels']['org.holymedia.acceptance-purpose']='production'
            elif field=='running':p['State']['Running']=False
            elif field=='port':p['NetworkSettings']['Ports']['4001/tcp'][0]['HostPort']='4400'
            elif field=='bind':p['NetworkSettings']['Ports']['4001/tcp'][0]['HostIp']='0.0.0.0'
            self.assertFalse(mod.disposable_parent_valid(p))
    def test_no_stop_before_consumed_pending_and_auth_check_or_no_write_flags(self):
        src=Path(mod.__file__).read_text(encoding='utf-8')
        self.assertLess(src.index("checked.get('valid')"),src.index("'docker','stop'"))
        self.assertIn("'V2_CONFIRMED_WRITE_ENABLED':'false'",src)
        self.assertIn("'PUBLIC_MCP_CONTROLLED_WRITE_ENABLED':'false'",src)
        self.assertIn("'GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST':'8590146099'",src)
        self.assertIn("os.O_EXCL",src)
        self.assertNotIn('docker restart',src)

if __name__=='__main__':unittest.main()
