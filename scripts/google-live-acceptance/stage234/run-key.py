"""One explicit user-authorized stock TEST key. No Google transport or retry."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
spec=importlib.util.spec_from_file_location('key_preview_supervisor',Path(__file__).with_name('run-live.py'))
base=importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

def command(image,head,directory,state,authority):
    args=['docker','run','--rm','--init','--name','hm-stage234-key-once-20261009','--network',base.NETWORK,'--label','com.docker.compose.project='+base.PROJECT,'--memory','768m','--cpus','1','--env-file',str(state/'runtime.env'),'-v',str(directory)+':/stage234:ro','-v',str(state)+':/key-state','-v',str(authority)+':/key-authority','--entrypoint','node']
    values={'STAGE234_KEY_ISSUANCE_AUTHORIZED':'true','STAGE234_KEY_RUN_DIR':'/key-state','STAGE234_KEY_AUTHORITY_DIR':'/key-authority','STAGE234_KEY_NAME':'HM_TEST_STAGE234_'+state.name.split('stage234-key-')[1], 'STAGE234_GUARD_PRELOAD':'0','STAGE234_KEY_GUARD_PRELOAD':'0','STAGE234_SOURCE_HEAD':head,'PROVIDER_GOOGLE_ADS_WRITE_ENABLED':'false','PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED':'false','PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED':'false','PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED':'false','V2_PREVIEW_ONLY':'true','V2_CONFIRMED_WRITE_ENABLED':'false','PUBLIC_MCP_WRITE_SCOPE_ENABLED':'false','PUBLIC_MCP_CONTROLLED_WRITE_ENABLED':'false','HOLYMEDIA_PUBLIC_BASE_URL':'http://localhost:4402','CORS_ORIGINS':'http://localhost:4402','COOKIE_DOMAIN':'','API_PORT':'4000','LOG_LEVEL':'error','NODE_OPTIONS':'--max-old-space-size=192'}
    for k,v in values.items():args+=['-e',k+'='+v]
    return args+[image,'/stage234/provision-key.mjs']

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--head',required=True);parser.add_argument('--image',required=True);parser.add_argument('--utc-id',required=True);parser.add_argument('--authorize-once-test-key',action='store_true');parser.add_argument('--check-only',action='store_true')
    opts=parser.parse_args()
    base.require(opts.authorize_once_test_key,'stage234_key_explicit_authorization_required')
    base.validate_options(opts.head,opts.image,opts.utc_id+'-key')
    base.require(re.fullmatch(r'[0-9]{8}T[0-9]{6}Z',opts.utc_id) is not None,'stage234_key_run_id_invalid')
    base.require(os.geteuid()==0,'stage234_key_vps_sudo_required')
    before=base.production_state();env_hash=base.inspect_ready(opts.head,opts.image)
    authority=base.ROOT/'state/stage234-key-authority-20261009'
    base.require(not authority.exists() or (not authority.is_symlink() and authority.is_dir() and not (authority/'issued-once.claim').exists()),'stage234_key_already_attempted_no_second_key')
    if opts.check_only:
        print(json.dumps({'result':'KEY_RUNTIME_CHECK_ONLY_PASS','provider_reads':0,'validate_only':0,'real_writes':0}));return
    if not authority.exists():authority.mkdir(mode=0o700);os.chown(authority,1000,1000)
    state=base.ROOT/'state'/('stage234-key-'+opts.utc_id);state.mkdir(mode=0o700);os.chown(state,1000,1000)
    for name,data in [('fixture-context.json',(base.ROOT/'state/fixture-context.json').read_bytes()),('runtime.env',''.join(k+'='+v+'\n' for k,v in base.docker_env_values((base.ROOT/'acceptance.env').read_text()).items()).encode())]:
        fd=os.open(state/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'wb') as f:f.write(data)
        os.chown(state/name,1000,1000)
    output=subprocess.run(command(opts.image,opts.head,Path(__file__).resolve().parent,state,authority),capture_output=True,text=True,timeout=150)
    base.require(base.production_state()==before,'stage234_key_production_state_changed_stop')
    base.require(hashlib.sha256((base.ROOT/'acceptance.env').read_bytes()).hexdigest()==env_hash,'stage234_key_original_env_changed')
    lines=[s for s in output.stdout.splitlines() if s.startswith('{')]
    base.require(len(lines)==1,'stage234_key_sanitized_report_missing_no_retry')
    result=json.loads(lines[0])
    if output.returncode==0 and result.get('result')=='CREATED':
        # Copy encrypted envelope only. Original plaintext expired context stays
        # immutable; the new key never leaves the disposable encrypted vault.
        basename='stage234-scoped-context-'+opts.utc_id+'.json'
        data=(state/'encrypted-context.json').read_bytes();envelope=json.loads(data)
        base.require(set(envelope)=={'version','purpose','ciphertext','encryptionVersion','public'} and envelope['purpose']=='STAGE234_ACCEPTANCE_CONTEXT' and 'service_token' not in envelope,'stage234_key_encrypted_envelope_required')
        fd=os.open(base.ROOT/'state'/basename,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'wb') as f:f.write(data)
        os.chown(base.ROOT/'state'/basename,1000,1000)
        result['context_basename']=basename
    print(json.dumps(result))
    if output.returncode!=0:raise SystemExit(1)

if __name__=='__main__':
    try:main()
    except Exception as error:
        code=str(error) if isinstance(error,RuntimeError) and re.fullmatch(r'stage234_[a-z0-9_]+',str(error)) else 'stage234_key_supervisor_failure_redacted'
        print(json.dumps({'result':'BLOCKED','code':code,'no_automatic_second_key':True,'provider_reads':0,'validate_only':0,'real_writes':0}));sys.exit(1)
