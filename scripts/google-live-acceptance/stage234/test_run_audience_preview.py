import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location("audience_preview",Path(__file__).with_name("run-audience-preview.py"))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class IPreviewLauncher(unittest.TestCase):
 def test_new_scoped_preview_container_and_exact_candidate(self):
  text=" ".join(m.command("ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:"+"a"*64,"b"*40,"20261009T204000Z-i1",Path("/harness"),Path("/state/stage234-i-unique"),"c"*64,"d"*40,"AFFINITY","90100","e"*40))
  for required in ["STAGE234_I_CANDIDATE_ID=90100","STAGE234_I_CANDIDATE_KEY=AFFINITY","STAGE234_I_GUARD_PRELOAD=1","PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED=true","PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED=false","V2_CONFIRMED_WRITE_ENABLED=false","/stage234/audience-preview-runner.mjs","127.0.0.1:4403:4001"]:self.assertIn(required,text)
  for denied in ["--privileged","--network host","--volumes-from","commit-runner","restore-runner","/etc/holymedia-v2"]:self.assertNotIn(denied,text)
 def test_manifest_contains_transitive_immutable_readiness_proof(self):
  manifest=m.manifest("b"*40,Path(__file__).parent)
  for name in ["verified-l-residual.mjs","targeting-readiness-runner.mjs","audience-preview-guard.mjs","scenario-targeting-readiness.mjs"]:self.assertRegex(manifest["files"][name],r"^[a-f0-9]{64}$")
  self.assertEqual(manifest["purpose"],"I_PREVIEW_ONLY")
 def test_no_auth_create_no_oldL_state_edit_or_commit(self):
  src=Path(__file__).with_name("run-audience-preview.py").read_text()
  self.assertIn('state.mkdir(mode=0o700)',src)
  self.assertIn('os.O_CREAT|os.O_EXCL|os.O_WRONLY',src)
  self.assertIn('hashlib.sha256(readiness.read_bytes()).hexdigest()==options.readiness_sha256',src)
  for denied in ["prepare_network()","commit_preview","l-commit-supervisor-launch.claim","provision-key"]:self.assertNotIn(denied,src)
if __name__=="__main__":unittest.main()

