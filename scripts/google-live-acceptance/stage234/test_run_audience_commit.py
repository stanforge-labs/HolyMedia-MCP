"""Offline I supervisor checks, never Docker or Google."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
spec=importlib.util.spec_from_file_location("i_commit",Path(__file__).with_name("run-audience-commit.py"))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class ICommitSupervisor(unittest.TestCase):
    def options(self,dry=False):
        return SimpleNamespace(head=module.SOURCE,image=module.IMAGE,harness_head="b"*40,preview_harness_head="c"*40,run_id="20261009T205500Z-i1",preview_run_id="20261009T205000Z-i1",authorize_exact_preview="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",db_precheck=dry)
    def test_exact_source_image_and_dynamic_preview_authority(self):
        module.validate_options(self.options())
        for key,value in [("head","a"*40),("image","latest"),("authorize_exact_preview","bad"),("run_id","../old")]:
            opts=self.options();setattr(opts,key,value)
            with self.assertRaises(RuntimeError):module.validate_options(opts)
        opts=self.options();opts.preview_run_id="../old"
        with self.assertRaises(RuntimeError):module.parent_name(opts)
    def test_private_oneoff_only_stage3_and_no_parent_mount_or_ports(self):
        text=" ".join(module.command(self.options(True),Path("/harness"),Path("/state/stage234-i-commit-new")))
        for expected in ["PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED=true","PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED=false","STAGE234_I_DB_PREFLIGHT_ONLY=true","STAGE234_I_GUARD_PRELOAD=0","STAGE234_HARNESS_HEAD="+"b"*40,"/stage234/audience-commit-runner.mjs"]:self.assertIn(expected,text)
        for denied in ["-p ","--privileged","--network host","--volumes-from","restore-runner","/etc/holymedia-v2"]:self.assertNotIn(denied,text)
    def test_no_automatic_restore_and_preserve_claim_original_files_gateway(self):
        text=Path(__file__).with_name("run-audience-commit.py").read_text()
        for required in ["if not opts.db_precheck:","os.O_CREAT|os.O_EXCL|os.O_WRONLY","i-commit-supervisor-launch.claim","gateway_state(opts)==gateway","prepared-i-plan.json","preview_harness_head"]:self.assertIn(required,text)
        self.assertNotIn("unlink(",text)
if __name__=="__main__":unittest.main()
