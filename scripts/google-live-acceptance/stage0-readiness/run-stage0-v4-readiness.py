"""Isolated, hash-pinned, at-most-once restoration workflow; no approvals."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT=Path('/opt/holymedia-google-acceptance')
UPLOAD=Path('/home/ubuntu/holymedia-google-acceptance-harness')
def verify():
    result=subprocess.run(['python3',str(UPLOAD/'provision.py'),'verify'],capture_output=True,text=True)
    if result.returncode: raise RuntimeError('production_or_acceptance_baseline_changed')
def identity():
    result=subprocess.run(['docker','inspect','holymedia-google-acceptance-api-1'],capture_output=True,text=True,check=True)
    item=json.loads(result.stdout)[0]
    return [item['Id'],item['Image'],item['State']['StartedAt'],item['RestartCount']]
try:
    if os.geteuid()!=0 or len(sys.argv)!=5: raise RuntimeError('f_restore_arguments_invalid')
    head,module_hash,phase,mode=sys.argv[1:]
    if not re.fullmatch(r'[a-f0-9]{40}',head) or not re.fullmatch(r'[a-f0-9]{64}',module_hash) or phase not in ('stage0',) or mode not in ('prepare','preview'): raise RuntimeError('f_restore_arguments_invalid')
    verify()
    baseline=identity()
    prefix='acceptance-stage0-readiness-v4-20261008'
    evidence=prefix+('-preflight' if mode=='prepare' else '-preview' if mode=='preview' else '-commit')+'-evidence.json'
    if (ROOT/'state'/evidence).exists(): raise RuntimeError('f_restore_already_attempted')
    for claim in (['provider-write','mcp-commit'] if mode=='commit' else ['validation']):
        if (ROOT/'state'/(prefix+'-'+claim+'.claim')).exists(): raise RuntimeError('f_restore_retry_blocked')
    mem=dict(line.split(':',1) for line in Path('/proc/meminfo').read_text().splitlines())
    if int(mem['MemAvailable'].split()[0])*1024<640*1024*1024: raise RuntimeError('insufficient_acceptance_memory')
    module=ROOT/'harness/mcp-preview-mixed-fixed.js'
    fixed=ROOT/'harness/google-ads-stage0-readiness-fixed.js'
    if hashlib.sha256(module.read_bytes()).hexdigest()!=module_hash: raise RuntimeError('product_module_hash_mismatch')
    if hashlib.sha256(fixed.read_bytes()).hexdigest()!='8a92cc8049c7c35b3fdd7fb41d01beb70de227638fe9d3e6f152477da857f957': raise RuntimeError('budget_verifier_hash_mismatch')
    for name in ('f-restore-v2-contract.mjs','stage0-v4-contract.mjs','stage0-v4-guard.mjs','stage0-v4-readiness.mjs','keyword-snapshot-proof.mjs'):
        target=ROOT/'harness'/name
        if target.exists() and target.read_bytes()!=(UPLOAD/name).read_bytes(): raise RuntimeError('f_restore_harness_collision')
        shutil.copyfile(UPLOAD/name,target)
        os.chown(target,0,0)
        os.chmod(target,0o644)
    command=['docker','compose','-p','holymedia-google-acceptance','--env-file',str(ROOT/'acceptance.env'),'-f',str(ROOT/'compose.yml'),'run','-T','--rm','--no-deps','--entrypoint','node','-e','NODE_OPTIONS=--max-old-space-size=192','-e','ACCEPTANCE_F_RESTORE_PHASE='+phase,'-e','ACCEPTANCE_STAGE0_MODE='+mode,'-v',str(fixed)+':/workspace/apps/api/dist/providers/google-ads-stage0.js:ro','-v',str(module)+':/workspace/apps/api/dist/mcp/mcp-preview.service.js:ro','-e','HOLYMEDIA_PUBLIC_BASE_URL=http://localhost:4401','-e','CORS_ORIGINS=http://localhost:4401']
    command+=['api','--import','/acceptance/stage0-v4-guard.mjs','/acceptance/stage0-v4-readiness.mjs',head]
    result=subprocess.run(command,capture_output=True,text=True,timeout=240)
    verify()
    if identity()!=baseline: raise RuntimeError('persistent_acceptance_api_changed')
    report=json.loads(result.stdout.strip())
    if report.get('runtime_product_module_sha256')!=module_hash: raise RuntimeError('running_product_module_hash_mismatch')
    print(json.dumps(report))
    print('PRODUCTION_UNCHANGED_HEALTHY; PERSISTENT_ACCEPTANCE_UNCHANGED_HEALTHY; ONE_OFF_REMOVED')
    if result.returncode: raise SystemExit(1)
except Exception as error:
    print(str(error) if isinstance(error,RuntimeError) else 'f_restore_runner_failed')
    raise SystemExit(1)
