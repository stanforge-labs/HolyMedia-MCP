"""One exact human-approved immutable I removal commit. No preview, retry or approval."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
spec=importlib.util.spec_from_file_location('base',Path(__file__).with_name('run-live.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
SOURCE='55d9df3553ff1ad01586978b6e4ecc07913969c5'
IMAGE='ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:2d7cd20cb25c268f74abd16f324d7b92ce5d804989a8de9b3fa062a0ca138d35'
def execute(o):
    base.validate_options(SOURCE,IMAGE,o.run_id);base.validate_options(SOURCE,IMAGE,o.preview_run_id)
    base.require(os.geteuid()==0 and all(re.fullmatch(r'[a-f0-9]{40}',v or '') for v in [o.harness_head,o.preview_harness_head]) and re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',o.authorize_exact_preview or ''),'stage234_i_remove_commit_options_invalid')
    parent=base.ROOT/'state'/('stage234-i-remove-'+o.preview_run_id)
    names=['runtime.env','protected-preview-context.json','prepared-i-remove-plan.json','i-origin.json','evidence.json','i-remove-harness-source.json']
    hashes={}
    for name in names:
        base.permissions(parent/name);base.require((parent/name).stat().st_uid==1000,'stage234_i_remove_commit_file_owner_invalid');hashes[name]=hashlib.sha256((parent/name).read_bytes()).hexdigest()
    evidence=json.loads((parent/'evidence.json').read_text());manifest=json.loads((parent/'i-remove-harness-source.json').read_text())
    base.require(evidence.get('result')=='PREVIEW_PASS_REMOVE_APPROVAL_PENDING' and evidence.get('preview_id')==o.authorize_exact_preview and evidence.get('harness_head')==o.preview_harness_head==manifest.get('head') and evidence.get('source_head')==SOURCE and evidence.get('image_digest')==IMAGE.split('@')[1] and evidence.get('before_after_unchanged') is True and evidence.get('committed') is False and evidence.get('real_provider_write_call_count')==0,'stage234_i_remove_commit_original_invalid')
    obj=json.loads(base.capture(['docker','inspect','hm-'+parent.name]))[0];labels=obj.get('Config',{}).get('Labels') or {}
    base.require(labels.get('com.docker.compose.project')==base.PROJECT and labels.get('org.holymedia.acceptance-purpose')=='I-remove-preview' and obj.get('State',{}).get('Running') is True and obj.get('NetworkSettings',{}).get('Ports',{}).get('4001/tcp')==[{'HostIp':'127.0.0.1','HostPort':'4403'}],'stage234_i_remove_commit_parent_runtime_invalid')
    gateway=[obj['Id'],obj['Image'],obj['State']['StartedAt'],obj['RestartCount']]
    production=base.production_state();envhash=base.inspect_ready(SOURCE,IMAGE)
    # Retained parent latch prevents any second supervisor attempt even after failure.
    fd=os.open(parent/'i-remove-commit-launch.claim',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f:json.dump({'preview_id':o.authorize_exact_preview,'run_id':o.run_id,'harness_head':o.harness_head},f)
    os.chown(parent/'i-remove-commit-launch.claim',1000,1000)
    state=base.ROOT/'state'/('stage234-i-remove-commit-'+o.run_id);state.mkdir(mode=0o700);os.chown(state,1000,1000)
    for name in names:
        fd=os.open(state/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'wb') as f:f.write((parent/name).read_bytes())
        os.chown(state/name,1000,1000)
    directory=Path(__file__).resolve().parent
    payload={'head':o.harness_head,'files':{f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in directory.glob('*.mjs')}}
    fd=os.open(state/'commit-harness-source.json',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(fd,'w') as f:json.dump(payload,f)
    os.chown(state/'commit-harness-source.json',1000,1000)
    args=['docker','run','--rm','--init','--name','hm-'+state.name,'--network',base.NETWORK,'--label','com.docker.compose.project='+base.PROJECT,'--memory','768m','--cpus','1','--env-file',str(state/'runtime.env'),'-v',str(directory)+':/stage234:ro','-v',str(state)+':/acceptance-state/'+state.name,'--entrypoint','node']
    flags={'STAGE234_SOURCE_HEAD':SOURCE,'STAGE234_IMAGE_DIGEST':IMAGE.split('@')[1],'STAGE234_HARNESS_HEAD':o.harness_head,'STAGE234_PREVIEW_HARNESS_HEAD':o.preview_harness_head,'STAGE234_EXPECTED_I_PREVIEW':o.authorize_exact_preview,'STAGE234_RUN_DIR':'/acceptance-state/'+state.name,'STAGE234_EXPLICIT_COMMIT_AUTHORIZED':'true',
      'PROVIDER_GOOGLE_ADS_WRITE_ENABLED':'true','PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED':'false','PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED':'true','PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED':'false','GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST':'8590146099','PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID':'4378327049','PROVIDER_GOOGLE_API_VERSION':'v24','V2_PREVIEW_ONLY':'false','V2_CONFIRMED_WRITE_ENABLED':'true','PUBLIC_MCP_WRITE_SCOPE_ENABLED':'false','PUBLIC_MCP_CONTROLLED_WRITE_ENABLED':'false','STAGE234_GUARD_PRELOAD':'0','STAGE234_L_GUARD_PRELOAD':'0','STAGE234_I_GUARD_PRELOAD':'0','STAGE234_I_COMMIT_GUARD_PRELOAD':'0','STAGE234_COMMIT_GUARD_PRELOAD':'0','STAGE234_L_COMMIT_GUARD_PRELOAD':'0','STAGE234_I_REMOVE_GUARD_PRELOAD':'0','STAGE234_I_REMOVE_COMMIT_GUARD_PRELOAD':'0','STAGE234_APPROVAL_GATEWAY':'false','API_PORT':'4000','LOG_LEVEL':'error','NODE_OPTIONS':'--max-old-space-size=192'}
    for k,v in flags.items():args+=['-e',k+'='+v]
    result=None
    try:result=subprocess.run(args+[IMAGE,'/stage234/audience-remove-commit-runner.mjs'],capture_output=True,text=True,timeout=300)
    finally:
        now=json.loads(base.capture(['docker','inspect','hm-'+parent.name]))[0]
        base.require(gateway==[now['Id'],now['Image'],now['State']['StartedAt'],now['RestartCount']] and production==base.production_state() and envhash==hashlib.sha256((base.ROOT/'acceptance.env').read_bytes()).hexdigest(),'stage234_i_remove_commit_services_changed')
        base.require(all(hashlib.sha256((parent/n).read_bytes()).hexdigest()==h for n,h in hashes.items()),'stage234_i_remove_commit_history_changed')
    lines=[x for x in result.stdout.splitlines() if x.startswith('{')]
    base.require(len(lines)==1,'stage234_i_remove_commit_safe_result_missing')
    data=json.loads(lines[0]);safe={'result','code','failure_stage','preview_id','commit_id','criterion_id','status','mode','journal','provider_read_call_count','validate_only_call_count','real_provider_write_call_count','oauth_refresh_call_count'}
    print(json.dumps({k:v for k,v in data.items() if k in safe}));raise SystemExit(result.returncode)
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for n in ['harness-head','preview-harness-head','run-id','preview-run-id','authorize-exact-preview']:p.add_argument('--'+n,required=True)
    try:execute(p.parse_args())
    except Exception as e:
        code=str(e) if isinstance(e,RuntimeError) and re.fullmatch(r'stage234_[a-z0-9_]+',str(e)) else 'stage234_i_remove_commit_supervisor_redacted'
        print(json.dumps({'result':'BLOCKED','code':code,'real_provider_write_call_count':None}));raise SystemExit(1)
