"""Hash-pinned disposable W checklist/preview. Never commits/approves."""
import hashlib,json,os,re,shutil,subprocess,sys
from pathlib import Path
ROOT=Path('/opt/holymedia-google-acceptance')
UPLOAD=Path('/home/ubuntu/holymedia-google-acceptance-harness')
SOURCE=UPLOAD/'W-readiness-20261008T192300Z'
PREFIX='acceptance-stage0-W-20261008T192300Z'
def verify():
 p=subprocess.run(['python3',str(UPLOAD/'provision.py'),'verify'],capture_output=True,text=True)
 if p.returncode:raise RuntimeError('W_production_baseline_changed')
def identity():
 c=json.loads(subprocess.run(['docker','inspect','holymedia-google-acceptance-api-1'],capture_output=True,text=True,check=True).stdout)[0]
 return [c['Id'],c['Image'],c['State']['StartedAt'],c['RestartCount']]
try:
 if os.geteuid()!=0 or len(sys.argv)!=3 or sys.argv[2] not in ('prepare','preview') or not re.fullmatch('[a-f0-9]{40}',sys.argv[1]):raise RuntimeError('W_arguments_invalid')
 head,mode=sys.argv[1:]
 manifest=json.loads((SOURCE/'module-manifest.json').read_text())
 if head!=manifest['source_HEAD']:raise RuntimeError('W_source_head_mismatch')
 verify();baseline=identity()
 if (ROOT/'state'/(PREFIX+'-'+mode+'-evidence.json')).exists():raise RuntimeError('W_attempt_already_exists')
 if mode=='preview' and (ROOT/'state'/(PREFIX+'-validation.claim')).exists():raise RuntimeError('W_validation_retry_blocked')
 memory=dict(line.split(':',1) for line in Path('/proc/meminfo').read_text().splitlines())
 if int(memory['MemAvailable'].split()[0])*1024<640*1024*1024:raise RuntimeError('W_insufficient_memory')
 dest=ROOT/'harness'/'W-readiness-20261008T192300Z';dest.mkdir(exist_ok=True,mode=0o755)
 for entry in manifest['modules']:
  p=SOURCE/'modules'/entry['file']
  if hashlib.sha256(p.read_bytes()).hexdigest()!=entry['sha256']:raise RuntimeError('W_module_hash_mismatch')
  target=dest/entry['file']
  if target.exists() and target.read_bytes()!=p.read_bytes():raise RuntimeError('W_module_collision')
  shutil.copyfile(p,target);os.chmod(target,0o644)
 for name in ('W-completion-contract.mjs','W-completion-guard.mjs','W-completion-readiness-v2.mjs','W-completion-fixture-contract.mjs'):
  p=SOURCE/'harness'/name;target=ROOT/'harness'/name
  if target.exists() and target.read_bytes()!=p.read_bytes():raise RuntimeError('W_harness_collision_'+name)
  shutil.copyfile(p,target);os.chmod(target,0o644)
 command=['docker','compose','-p','holymedia-google-acceptance','--env-file',str(ROOT/'acceptance.env'),'-f',str(ROOT/'compose.yml'),'run','-T','--rm','--no-deps','--entrypoint','node','-e','NODE_OPTIONS=--max-old-space-size=192','-e','ACCEPTANCE_W_MODE='+mode,'-e','V2_PREVIEW_ONLY=true','-e','V2_CONFIRMED_WRITE_ENABLED=false','-e','HOLYMEDIA_PUBLIC_BASE_URL=http://localhost:4401','-e','CORS_ORIGINS=http://localhost:4401']
 for entry in manifest['modules']:command+=['-v',str(dest/entry['file'])+':/workspace/'+entry['target']+':ro']
 command+=['api','--import','/acceptance/W-completion-guard.mjs','/acceptance/W-completion-readiness-v2.mjs',head]
 result=subprocess.run(command,capture_output=True,text=True,timeout=300)
 verify()
 if identity()!=baseline:raise RuntimeError('W_permanent_api_changed')
 report=json.loads(result.stdout.strip());print(json.dumps(report,ensure_ascii=False))
 print('PRODUCTION_UNCHANGED_HEALTHY; PERSISTENT_ACCEPTANCE_UNCHANGED_HEALTHY; ONE_OFF_REMOVED')
 if result.returncode:raise SystemExit(1)
except Exception as e:
 print(str(e) if isinstance(e,RuntimeError) else 'W_runner_failed');raise SystemExit(1)
