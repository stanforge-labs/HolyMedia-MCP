"""One-off READ-only process; running acceptance/production containers remain unchanged."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT=Path('/opt/holymedia-google-acceptance')
UPLOAD=Path('/home/ubuntu/holymedia-google-acceptance-harness')
FIX='4cead41ea4e430dc00698cee29511425ffb20661'
def verify():
    checked=subprocess.run(['python3',str(UPLOAD/'provision.py'),'verify'],capture_output=True,text=True)
    if checked.returncode: raise RuntimeError('production_or_acceptance_baseline_changed')
try:
    if os.geteuid()!=0: raise RuntimeError('sudo_required')
    verify()
    verifier=UPLOAD/'google-ads-stage0-budget-fixed.js'
    digest=hashlib.sha256(verifier.read_bytes()).hexdigest()
    if len(sys.argv)!=2 or digest!=sys.argv[1]: raise RuntimeError('product_artifact_hash_mismatch')
    for name in ['reconcile-read-guard.mjs','reconcile-fixture.mjs','google-ads-stage0-budget-fixed.js']:
        target=ROOT/'harness'/name
        if target.exists() and target.read_bytes()!=(UPLOAD/name).read_bytes(): raise RuntimeError('reconciliation_harness_collision')
        shutil.copyfile(UPLOAD/name,target)
        os.chown(target,0,0)
        os.chmod(target,0o644)
    command=['docker','compose','-p','holymedia-google-acceptance','--env-file',str(ROOT/'acceptance.env'),'-f',str(ROOT/'compose.yml'),'run','-T','--rm','--no-deps','--entrypoint','node','-e','PROVIDER_GOOGLE_ADS_WRITE_ENABLED=false','-e','GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST=','-v',str(ROOT/'harness/google-ads-stage0-budget-fixed.js')+':/workspace/apps/api/dist/providers/google-ads-stage0.js:ro','api','/acceptance/reconcile-fixture.mjs',FIX,digest]
    completed=subprocess.run(command,capture_output=True,text=True,timeout=180)
    verify()
    # Application script emits safe report JSON only; never print docker stderr/env.
    import json
    report=json.loads(completed.stdout.strip())
    print(json.dumps(report))
    print('PRODUCTION_UNCHANGED_HEALTHY; ACCEPTANCE_API_UNCHANGED_HEALTHY; ONE_OFF_READ_ONLY_PROCESS_REMOVED')
    if completed.returncode: raise SystemExit(1)
except Exception as error:
    print(str(error) if isinstance(error,RuntimeError) else 'budget_reconciliation_runner_failed')
    raise SystemExit(1)
