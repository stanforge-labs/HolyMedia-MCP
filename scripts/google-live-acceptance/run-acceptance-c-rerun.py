"""C rerun with a hash-pinned fixed product module; no persistent service deployment."""
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys

ROOT=Path('/opt/holymedia-google-acceptance')
UPLOAD=Path('/home/ubuntu/holymedia-google-acceptance-harness')
def parse_head(arguments):
    if len(arguments) != 3 or not re.fullmatch(r'[0-9a-f]{40}', arguments[1]):
        raise RuntimeError('acceptance_c_rerun_head_mismatch')
    return arguments[1]
def verify():
    checked=subprocess.run(['python3',str(UPLOAD/'provision.py'),'verify'],capture_output=True,text=True)
    if checked.returncode: raise RuntimeError('production_or_acceptance_baseline_changed')
def api_identity():
    inspected=subprocess.run(['docker','inspect','holymedia-google-acceptance-api-1'],capture_output=True,text=True,check=True)
    item=json.loads(inspected.stdout)[0]
    return [item['Id'],item['Image'],item['State']['StartedAt'],item['RestartCount']]
try:
    if os.geteuid()!=0: raise RuntimeError('sudo_required')
    HEAD=parse_head(sys.argv)
    MODULE_SHA=sys.argv[2]
    if not re.fullmatch(r'[0-9a-f]{64}',MODULE_SHA): raise RuntimeError('product_module_hash_invalid')
    module=UPLOAD/'mcp-preview-mixed-fixed.js'
    if hashlib.sha256(module.read_bytes()).hexdigest()!=MODULE_SHA: raise RuntimeError('product_module_hash_mismatch')
    verify()
    baseline=api_identity()
    if (ROOT/'state/acceptance-c-rerun-evidence.json').exists() or (ROOT/'state/acceptance-c-rerun-validate.claim').exists(): raise RuntimeError('acceptance_c_rerun_already_attempted_stop')
    mem=dict(line.split(':',1) for line in Path('/proc/meminfo').read_text().splitlines())
    if int(mem['MemAvailable'].split()[0])*1024 < 640*1024*1024: raise RuntimeError('insufficient_memory_for_one_off_acceptance')
    fixed=ROOT/'harness/google-ads-stage0-budget-fixed.js'
    if hashlib.sha256(fixed.read_bytes()).hexdigest()!='da45fc7a89b115c344e2de496a49d98b356cc1c918087ce20902deb3c998e11e': raise RuntimeError('corrected_product_verifier_mismatch')
    for name in ['acceptance-c-rerun-guard.mjs','acceptance-c-rerun.mjs']:
        target=ROOT/'harness'/name
        if target.exists() and target.read_bytes()!=(UPLOAD/name).read_bytes(): raise RuntimeError('acceptance_c_rerun_harness_collision')
        shutil.copyfile(UPLOAD/name,target)
        os.chown(target,0,0)
        os.chmod(target,0o644)
    module_target=ROOT/'harness/mcp-preview-mixed-fixed.js'
    if module_target.exists() and module_target.read_bytes()!=module.read_bytes(): raise RuntimeError('product_module_collision')
    shutil.copyfile(module,module_target)
    os.chown(module_target,0,0)
    os.chmod(module_target,0o644)
    command=['docker','compose','-p','holymedia-google-acceptance','--env-file',str(ROOT/'acceptance.env'),'-f',str(ROOT/'compose.yml'),'run','-T','--rm','--no-deps','--entrypoint','node','-e','NODE_OPTIONS=--max-old-space-size=192','-v',str(fixed)+':/workspace/apps/api/dist/providers/google-ads-stage0.js:ro','-v',str(module_target)+':/workspace/apps/api/dist/mcp/mcp-preview.service.js:ro','-e','HOLYMEDIA_PUBLIC_BASE_URL=http://localhost:4401','-e','CORS_ORIGINS=http://localhost:4401','api','/acceptance/acceptance-c-rerun.mjs',HEAD]
    completed=subprocess.run(command,capture_output=True,text=True,timeout=240)
    verify()
    if api_identity()!=baseline: raise RuntimeError('running_acceptance_api_changed')
    report=json.loads(completed.stdout.strip())
    if report.get('runtime_product_module_sha256')!=MODULE_SHA: raise RuntimeError('running_product_module_hash_mismatch')
    print(json.dumps(report))
    print('PRODUCTION_UNCHANGED_HEALTHY; RUNNING_ACCEPTANCE_API_UNCHANGED_HEALTHY; NO_DEPLOY; ONE_OFF_PROCESS_REMOVED')
    if completed.returncode: raise SystemExit(1)
except Exception as error:
    print(str(error) if isinstance(error,RuntimeError) else 'acceptance_c_rerun_runner_failed')
    raise SystemExit(1)
