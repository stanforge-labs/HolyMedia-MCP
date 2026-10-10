import unittest
from pathlib import Path

class GeoCommitSupervisorTests(unittest.TestCase):
 def test_exact_parent_and_immutable_manifest_before_launch_claim(self):
  src=Path(__file__).with_name('run-geo-commit.py').read_text()
  self.assertIn("'stage234-j-'+o.preview_run_id",src)
  self.assertIn("'J-preview'",src)
  self.assertIn("'prepared-j-plan.json'",src)
  self.assertIn("'geo-proof.json'",src)
  self.assertLess(src.index("evidence.get('before_after_unchanged')"),src.index("j-commit-launch.claim"))
  self.assertIn('os.O_EXCL',src)
  self.assertIn("'STAGE234_J_GUARD_PRELOAD':'0'",src)
  self.assertIn("'STAGE234_J_COMMIT_GUARD_PRELOAD':'1'",src)
 def test_one_foreground_runner_no_restart_ports_or_retry(self):
  src=Path(__file__).with_name('run-geo-commit.py').read_text()
  self.assertIn("'/stage234/geo-commit-runner.mjs'",src)
  self.assertEqual(src.count('subprocess.run('),1)
  self.assertNotIn("'docker','stop'",src)
  self.assertNotIn("'-p'",src)
  self.assertIn("'PUBLIC_MCP_WRITE_SCOPE_ENABLED':'false'",src)
  self.assertIn("'PUBLIC_MCP_CONTROLLED_WRITE_ENABLED':'false'",src)

if __name__=='__main__':unittest.main()
