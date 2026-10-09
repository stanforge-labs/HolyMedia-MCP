"""Offline L continuation supervisor contract; no Docker or provider execution."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
spec=importlib.util.spec_from_file_location("l_commit",Path(__file__).with_name("run-rsa-commit.py"))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class LCommitSupervisor(unittest.TestCase):
    def options(self,dry=False):
        return SimpleNamespace(head=module.SOURCE,image=module.IMAGE,harness_head="b"*40,run_id="20261009T201000Z-test",authorize_exact_preview=module.EXACT,db_precheck=dry)
    def test_exact_authority_pins_only_existing_L(self):
        opts=self.options();module.validate_options(opts)
        for key,value in [("head","a"*40),("authorize_exact_preview","aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),("image","ghcr.io/stanforge-labs/holymedia-mcp-v2:latest"),("run_id","../old")]:
            bad=self.options();setattr(bad,key,value)
            with self.assertRaises(RuntimeError):module.validate_options(bad)
    def test_separate_private_container_no_original_port_mount_or_revalidate(self):
        opts=self.options();cmd=module.command(opts,Path("/harness"),Path("/state/stage234-l-commit-unique"))
        text=" ".join(cmd)
        for expected in ["STAGE234_L_GUARD_PRELOAD=0","STAGE234_L_COMMIT_GUARD_PRELOAD=0","STAGE234_EXPLICIT_COMMIT_AUTHORIZED=true","STAGE234_EXPECTED_L_PREVIEW="+module.EXACT,"PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED=false","PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED=true","V2_CONFIRMED_WRITE_ENABLED=true","V2_PREVIEW_ONLY=false","/stage234/rsa-commit-runner.mjs"]:
            self.assertIn(expected,text)
        for denied in ["-p ","--privileged","--volumes-from","--network host","restore-runner","/etc/holymedia-v2"]:
            self.assertNotIn(denied,text)
        self.assertIn("STAGE234_L_DB_PREFLIGHT_ONLY=true"," ".join(module.command(self.options(True),Path("/harness"),Path("/state/stage234-l-commit-dry"))))
    def test_dry_run_does_not_burn_parent_claim_and_existing_evidence_hashes_preserved(self):
        text=Path(__file__).with_name("run-rsa-commit.py").read_text()
        self.assertIn('if not opts.db_precheck:',text)
        self.assertIn('os.O_CREAT|os.O_EXCL|os.O_WRONLY',text)
        self.assertIn('l-commit-supervisor-launch.claim',text)
        self.assertIn('all(hashlib.sha256((original/name).read_bytes()).hexdigest()==value',text)
        self.assertEqual(module.PARENT,"stage234-l-20261009T195500Z-l1")
if __name__=="__main__":unittest.main()

