"""Source-pinned isolated READ-only inventory supervisor. No preview or mutation."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys

spec=importlib.util.spec_from_file_location('readiness_preview_supervisor',Path(__file__).with_name('run-live.py'))
base=importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

def command(opts,directory,state):
    args=['docker','run','--rm','--init','--name','hm-stage234-readiness-'+opts.run_id,'--network',base.NETWORK,
          '--label','com.docker.compose.project='+base.PROJECT,'--memory','768m','--cpus','1','--env-file',str(state/'runtime.env'),
          '-v',str(directory)+':/stage234:ro','-v',str(state)+':/acceptance-state','--entrypoint','node']
    values={'STAGE234_SOURCE_HEAD':opts.head,'STAGE234_HARNESS_HEAD':opts.harness_head,'STAGE234_IMAGE_DIGEST':opts.image.split('@')[1],
            'STAGE234_RUN_DIR':'/acceptance-state','PROVIDER_GOOGLE_ADS_WRITE_ENABLED':'false','PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED':'false',
            'PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED':'false','PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED':'false','V2_PREVIEW_ONLY':'true',
            'V2_CONFIRMED_WRITE_ENABLED':'false','PUBLIC_MCP_WRITE_SCOPE_ENABLED':'false','PUBLIC_MCP_CONTROLLED_WRITE_ENABLED':'false',
            'GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST':'8590146099','PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID':'4378327049','PROVIDER_GOOGLE_API_VERSION':'v24',
            'LOG_LEVEL':'error','NODE_OPTIONS':'--max-old-space-size=192'}
    if getattr(opts,'discovery',False):values['STAGE234_DISCOVERY']='true'
    for k,v in values.items():args+=['-e',k+'='+v]
    return args+[opts.image,'/stage234/targeting-readiness-runner.mjs']

def execute(opts):
    base.validate_options(opts.head,opts.image,opts.run_id)
    base.require(re.fullmatch(r'[0-9a-f]{40}',opts.harness_head or '') is not None,'stage234_readiness_harness_head_invalid')
    base.require(re.fullmatch(r'stage234-scoped-context-[0-9]{8}T[0-9]{6}Z\.json',opts.context_basename or '') is not None,'stage234_readiness_encrypted_context_required')
    base.require(hasattr(os,'geteuid') and os.geteuid()==0,'stage234_readiness_vps_sudo_required')
    before=base.production_state();env_hash=base.inspect_ready(opts.head,opts.image)
    selected=base.context_source(opts.context_basename);base.permissions(selected)
    envelope=json.loads(selected.read_text())
    base.require(envelope.get('purpose')=='STAGE234_ACCEPTANCE_CONTEXT' and 'service_token' not in envelope,'stage234_readiness_encrypted_context_required')
    if opts.check_only:
        print(json.dumps({'result':'RDY_CHECK_ONLY_PASS','provider_reads':0,'validate_only':0,'real_writes':0}));return
    state=base.ROOT/'state'/('stage234-readiness-'+opts.run_id)
    state.mkdir(mode=0o700);os.chown(state,1000,1000)
    for name,data in [('fixture-context.json',selected.read_bytes()),('runtime.env',''.join(k+'='+v+'\n' for k,v in base.docker_env_values((base.ROOT/'acceptance.env').read_text()).items()).encode())]:
        fd=os.open(state/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'wb') as f:f.write(data)
        os.chown(state/name,1000,1000)
    output=None
    try:
        output=subprocess.run(command(opts,Path(__file__).resolve().parent,state),capture_output=True,text=True,timeout=240)
    finally:
        base.require(base.production_state()==before,'stage234_readiness_production_state_changed')
        base.require(hashlib.sha256((base.ROOT/'acceptance.env').read_bytes()).hexdigest()==env_hash,'stage234_readiness_original_env_changed')
    lines=[s for s in output.stdout.splitlines() if s.startswith('{')]
    base.require(len(lines)==1,'stage234_readiness_safe_runner_report_missing')
    report=json.loads(lines[0])
    # Only fixed harmless fields; full sanitized inventories remain private.
    allowed={'result','code','provider_reads','validate_only','real_writes','evidence','I','J','PMax','failure_stage'}
    print(json.dumps({k:v for k,v in report.items() if k in allowed}))
    if output.returncode!=0:raise SystemExit(1)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for k in ['head','harness-head','image','run-id','context-basename']:parser.add_argument('--'+k,required=True)
    parser.add_argument('--check-only',action='store_true')
    parser.add_argument('--discovery',action='store_true')
    execute(parser.parse_args())

if __name__=='__main__':
    try:main()
    except Exception as e:
        code=str(e) if isinstance(e,RuntimeError) and re.fullmatch(r'stage234_[a-z0-9_]+',str(e)) else 'stage234_readiness_supervisor_error_redacted'
        print(json.dumps({'result':'BLOCKED','code':code,'real_writes':0}));sys.exit(1)
