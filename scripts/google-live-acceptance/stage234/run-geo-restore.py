"""JIT stock RESTORE preview of two VERIFIED actual J criteria; never commit."""
import argparse, hashlib, importlib.util, json, os, re
from datetime import datetime, timezone
from pathlib import Path
spec=importlib.util.spec_from_file_location('base',Path(__file__).with_name('run-live.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
SOURCE='55d9df3553ff1ad01586978b6e4ecc07913969c5'
IMAGE='ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:2d7cd20cb25c268f74abd16f324d7b92ce5d804989a8de9b3fa062a0ca138d35'
PARENT='stage234-j-20261010T195000Z-jpreview1'
ORIGIN='stage234-j-commit-20261010T200600Z-jcommit1'
def assert_expired_restore(data, expected_preview, now=None):
 now=now or datetime.now(timezone.utc)
 base.require(isinstance(data,dict) and data.get('id')==expected_preview and data.get('account')=='8590146099' and data.get('operation')=='GOOGLE_STAGE3_TARGETING' and data.get('commit_status') in ['PREVIEWED','CONFIRMED'] and all(data.get(k) is None for k in ['consumed_at','attempted_at','cancelled_at']) and data.get('immutable') is True,'stage234_j_restore_expired_binding_invalid')
 try:expiry=datetime.fromisoformat(data['expires_at'].replace('Z','+00:00'))
 except (KeyError,ValueError,TypeError):raise RuntimeError('stage234_j_restore_expiry_invalid')
 base.require(expiry.tzinfo is not None and expiry<=now,'stage234_j_restore_previous_still_valid')
def execute(o):
 base.validate_options(SOURCE,IMAGE,o.run_id)
 base.require(os.geteuid()==0 and re.fullmatch(r'[a-f0-9]{40}',o.harness_head or '') and re.fullmatch(r'[a-f0-9]{64}',o.origin_sha256 or ''),'stage234_j_restore_options_invalid')
 production=base.production_state();envhash=base.inspect_ready(SOURCE,IMAGE)
 renewing=bool(o.expired_preview_run_id)
 base.require(renewing==bool(o.expired_preview_id),'stage234_j_restore_expired_options_incomplete')
 if renewing:
  base.validate_options(SOURCE,IMAGE,o.expired_preview_run_id)
  base.require(bool(re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',o.expired_preview_id or '')),'stage234_j_restore_expired_option_invalid')
 parent_name='stage234-j-restore-'+o.expired_preview_run_id if renewing else PARENT
 parent=base.ROOT/'state'/parent_name;original=base.ROOT/'state'/ORIGIN;origin=original/'j-reconciled-evidence.json'
 base.permissions(origin);base.require(hashlib.sha256(origin.read_bytes()).hexdigest()==o.origin_sha256,'stage234_j_restore_origin_hash_invalid')
 data=json.loads(origin.read_text());base.require(data.get('result')=='J add VERIFIED; restoration pending' and [c.get('criterion_id') for c in data.get('created_criteria',[])]==['9196209','2527337173874'] and data.get('journal',{}).get('result')=='VERIFIED','stage234_j_restore_origin_invalid')
 old=json.loads(base.capture(['docker','inspect','hm-'+parent_name]))[0];labels=old.get('Config',{}).get('Labels') or {}
 base.require(old.get('Name')=='/hm-'+parent_name and labels.get('com.docker.compose.project')==base.PROJECT and labels.get('org.holymedia.acceptance-purpose')==('J-restore-preview' if renewing else 'J-preview') and old.get('State',{}).get('Running') is True and old.get('NetworkSettings',{}).get('Ports',{}).get('4001/tcp')==[{'HostIp':'127.0.0.1','HostPort':'4403'}],'stage234_j_restore_parent_invalid')
 if renewing:
  base.permissions(parent/'evidence.json');previous=json.loads((parent/'evidence.json').read_text())
  base.require(previous.get('preview_id')==o.expired_preview_id and previous.get('result')=='PREVIEW_PASS_J_RESTORE_APPROVAL_PENDING' and previous.get('real_provider_write_call_count')==0 and previous.get('origin_sha256')==o.origin_sha256,'stage234_j_restore_previous_evidence_invalid')
  renewal_js="""const {createDatabase,closeDatabase}=await import('/workspace/packages/database/dist/index.js');const {loadConfig}=await import('/workspace/packages/config/dist/index.js');const {createHash}=await import('node:crypto');const {readFileSync}=await import('node:fs');const {canonical}=await import('/stage234/geo-restore-guard.mjs');const db=createDatabase(loadConfig().databaseUrl);try{const p=await db.client.mcpPreview.findUnique({where:{id:process.argv[1]},include:{account:true}});const plan=JSON.parse(readFileSync(process.env.STAGE234_RUN_DIR+'/prepared-j-restore-plan.json','utf8'));console.log(JSON.stringify(p?{id:p.id,account:p.account.externalAccountId,operation:p.operation,commit_status:p.commitStatus,consumed_at:p.consumedAt,attempted_at:p.commitAttemptedAt,cancelled_at:p.cancelledAt,expires_at:p.expiresAt,immutable:canonical(p.requestedState)===canonical(plan)&&p.snapshotDigest===createHash('sha256').update(canonical(plan)).digest('hex')}:{}));}finally{await closeDatabase(db)}"""
  assert_expired_restore(json.loads(base.capture(['docker','exec','hm-'+parent_name,'node','--input-type=module','-e',renewal_js,o.expired_preview_id])),o.expired_preview_id)
 js="""const {createDatabase,closeDatabase}=await import('/workspace/packages/database/dist/index.js');const {loadConfig}=await import('/workspace/packages/config/dist/index.js');const db=createDatabase(loadConfig().databaseUrl);try{const p=await db.client.mcpPreview.findUnique({where:{id:'3d19576c-3951-4883-833a-69aa4c6a59b4'},include:{account:true}});const k=await db.client.serviceToken.findUnique({where:{id:'2b21e15f-c015-450f-8d36-8b24ce1c6ef6'},include:{serviceIdentity:true}});const pending=await db.client.mcpPreview.count({where:{workspaceId:p.workspaceId,provider:'GOOGLE_ADS',consumedAt:null,cancelledAt:null,expiresAt:{gt:new Date()}}});console.log(JSON.stringify({valid:p.commitStatus==='VERIFIED'&&!!p.consumedAt&&p.account.externalAccountId==='8590146099'&&pending===0&&!!k&&!k.revokedAt&&!k.serviceIdentity.revokedAt&&k.expiresAt.getTime()>Date.now()&&k.serviceIdentity.workspaceId===p.workspaceId&&k.resourceAccessMode==='STATIC_ALLOWLIST'&&JSON.stringify(k.accountIds)===JSON.stringify([p.accountId])&&JSON.stringify([...k.scopes].sort())==='["adforge:mcp:read","adforge:mcp:write"]'}));}finally{await closeDatabase(db)}"""
 checked=json.loads(base.capture(['docker','exec','hm-'+parent_name,'node','--input-type=module','-e',js]));base.require(checked.get('valid') is True,'stage234_j_restore_key_pending_or_commit_invalid')
 if o.check_only:print(json.dumps({'result':'J_RESTORE_READY_NO_PROVIDER_CALLS','real_writes':0}));return
 state=base.ROOT/'state'/('stage234-j-restore-'+o.run_id);state.mkdir(mode=0o700);os.chown(state,1000,1000)
 sources={'fixture-context.json':parent/('fixture-context.json' if renewing else 'protected-preview-context.json'),'j-origin.json':origin,'j-add-blocked-origin.json':original/'blocked-evidence.json','j-add-preview-origin.json':original/'evidence.json','j-add-plan.json':original/'prepared-j-plan.json','runtime.env':original/'runtime.env'}
 hashes={}
 for name,path in sources.items():
  base.permissions(path);hashes[name]=hashlib.sha256(path.read_bytes()).hexdigest()
  fd=os.open(state/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
  with os.fdopen(fd,'wb') as f:f.write(path.read_bytes())
  os.chown(state/name,1000,1000)
 directory=Path(__file__).resolve().parent;manifest={'head':o.harness_head,'source':SOURCE,'purpose':'J_RESTORE_PREVIEW_ONLY','files':{f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in directory.glob('*.mjs')}}
 fd=os.open(state/'harness-source.json',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 with os.fdopen(fd,'w') as f:json.dump(manifest,f)
 os.chown(state/'harness-source.json',1000,1000)
 if not o.prepare_only:
  fd=os.open(parent/'j-restore-preview-launch.claim',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
  with os.fdopen(fd,'w') as f:f.write(state.name)
  base.capture(['docker','stop','--time','10','hm-'+parent_name])
 args=['docker','run','--init','--rm']+([] if o.prepare_only else ['-d'])+['--name','hm-'+state.name,'--network',base.NETWORK,'--label','com.docker.compose.project='+base.PROJECT,'--label','org.holymedia.acceptance-purpose=J-restore-preview','--memory','768m','--cpus','1','--env-file',str(state/'runtime.env')]+([] if o.prepare_only else ['-p','127.0.0.1:4403:4001'])+['-v',str(directory)+':/stage234:ro','-v',str(base.ROOT/'harness')+':/acceptance:ro','-v',str(state)+':/acceptance-state/'+state.name,'--entrypoint','node']
 flags={'STAGE234_SOURCE_HEAD':SOURCE,'STAGE234_IMAGE_DIGEST':IMAGE.split('@')[1],'STAGE234_HARNESS_HEAD':o.harness_head,'STAGE234_RUN_DIR':'/acceptance-state/'+state.name,'STAGE234_J_ORIGIN_SHA256':o.origin_sha256,'PROVIDER_GOOGLE_ADS_WRITE_ENABLED':'true','PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED':'false','PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED':'true','PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED':'false','GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST':'8590146099','PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID':'4378327049','PROVIDER_GOOGLE_API_VERSION':'v24','V2_PREVIEW_ONLY':'true','V2_CONFIRMED_WRITE_ENABLED':'false','PUBLIC_MCP_WRITE_SCOPE_ENABLED':'false','PUBLIC_MCP_CONTROLLED_WRITE_ENABLED':'false','STAGE234_GUARD_PRELOAD':'0','STAGE234_L_GUARD_PRELOAD':'0','STAGE234_I_GUARD_PRELOAD':'0','STAGE234_I_COMMIT_GUARD_PRELOAD':'0','STAGE234_COMMIT_GUARD_PRELOAD':'0','STAGE234_L_COMMIT_GUARD_PRELOAD':'0','STAGE234_I_REMOVE_GUARD_PRELOAD':'0','STAGE234_I_REMOVE_COMMIT_GUARD_PRELOAD':'0','STAGE234_J_GUARD_PRELOAD':'0','STAGE234_J_COMMIT_GUARD_PRELOAD':'0','STAGE234_J_RESTORE_GUARD_PRELOAD':'1','STAGE234_J_RESTORE_PREPARE_ONLY':'true' if o.prepare_only else 'false','STAGE234_APPROVAL_GATEWAY':'true','HOLYMEDIA_PUBLIC_BASE_URL':'http://localhost:4403','CORS_ORIGINS':'http://localhost:4403','COOKIE_DOMAIN':'','API_PORT':'4000','LOG_LEVEL':'error','NODE_OPTIONS':'--max-old-space-size=192'}
 for k,v in flags.items():args+=['-e',k+'='+v]
 try:
  outcome=base.capture(args+[IMAGE,'/stage234/geo-restore-runner.mjs'])
  if o.prepare_only:print(outcome.strip())
 finally:
  base.require(production==base.production_state() and envhash==hashlib.sha256((base.ROOT/'acceptance.env').read_bytes()).hexdigest(),'stage234_j_restore_production_changed')
  base.require(all(hashlib.sha256(path.read_bytes()).hexdigest()==hashes[name] for name,path in sources.items()),'stage234_j_restore_history_changed')
 print(json.dumps({'result':'J_RESTORE_PREPARATION_COMPLETE_NO_PREVIEW' if o.prepare_only else 'J_RESTORE_PREVIEW_STARTED','state':str(state),'real_writes_permitted':False}))
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--harness-head',required=True);p.add_argument('--origin-sha256',required=True);p.add_argument('--run-id',required=True);p.add_argument('--check-only',action='store_true');p.add_argument('--prepare-only',action='store_true');p.add_argument('--expired-preview-run-id');p.add_argument('--expired-preview-id')
 try:execute(p.parse_args())
 except Exception as e:
  code=str(e) if isinstance(e,RuntimeError) and re.fullmatch(r'stage234_[a-z0-9_]+',str(e)) else 'stage234_j_restore_supervisor_redacted'
  print(json.dumps({'result':'BLOCKED','code':code,'real_writes':0}));raise SystemExit(1)
