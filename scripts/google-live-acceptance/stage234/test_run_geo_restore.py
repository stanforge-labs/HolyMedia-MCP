import unittest
import importlib.util
from datetime import datetime, timezone, timedelta
from pathlib import Path
class GeoRestoreSupervisorTests(unittest.TestCase):
 def test_expired_renewal_binding_is_exact_and_never_reuses_pending_or_consumed(self):
  spec=importlib.util.spec_from_file_location('renewal',Path(__file__).with_name('run-geo-restore.py'))
  module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  now=datetime.now(timezone.utc)
  good={'id':'exact','account':'8590146099','operation':'GOOGLE_STAGE3_TARGETING','commit_status':'CONFIRMED','expires_at':(now-timedelta(seconds=1)).isoformat(),'immutable':True}
  module.assert_expired_restore(good,'exact',now)
  for change in [{'id':'other'},{'account':'4378327049'},{'consumed_at':'present'},{'attempted_at':'present'},{'cancelled_at':'present'},{'immutable':False},{'expires_at':(now+timedelta(minutes=1)).isoformat()},{'expires_at':'invalid'}]:
   with self.subTest(change=change),self.assertRaises(RuntimeError):
    module.assert_expired_restore({**good,**change},'exact',now)
 def test_exact_verified_parent_auth_and_no_pending_before_gateway_stop(self):
  s=Path(__file__).with_name('run-geo-restore.py').read_text()
  self.assertIn("PARENT='stage234-j-20261010T195000Z-jpreview1'",s)
  self.assertIn("['9196209','2527337173874']",s)
  self.assertLess(s.index("checked.get('valid')"),s.index("'docker','stop'"))
  self.assertIn("'J-preview'",s)
  self.assertIn('os.O_EXCL',s)
 def test_prepare_only_has_no_stop_port_or_preview_and_flags_closed(self):
  s=Path(__file__).with_name('run-geo-restore.py').read_text()
  self.assertIn('if not o.prepare_only:',s)
  self.assertIn("[] if o.prepare_only else ['-p'",s)
  self.assertIn("'V2_CONFIRMED_WRITE_ENABLED':'false'",s)
  self.assertIn("'PUBLIC_MCP_CONTROLLED_WRITE_ENABLED':'false'",s)
  self.assertIn("'STAGE234_J_RESTORE_GUARD_PRELOAD':'1'",s)
if __name__=='__main__':unittest.main()
