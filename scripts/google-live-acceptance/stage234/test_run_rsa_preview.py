"""Offline launcher regression. Never executes Docker, SSH, provider or login."""
import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location("l_preview", Path(__file__).with_name("run-rsa-preview.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
class LPreviewSupervisor(unittest.TestCase):
    def test_command_is_new_local_preview_only_state(self):
        cmd=module.command("ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:"+"b"*64,"a"*40,"20261010T120000Z-test",Path("/test"),Path("/state/stage234-l-20261010T120000Z-test"))
        text=" ".join(cmd)
        for required in ["127.0.0.1:4403:4001","STAGE234_GUARD_PRELOAD=0","STAGE234_L_GUARD_PRELOAD=1","PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED=false","PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED=true","V2_CONFIRMED_WRITE_ENABLED=false","V2_PREVIEW_ONLY=true","/stage234/rsa-preview-runner.mjs","/acceptance-state/stage234-l-20261010T120000Z-test"]:
            self.assertIn(required,text)
        for forbidden in ["--privileged","--network host","--volumes-from","restore-runner","commit-runner","--publish-all","/etc/holymedia-v2"]:
            self.assertNotIn(forbidden,text)
    def test_separate_manifest_contains_all_guard_imports(self):
        result=module.manifest("a"*40,Path(__file__).parent)
        self.assertEqual(result["purpose"],"L_PREVIEW_ONLY")
        for name in ["rsa-preview-guard.mjs","rsa-preview-runner.mjs","rsa-approval-gateway.mjs","scenario-preparation.mjs","live-guard.mjs","live-runner.mjs","context-vault.mjs"]:
            self.assertRegex(result["files"][name],r"^[a-f0-9]{64}$")
    def test_source_context_closed_no_plaintext_path(self):
        for name in ["../fixture-context.json","/etc/holymedia-v2/app.env","oauth-secret.json"]:
            with self.assertRaises(RuntimeError):module.base.context_source(name)
    def test_launcher_has_no_mutation_or_old_n_state_writes(self):
        text=Path(__file__).with_name("run-rsa-preview.py").read_text()
        self.assertNotIn("prepare_network()",text)
        self.assertNotIn("commit_preview",text)
        self.assertIn('state.mkdir(mode=0o700)',text)
        self.assertIn('os.O_CREAT|os.O_EXCL|os.O_WRONLY',text)
if __name__=="__main__":unittest.main()

