"""Exact VERIFIED I criterion removal preview only. No commit or approval."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re

spec=importlib.util.spec_from_file_location('base',Path(__file__).with_name('run-live.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
SOURCE='55d9df3553ff1ad01586978b6e4ecc07913969c5'
IMAGE='ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:2d7cd20cb25c268f74abd16f324d7b92ce5d804989a8de9b3fa062a0ca138d35'
PARENT='stage234-i-20261010T162530Z-i3'
ORIGIN='stage234-i-commit-20261010T163550Z-ic1'
RECONCILE='stage234-i-reconcile-20261010T165000Z-ir1'
RECONCILE_SHA='95ade1e14a04475a85f685b8b37b2412cb86c93851f0402667984063f379dae7'

def execute(opts):
    base.validate_options(SOURCE,IMAGE,opts.run_id)
    base.require(os.geteuid()==0 and re.fullmatch(r'[a-f0-9]{40}',opts.harness_head or ''),'stage234_i_remove_options_invalid')
    production=base.production_state();envhash=base.inspect_ready(SOURCE,IMAGE)
    parent=base.ROOT/'state'/PARENT;original=base.ROOT/'state'/ORIGIN
    reconcile=base.ROOT/'state'/RECONCILE/'i-reconciled-evidence.json';base.permissions(reconcile)
    base.require(hashlib.sha256(reconcile.read_bytes()).hexdigest()==RECONCILE_SHA,'stage234_i_remove_origin_hash_invalid')
    evidence=json.loads(reconcile.read_text())
    base.require(evidence.get('result')=='I_ADD_VERIFIED_REMOVE_PENDING' and evidence.get('created_audience',{}).get('criterion_id')=='51668099935','stage234_i_remove_origin_invalid')
    old=json.loads(base.capture(['docker','inspect','hm-'+PARENT]))[0]
    labels=old.get('Config',{}).get('Labels') or {}
    base.require(labels.get('com.docker.compose.project')==base.PROJECT and labels.get('org.holymedia.acceptance-purpose')=='I-preview' and old.get('State',{}).get('Running') is True and (old.get('NetworkSettings',{}).get('Ports',{}).get('4001/tcp') or [])==[{'HostIp':'127.0.0.1','HostPort':'4403'}],'stage234_i_remove_parent_runtime_invalid')
    # DB-only gate before retiring the consumed loopback gateway. No provider calls.
    js="""const {createDatabase,closeDatabase}=await import('/workspace/packages/database/dist/index.js');const {loadConfig}=await import('/workspace/packages/config/dist/index.js');const db=createDatabase(loadConfig().databaseUrl);try{const p=await db.client.mcpPreview.findUnique({where:{id:'080959b1-0413-4814-b656-9b03b187992e'},include:{account:true}});const pending=await db.client.mcpPreview.count({where:{workspaceId:p.workspaceId,provider:'GOOGLE_ADS',consumedAt:null,cancelledAt:null,expiresAt:{gt:new Date()}}});console.log(JSON.stringify({valid:p.commitStatus==='VERIFIED'&&!!p.consumedAt&&p.account.externalAccountId==='8590146099'&&pending===0}));}finally{await closeDatabase(db)}"""
    checked=json.loads(base.capture(['docker','exec','hm-'+PARENT,'node','--input-type=module','-e',js]))
    base.require(checked.get('valid') is True,'stage234_i_remove_original_or_pending_invalid')
    directory=Path(__file__).resolve().parent
    manifest={'head':opts.harness_head,'source':SOURCE,'purpose':'I_REMOVE_PREVIEW_ONLY','files':{f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in directory.glob('*.mjs')}}
    if opts.check_only:
        print(json.dumps({'result':'I_REMOVE_RUNTIME_READY_NO_PROVIDER_CALLS','real_writes':0}));return
    state=base.ROOT/'state'/('stage234-i-remove-'+opts.run_id);state.mkdir(mode=0o700);os.chown(state,1000,1000)
    sources={'fixture-context.json':parent/'protected-preview-context.json','i-origin.json':reconcile,'i-add-blocked-origin.json':original/'i-blocked-evidence.json','i-add-preview-origin.json':original/'evidence.json','runtime.env':original/'runtime.env'}
    hashes={}
    for name,path in sources.items():
        base.permissions(path);hashes[name]=hashlib.sha256(path.read_bytes()).hexdigest()
    files={name:path.read_bytes() for name,path in sources.items()}
    files['i-remove-harness-source.json']=json.dumps(manifest).encode()
    for name,data in files.items():
        fd=os.open(state/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'wb') as stream:stream.write(data)
        os.chown(state/name,1000,1000)
    # ONLY this consumed disposable gateway; preserved state is not deleted.
    base.capture(['docker','stop','--time','10','hm-'+PARENT])
    args=['docker','run','--init','--rm','-d','--name','hm-'+state.name,'--network',base.NETWORK,'--label','com.docker.compose.project='+base.PROJECT,'--label','org.holymedia.acceptance-purpose=I-remove-preview','--memory','768m','--cpus','1','--env-file',str(state/'runtime.env'),'-p','127.0.0.1:4403:4001','-v',str(directory)+':/stage234:ro','-v',str(base.ROOT/'harness')+':/acceptance:ro','-v',str(state)+':/acceptance-state/'+state.name,'--entrypoint','node']
    flags={'STAGE234_SOURCE_HEAD':SOURCE,'STAGE234_IMAGE_DIGEST':IMAGE.split('@')[1],'STAGE234_HARNESS_HEAD':opts.harness_head,'STAGE234_RUN_DIR':'/acceptance-state/'+state.name,'STAGE234_I_ORIGIN_SHA256':RECONCILE_SHA,
        'PROVIDER_GOOGLE_ADS_WRITE_ENABLED':'true','PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED':'false','PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED':'true','PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED':'false','GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST':'8590146099','PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID':'4378327049','PROVIDER_GOOGLE_API_VERSION':'v24','V2_PREVIEW_ONLY':'true','V2_CONFIRMED_WRITE_ENABLED':'false','PUBLIC_MCP_WRITE_SCOPE_ENABLED':'false','PUBLIC_MCP_CONTROLLED_WRITE_ENABLED':'false','STAGE234_GUARD_PRELOAD':'0','STAGE234_L_GUARD_PRELOAD':'0','STAGE234_I_GUARD_PRELOAD':'0','STAGE234_I_COMMIT_GUARD_PRELOAD':'0','STAGE234_COMMIT_GUARD_PRELOAD':'0','STAGE234_L_COMMIT_GUARD_PRELOAD':'0','STAGE234_I_REMOVE_GUARD_PRELOAD':'0','HOLYMEDIA_PUBLIC_BASE_URL':'http://localhost:4403','CORS_ORIGINS':'http://localhost:4403','COOKIE_DOMAIN':'','API_PORT':'4000','LOG_LEVEL':'error','NODE_OPTIONS':'--max-old-space-size=192'}
    for k,v in flags.items():args+=['-e',k+'='+v]
    try:base.capture(args+[IMAGE,'/stage234/audience-remove-runner.mjs'])
    finally:
        base.require(production==base.production_state() and envhash==hashlib.sha256((base.ROOT/'acceptance.env').read_bytes()).hexdigest(),'stage234_i_remove_production_changed')
        base.require(all(hashlib.sha256(sources[n].read_bytes()).hexdigest()==h for n,h in hashes.items()),'stage234_i_remove_history_changed')
    print(json.dumps({'result':'I_REMOVE_PREVIEW_ONLY_STARTED','state':str(state),'container':'hm-'+state.name,'real_writes_permitted':False}))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--harness-head',required=True);p.add_argument('--run-id',required=True);p.add_argument('--check-only',action='store_true')
    try:execute(p.parse_args())
    except Exception as error:
        code=str(error) if isinstance(error,RuntimeError) and re.fullmatch(r'stage234_[a-z0-9_]+',str(error)) else 'stage234_i_remove_supervisor_redacted'
        print(json.dumps({'result':'BLOCKED','code':code,'real_writes':0}));raise SystemExit(1)
