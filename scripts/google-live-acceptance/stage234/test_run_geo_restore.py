import unittest
from pathlib import Path
class GeoRestoreSupervisorTests(unittest.TestCase):
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
