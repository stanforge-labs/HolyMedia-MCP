"""Exports only explicitly sanitized evidence files, never protected contexts."""
import json,os,shutil
from pathlib import Path
root=Path('/opt/holymedia-google-acceptance/state')
dest=Path('/home/ubuntu/holymedia-google-acceptance-harness/W-continuation-20261009')
for name in ['acceptance-stage0-W-continuation-20261009-commit-evidence.json','acceptance-stage0-W-continuation-20261009-diagnosis-evidence.json','acceptance-stage0-W-continuation-rerun-20261009-commit-evidence.json','acceptance-stage0-W-continuation-rerun-20261009-restorepreview-evidence.json','acceptance-stage0-W-restore-commit-20261009-commit-evidence.json']:
 p=root/name;data=json.loads(p.read_text())
 def check(v):
  if isinstance(v,dict):
   for k,x in v.items():
    if any(s in k.lower() for s in ['access_token','refresh_token','preview_token','client_secret','encryptedpayload','authorization','cookie','encryption_key']):raise RuntimeError('unsafe_evidence_key')
    check(x)
  elif isinstance(v,list):
   for x in v:check(x)
 check(data);shutil.copyfile(p,dest/name);os.chmod(dest/name,0o644)
print('SANITIZED_EVIDENCE_EXPORTED')
