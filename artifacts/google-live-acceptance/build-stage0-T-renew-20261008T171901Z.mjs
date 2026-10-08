// Mechanical specialization: renew the exact expired T plan, no commits.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const base='artifacts/google-live-acceptance/stage0-readiness-v4-20261008/harness/';
const stamp=process.argv[2]??'20261008T171901Z';if(!/^20261008T\d{6}Z$/.test(stamp))throw Error('renewal_stamp_invalid');
const out='artifacts/google-live-acceptance/stage0-T-renew-'+stamp+'/harness/';
const prior='acceptance-stage0-readiness-v4-20261008';
const prefix='acceptance-stage0-T-renew-'+stamp;
mkdirSync(out,{recursive:true});
const replace=(s,a,b)=>{if(!s.includes(a))throw Error('renewal_anchor_missing');return s.replace(a,b);};
for(const n of ['stage0-v4-contract.mjs','stage0-v4-guard.mjs','stage0-v4-readiness.mjs','run-stage0-v4-readiness.py','stage0-v4-guard.test.mjs','f-restore-v2-contract.mjs','keyword-snapshot-proof.mjs','reconcile-read-guard.mjs']){
 let s=readFileSync(base+n,'utf8').replaceAll(prior,prefix).replaceAll('stage0-v4','stage0-T-renew-'+stamp);
 const name=n.replaceAll('stage0-v4','stage0-T-renew-'+stamp);
 if(n==='stage0-v4-guard.mjs'){
  s=replace(s,"root()+'/'+prefix+'-inputs.json'",`root()+'/${prior}-inputs.json'`);
  s=replace(s,"root()+'/'+prefix+'-prepared-plan.json'",`root()+'/${prior}-prepared-plan.json'`);
 }
 if(n==='stage0-v4-readiness.mjs'){
  if(stamp!=='20261008T171901Z') {
   s=replace(s,"key=old?.serviceToken,context=JSON.parse(readFileSync(root+'/fixture-context.json','utf8'))", "context=JSON.parse(readFileSync(root+'/acceptance-stage0-T-renew-20261008T172700Z-key-context.json','utf8')),key=await db.client.serviceToken.findUnique({where:{id:context.service_token_id},include:{serviceIdentity:true}})");
   s=replace(s,"key.tokenDigest!==hash(context.service_token)","key.tokenDigest!==hash(context.service_token)||key.serviceIdentity.revokedAt||key.serviceIdentity.workspaceId!==old.workspaceId||key.serviceIdentity.createdById!==old.serviceToken.serviceIdentity.createdById");
   s=replace(s,"const selected=await", "const createdKeyAudit=await db.client.auditEvent.findMany({where:{targetId:key.id,eventType:'service_token_created'},select:{success:true,actorUserId:true}});if(createdKeyAudit.length!==1||!createdKeyAudit[0].success||createdKeyAudit[0].actorUserId!==key.serviceIdentity.createdById)throw Error('stage0_fresh_principal_audit_invalid');evidence.principal_renewed_through_owner_api=true;\n const selected=await");
   s=replace(s,"if(stored.operation!=='GOOGLE_STAGE0_CAMPAIGN_CREATE'", "if(stored.serviceTokenId!==key.id||stored.operation!=='GOOGLE_STAGE0_CAMPAIGN_CREATE'");
  }
  s=replace(s,"!['prepare','preview'].includes(mode)","mode!=='preview'");
  s=replace(s,"const historyIds=[old.id,","const historyIds=[old.id,'907c2698-e4fb-4ec8-88a0-f3273e3e2b61',");
  s=replace(s,"if(!prepare&&!existsSync(root+'/'+prefix+'-preflight-evidence.json'))",`if(!existsSync(root+'/${prior}-preflight-evidence.json'))`);
  s=replace(s," const connection=await",String.raw`
 const priorPrefix='acceptance-stage0-readiness-v4-20261008';
 const expired=await db.client.mcpPreview.findUnique({where:{id:'907c2698-e4fb-4ec8-88a0-f3273e3e2b61'}});
 const previous=JSON.parse(readFileSync(root+'/'+priorPrefix+'-preview-evidence.json','utf8'));
 if(!expired||expired.workspaceId!==old.workspaceId||expired.accountId!==old.accountId||expired.operation!=='GOOGLE_STAGE0_CAMPAIGN_CREATE'||expired.expiresAt>new Date()||expired.consumedAt||expired.commitAttemptedAt||expired.cancelledAt||fingerprint(expired)!==previous.immutable_preview_fingerprint)throw Error('stage0_previous_preview_not_renewable');
 evidence.prior_preview={preview_id:expired.id,expires_at:expired.expiresAt,expired:true,confirmed:!!expired.confirmedAt,consumed:false,commit_attempted:false,immutable:true};
 const connection=await`);
  s=replace(s,"inputs=JSON.parse(readFileSync(root+'/'+prefix+'-inputs.json','utf8'))",`inputs=JSON.parse(readFileSync(root+'/${prior}-inputs.json','utf8'))`);
  s=replace(s,"JSON.parse(readFileSync(root+'/'+prefix+'-prepared-plan.json','utf8'))",`JSON.parse(readFileSync(root+'/${prior}-prepared-plan.json','utf8'))`);
  s=replace(s,"JSON.parse(readFileSync(root+'/'+prefix+'-test-proof.json','utf8'))",`JSON.parse(readFileSync(root+'/${prior}-test-proof.json','utf8'))`);
  s=replace(s,"evidence.immutable_preview_fingerprint=fingerprint(stored)","evidence.same_provider_operations_as_previous=true;evidence.immutable_preview_fingerprint=fingerprint(stored)");
  s=s.replaceAll('READ_ONLY_PLAN_PREPARED_NOT_GOOGLE_VALIDATED','PLAN_PREPARED_NOT_VALIDATED').replaceAll('BLOCKED_AT_BASE_HEAD_CAMPAIGN_PAUSE_NOT_IMPLEMENTED','base_runtime_pause_dispatch_unavailable');
 }
 if(n==='run-stage0-v4-readiness.py'){
  s=replace(s,"mode not in ('prepare','preview')","mode not in ('preview',)");
  s=replace(s,"    if mode=='commit': command+=['-e','V2_PREVIEW_ONLY=false','-e','V2_CONFIRMED_WRITE_ENABLED=true']\n",'');
 }
 if(n==='stage0-v4-guard.test.mjs') s=replace(s,"join(root,prefix+suffix+'.json')",`join(root,(['-inputs','-prepared-plan'].includes(suffix)?'${prior}':prefix)+suffix+'.json')`);
 writeFileSync(out+name,s);
}
console.log('Exact T plan renewal prepared; old approval not reused, no approval/commit capability.');
