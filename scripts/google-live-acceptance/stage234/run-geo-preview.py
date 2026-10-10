"""Single source-pinned J preview; retires only the consumed disposable gateway."""
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
PARENT='stage234-i-remove-20261010T183900Z-irp3'
ORIGIN='stage234-i-remove-reconcile-20261010T185500Z-irr1/i-remove-reconciled-evidence.json'
SHA='33a5304a8c1e87caa0c0921ea359b80b6e333cbf7c16c79f3d52475b0d7cfc97'

def disposable_parent_valid(item):
    labels=item.get('Config',{}).get('Labels') or {}
    return (item.get('Name')=='/hm-'+PARENT and labels.get('com.docker.compose.project')==base.PROJECT
      and labels.get('org.holymedia.acceptance-purpose')=='I-remove-preview'
      and item.get('State',{}).get('Running') is True
      and (item.get('NetworkSettings',{}).get('Ports',{}).get('4001/tcp') or [])==[{'HostIp':'127.0.0.1','HostPort':'4403'}])

def execute(opts):
    base.validate_options(SOURCE,IMAGE,opts.run_id)
    base.require(os.geteuid()==0 and re.fullmatch(r'[a-f0-9]{40}',opts.harness_head or ''),'stage234_j_options_invalid')
    production=base.production_state();envhash=base.inspect_ready(SOURCE,IMAGE)
    parent=base.ROOT/'state'/PARENT;origin=base.ROOT/'state'/ORIGIN
    for path in [parent/'protected-preview-context.json',parent/'runtime.env',origin]:base.permissions(path)
    base.require(hashlib.sha256(origin.read_bytes()).hexdigest()==SHA,'stage234_j_i_origin_changed')
    old=json.loads(base.capture(['docker','inspect','hm-'+PARENT]))[0]
    base.require(disposable_parent_valid(old),'stage234_j_parent_invalid')
    # No token/credential projection or Google request. Only a consumed exact
    # VERIFIED old preview, valid TEST key and zero pending approvals can retire.
    js="""const {createDatabase,closeDatabase}=await import('/workspace/packages/database/dist/index.js');const {loadConfig}=await import('/workspace/packages/config/dist/index.js');const db=createDatabase(loadConfig().databaseUrl);try{const p=await db.client.mcpPreview.findUnique({where:{id:'c66dfe1a-cc36-4a0b-b0dd-8ba3538198cc'},include:{account:true}});const k=await db.client.serviceToken.findUnique({where:{id:'2b21e15f-c015-450f-8d36-8b24ce1c6ef6'},include:{serviceIdentity:true}});const pending=await db.client.mcpPreview.count({where:{workspaceId:p.workspaceId,provider:'GOOGLE_ADS',consumedAt:null,cancelledAt:null,expiresAt:{gt:new Date()}}});console.log(JSON.stringify({valid:p.commitStatus==='VERIFIED'&&!!p.consumedAt&&p.account.externalAccountId==='8590146099'&&pending===0&&!!k&&!k.revokedAt&&!k.serviceIdentity.revokedAt&&k.expiresAt.getTime()>Date.now()&&k.serviceIdentity.workspaceId===p.workspaceId&&k.resourceAccessMode==='STATIC_ALLOWLIST'&&JSON.stringify(k.accountIds)===JSON.stringify([p.accountId])&&JSON.stringify([...k.scopes].sort())==='["adforge:mcp:read","adforge:mcp:write"]'}));}finally{await closeDatabase(db)}"""
    checked=json.loads(base.capture(['docker','exec','-e','NODE_OPTIONS=--max-old-space-size=192','hm-'+PARENT,'node','--input-type=module','-e',js]))
    base.require(checked.get('valid') is True,'stage234_j_pending_key_or_old_commit_invalid')
    directory=Path(__file__).resolve().parent
    frozen={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in directory.glob('*.mjs')}
    if opts.check_only:
        print(json.dumps({'result':'J_RUNTIME_AND_KEY_READY_NO_PROVIDER_CALLS','source':SOURCE,'real_writes':0}));return
    state=base.ROOT/'state'/('stage234-j-'+opts.run_id)
    state.mkdir(mode=0o700);os.chown(state,1000,1000)
    sources={'fixture-context.json':parent/'protected-preview-context.json','runtime.env':parent/'runtime.env','i-remove-origin.json':origin}
    hashes={name:hashlib.sha256(path.read_bytes()).hexdigest() for name,path in sources.items()}
    files={name:path.read_bytes() for name,path in sources.items()}
    files['harness-source.json']=json.dumps({'head':opts.harness_head,'source':SOURCE,'purpose':'J_PREVIEW_ONLY','files':frozen}).encode()
    for name,data in files.items():
        fd=os.open(state/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'wb') as stream:stream.write(data)
        os.chown(state/name,1000,1000)
    # Retain a launch claim: neither this supervisor nor a failed preview may
    # quietly dispatch a duplicate. Existing state/history are never deleted.
    if not opts.prepare_only:
        fd=os.open(parent/'j-preview-launch.claim',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'wb') as stream:stream.write(state.name.encode())
        base.capture(['docker','stop','--time','10','hm-'+PARENT])
    args=['docker','run','--init','--rm']+([] if opts.prepare_only else ['-d'])+['--name','hm-'+state.name,'--network',base.NETWORK,'--label','com.docker.compose.project='+base.PROJECT,'--label','org.holymedia.acceptance-purpose=J-preview','--memory','768m','--cpus','1','--env-file',str(state/'runtime.env')]+([] if opts.prepare_only else ['-p','127.0.0.1:4403:4001'])+['-v',str(directory)+':/stage234:ro','-v',str(base.ROOT/'harness')+':/acceptance:ro','-v',str(state)+':/acceptance-state/'+state.name,'--entrypoint','node']
    flags={'STAGE234_SOURCE_HEAD':SOURCE,'STAGE234_IMAGE_DIGEST':IMAGE.split('@')[1],'STAGE234_HARNESS_HEAD':opts.harness_head,'STAGE234_RUN_DIR':'/acceptance-state/'+state.name,'STAGE234_KEEP_API_ALIVE':'true','PROVIDER_GOOGLE_ADS_WRITE_ENABLED':'true','PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED':'false','PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED':'true','PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED':'false','GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST':'8590146099','PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID':'4378327049','PROVIDER_GOOGLE_API_VERSION':'v24','V2_PREVIEW_ONLY':'true','V2_CONFIRMED_WRITE_ENABLED':'false','PUBLIC_MCP_WRITE_SCOPE_ENABLED':'false','PUBLIC_MCP_CONTROLLED_WRITE_ENABLED':'false','STAGE234_GUARD_PRELOAD':'0','STAGE234_L_GUARD_PRELOAD':'0','STAGE234_I_GUARD_PRELOAD':'0','STAGE234_I_COMMIT_GUARD_PRELOAD':'0','STAGE234_I_REMOVE_GUARD_PRELOAD':'0','STAGE234_I_REMOVE_COMMIT_GUARD_PRELOAD':'0','STAGE234_COMMIT_GUARD_PRELOAD':'0','STAGE234_L_COMMIT_GUARD_PRELOAD':'0','STAGE234_J_GUARD_PRELOAD':'1','STAGE234_APPROVAL_GATEWAY':'true','HOLYMEDIA_PUBLIC_BASE_URL':'http://localhost:4403','CORS_ORIGINS':'http://localhost:4403','COOKIE_DOMAIN':'','API_PORT':'4000','LOG_LEVEL':'error','NODE_OPTIONS':'--max-old-space-size=192'}
    flags['STAGE234_J_PREPARE_ONLY']='true' if opts.prepare_only else 'false'
    for k,v in flags.items():args+=['-e',k+'='+v]
    try:
        outcome=base.capture(args+[IMAGE,'/stage234/geo-preview-runner.mjs'])
        if opts.prepare_only:print(outcome.strip())
    finally:
        base.require(production==base.production_state() and envhash==hashlib.sha256((base.ROOT/'acceptance.env').read_bytes()).hexdigest(),'stage234_j_production_changed')
        base.require(all(hashlib.sha256(path.read_bytes()).hexdigest()==hashes[name] for name,path in sources.items()),'stage234_j_history_changed')
        base.require(frozen=={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in directory.glob('*.mjs')},'stage234_j_harness_changed')
    print(json.dumps({'result':'J_PREPARATION_COMPLETE_NO_PREVIEW' if opts.prepare_only else 'J_PREVIEW_ONLY_STARTED','container':'hm-'+state.name,'state':str(state),'real_writes_permitted':False}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--harness-head',required=True);p.add_argument('--run-id',required=True);p.add_argument('--check-only',action='store_true');p.add_argument('--prepare-only',action='store_true')
    try:execute(p.parse_args())
    except Exception as error:
        code=str(error) if isinstance(error,RuntimeError) and re.fullmatch(r'stage234_[a-z0-9_]+',str(error)) else 'stage234_j_supervisor_failure_redacted'
        print(json.dumps({'result':'BLOCKED','code':code,'real_writes':0}));raise SystemExit(1)
