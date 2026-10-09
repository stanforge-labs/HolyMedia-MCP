"""One authorized stock inverse N commit. Separate state/claims; never replays forward."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
from datetime import datetime, timezone

spec=importlib.util.spec_from_file_location('n_forward',Path(__file__).with_name('run-commit.py'))
forward=importlib.util.module_from_spec(spec);spec.loader.exec_module(forward)
base=forward.preview_supervisor

def execute(opts):
    base.validate_options(opts.head,opts.image,opts.run_id)
    base.validate_options(opts.head,opts.image,opts.restore_run_id)
    base.require(re.fullmatch(r'[a-f0-9]{40}',opts.harness_head or '') and re.fullmatch(r'[a-f0-9-]{36}',opts.authorize_exact_preview or '') and re.fullmatch(r'hmc_[A-Za-z0-9_-]{43}',opts.original_commit_id or ''),'stage234_restore_explicit_authority_invalid')
    base.require(os.geteuid()==0,'stage234_restore_sudo_required')
    before=base.production_state();gateway=forward.gateway_state(opts.run_id);env_hash=base.inspect_ready(opts.head,opts.image)
    old=base.ROOT/'state'/('stage234-'+opts.run_id)
    forward.protected(old,True)
    for name in ['protected-n-rollback-context.json','n-rollback-preview-evidence.json','runtime.env','harness-source.json']:
        forward.protected(old/name)
    directory=Path(__file__).resolve().parent
    forward.verify_manifest(json.loads((old/'harness-source.json').read_text()),opts.head,directory)
    evidence=json.loads((old/'n-rollback-preview-evidence.json').read_text());envelope=json.loads((old/'protected-n-rollback-context.json').read_text());p=envelope.get('public',{}).get('preview',{})
    base.require(envelope.get('purpose')=='STAGE234_ACCEPTANCE_CONTEXT' and p.get('preview_id')==opts.authorize_exact_preview==evidence.get('rollback_preview',{}).get('preview_id') and p.get('account_id')=='8590146099' and p.get('provider_validation')=='passed' and p.get('operation_count')==1,'stage234_restore_context_invalid')
    base.require(evidence.get('rollback_preview',{}).get('rollback_of')==opts.original_commit_id and evidence.get('commit',{}).get('commit_id')==opts.original_commit_id and evidence.get('commit',{}).get('status')=='VERIFIED' and evidence.get('source_head')==opts.head and evidence.get('image_digest')==opts.image.split('@')[1],'stage234_restore_source_or_origin_invalid')
    base.require(datetime.fromisoformat(p['expires_at'].replace('Z','+00:00'))>datetime.now(timezone.utc),'stage234_restore_expired')
    values=base.docker_env_values((old/'runtime.env').read_text())
    base.require(values.get('GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST')=='8590146099' and all(values.get(k)=='false' for k in ['PUBLIC_MCP_WRITE_SCOPE_ENABLED','PUBLIC_MCP_CONTROLLED_WRITE_ENABLED']),'stage234_restore_env_invalid')
    state=base.ROOT/'state'/('stage234-'+opts.restore_run_id)
    fd=os.open(old/'nr-supervisor-launch.claim',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(fd,'w') as f:json.dump({'preview_id':opts.authorize_exact_preview,'restore_run_id':opts.restore_run_id},f)
    os.chown(old/'nr-supervisor-launch.claim',1000,1000)
    state.mkdir(mode=0o700);os.chown(state,1000,1000)
    files={'protected-preview-context.json':(old/'protected-n-rollback-context.json').read_bytes(),'evidence.json':(old/'n-rollback-preview-evidence.json').read_bytes(),'runtime.env':(old/'runtime.env').read_bytes(),'restore-supervisor-launch.claim':json.dumps({'preview_id':opts.authorize_exact_preview,'original_commit_id':opts.original_commit_id}).encode()}
    for name,data in files.items():
        fd=os.open(state/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'wb') as f:f.write(data)
        os.chown(state/name,1000,1000)
    args=['docker','run','--rm','--init','--name','hm-stage234-'+opts.restore_run_id,'--network',base.NETWORK,'--label','com.docker.compose.project='+base.PROJECT,'--memory','768m','--cpus','1','--env-file',str(state/'runtime.env'),'-v',str(directory)+':/stage234:ro','-v',str(state)+':/acceptance-state/stage234-'+opts.restore_run_id,'--entrypoint','node']
    config={'STAGE234_SOURCE_HEAD':opts.head,'STAGE234_HARNESS_HEAD':opts.harness_head,'STAGE234_IMAGE_DIGEST':opts.image.split('@')[1],'STAGE234_RUN_DIR':'/acceptance-state/stage234-'+opts.restore_run_id,'STAGE234_EXPECTED_ORIGINAL_COMMIT':opts.original_commit_id,'STAGE234_EXPLICIT_COMMIT_AUTHORIZED':'true','STAGE234_GUARD_PRELOAD':'0','STAGE234_COMMIT_GUARD_PRELOAD':'0','STAGE234_APPROVAL_GATEWAY':'false','STAGE234_KEEP_API_ALIVE':'false','PROVIDER_GOOGLE_ADS_WRITE_ENABLED':'true','PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED':'true','PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED':'false','PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED':'false','V2_PREVIEW_ONLY':'false','V2_CONFIRMED_WRITE_ENABLED':'true','PUBLIC_MCP_WRITE_SCOPE_ENABLED':'false','PUBLIC_MCP_CONTROLLED_WRITE_ENABLED':'false','API_PORT':'4000','LOG_LEVEL':'error','NODE_OPTIONS':'--max-old-space-size=192'}
    for key,value in config.items():args+=['-e',key+'='+value]
    output=None
    try:output=subprocess.run(args+[opts.image,'/stage234/restore-runner.mjs'],capture_output=True,text=True,timeout=240)
    finally:
        base.require(base.production_state()==before and forward.gateway_state(opts.run_id)==gateway,'stage234_restore_service_changed')
        base.require(hashlib.sha256((base.ROOT/'acceptance.env').read_bytes()).hexdigest()==env_hash,'stage234_restore_existing_env_changed')
    lines=[x for x in output.stdout.splitlines() if x.startswith('{')]
    base.require(len(lines)==1,'stage234_restore_safe_report_missing')
    print(json.dumps(forward.safe_report(json.loads(lines[0]))))
    if output.returncode:raise SystemExit(1)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['head','harness-head','image','run-id','restore-run-id','authorize-exact-preview','original-commit-id']:p.add_argument('--'+name,required=True)
    try:execute(p.parse_args())
    except Exception as e:
        code=str(e) if isinstance(e,RuntimeError) and re.fullmatch(r'stage234_[a-z0-9_]+',str(e)) else 'stage234_restore_supervisor_redacted'
        print(json.dumps({'result':'BLOCKED','code':code,'real_writes':None}));raise SystemExit(1)
