import unittest
from pathlib import Path
class RestoreCommitSupervisorTests(unittest.TestCase):
 def test_closed_exact_parent_and_one_shot_no_gateway_restart(self):
  s=Path(__file__).with_name('run-geo-restore-commit.py').read_text()
  for text in ["'stage234-j-restore-'+o.preview_run_id","'J-restore-preview'","prepared-j-restore-plan.json","j-origin.json","j-restore-commit-launch.claim","os.O_EXCL","geo-restore-commit-runner.mjs"]:
   self.assertIn(text,s)
  self.assertNotIn("'docker','stop'",s)
  self.assertNotIn("'127.0.0.1:4403:4001'",s)
  self.assertIn("'STAGE234_J_RESTORE_COMMIT_GUARD_PRELOAD':'1'",s)
  self.assertIn("'STAGE234_J_COMMIT_GUARD_PRELOAD':'0'",s)
  self.assertIn("'PUBLIC_MCP_CONTROLLED_WRITE_ENABLED':'false'",s)
  self.assertIn("if not o.prepare_only:",s)
  self.assertIn("'STAGE234_J_RESTORE_STARTUP_ONLY='+('true' if o.prepare_only else 'false')",s)
if __name__=='__main__':unittest.main()
