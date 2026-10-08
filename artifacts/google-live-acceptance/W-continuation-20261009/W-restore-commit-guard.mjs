import {readFileSync,writeFileSync,appendFileSync,openSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {account,args,canonical,hierarchyQuery} from './W-completion-contract.mjs';
const operation={campaignOperation:{update:{resourceName:'customers/8590146099/campaigns/24339483523',status:'PAUSED'},updateMask:'status'}};
export const continuationPrefix='acceptance-stage0-W-restore-commit-20261009';
const native=globalThis.fetch,root=()=>process.env.ACCEPTANCE_STATE_DIR??'/acceptance-state';
const tables=new Set(['customer','campaign','campaign_budget','campaign_criterion','ad_group','ad_group_criterion','ad_group_ad','asset','campaign_asset','conversion_action','customer_conversion_goal','campaign_conversion_goal','conversion_goal_campaign_config','custom_conversion_goal','shared_set','shared_criterion','campaign_shared_set']);
export function assertArm(arm,env=process.env){
 const age=Date.now()-Date.parse(arm?.verified_at);
 if(env.PROVIDER_GOOGLE_ADS_WRITE_ENABLED!=='true'||env.GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST!==account||env.PUBLIC_MCP_WRITE_SCOPE_ENABLED!=='false'||env.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED!=='false'||arm?.customer_id!==account||arm?.test_account!==true||arm?.hierarchy!==true||!Number.isFinite(age)||age<0||age>300000)throw Error('W_test_proof_invalid');
 if(env.ACCEPTANCE_W_MODE==='commit'&&(env.V2_PREVIEW_ONLY!=='false'||env.V2_CONFIRMED_WRITE_ENABLED!=='true'||arm.preview_id!=='7624ef9e-295f-4148-9824-b42e8ac218a6'||!arm.approved||!arm.session_valid||!arm.approval_audit||!arm.immutable||!arm.stale_protection||Date.parse(arm.expires_at)<=Date.now()))throw Error('W_commit_approval_invalid');
 if(env.ACCEPTANCE_W_MODE==='restorepreview'&&(env.V2_PREVIEW_ONLY!=='true'||env.V2_CONFIRMED_WRITE_ENABLED!=='false'))throw Error('W_restore_preview_gate_invalid');
}
export function classify(input,init={},env=process.env,arm=null,context=null){
 const u=new URL(typeof input==='string'?input:input.url??String(input)),method=(init.method??input.method??'GET').toUpperCase();
 if(u.search||u.hash||u.username||u.password)throw Error('W_url_blocked');
 if(u.origin==='http://127.0.0.1:4000'){
  if(method==='GET'&&['/health','/ready'].includes(u.pathname))return 'health';
  const r=JSON.parse(init.body??'{}');
  if(method!=='POST'||u.pathname!=='/mcp'||r.jsonrpc!=='2.0'||r.method!=='tools/call'||!context||new Headers(init.headers).get('authorization')!=='Bearer '+context.service_token)throw Error('W_rpc_context_invalid');
  if(r.params?.name==='list_change_journal'&&canonical(r.params.arguments)===canonical({provider:'GOOGLE_ADS',account_id:account,limit:30}))return 'journal';
  assertArm(arm,env);
  if(env.ACCEPTANCE_W_MODE==='commit'&&r.params?.name==='commit_preview'&&canonical(r.params.arguments)===canonical({preview_token:context.preview.preview_token}))return 'commit';
  if(env.ACCEPTANCE_W_MODE==='restorepreview'&&r.params?.name==='preview_pause_campaign'&&canonical(r.params.arguments)===canonical(args))return 'preview';
  throw Error('W_other_rpc_or_self_approval_blocked');
 }
 if(u.origin==='https://oauth2.googleapis.com'&&u.pathname==='/token'&&method==='POST'&&new URLSearchParams(init.body).get('grant_type')==='refresh_token')return 'oauth_refresh';
 if(u.origin!=='https://googleads.googleapis.com'||method!=='POST'||new Headers(init.headers).get('login-customer-id')!=='4378327049')throw Error('W_provider_origin_blocked');
 const body=JSON.parse(init.body??'{}');
 if(u.pathname==='/v24/customers/4378327049/googleAds:searchStream'&&canonical(body)===canonical({query:hierarchyQuery}))return 'read_mcc';
 if(u.pathname==='/v24/customers/8590146099/googleAds:searchStream'){
  const q=body.query,t=typeof q==='string'?q.match(/\sFROM\s+([a-z_]+)(?:\s|$)/i)?.[1]:null;
  if(Object.keys(body).join(',')!=='query'||!q?.startsWith('SELECT ')||q.includes(';')||!tables.has(t)||/customers\/(?!8590146099(?:\/|$))\d+/.test(q))throw Error('W_read_query_blocked');
  return 'read';
 }
 if(u.pathname==='/v24/customers/8590146099/googleAds:mutate'){
  assertArm(arm,env);
  const isCommit=env.ACCEPTANCE_W_MODE==='commit';
  const op=isCommit?operation:{campaignOperation:{update:{resourceName:operation.campaignOperation.update.resourceName,status:'PAUSED'},updateMask:'status'}};
  const expected={mutateOperations:[op],validateOnly:!isCommit,partialFailure:false};
  if(!['commit','restorepreview'].includes(env.ACCEPTANCE_W_MODE)||canonical(body)!==canonical(expected)||arm.body_digest!==createHash('sha256').update(canonical(body)).digest('hex'))throw Error('W_exact_status_only_payload_required');
  return isCommit?'write':'validate_only';
 }
 throw Error('W_other_account_or_mutation_blocked');
}
globalThis.fetch=async(input,init={})=>{
 const u=new URL(typeof input==='string'?input:input.url??String(input));
 const needsArm=u.pathname.endsWith('/googleAds:mutate')||u.pathname==='/mcp';
 const arm=needsArm?JSON.parse(readFileSync(root()+'/'+continuationPrefix+'-'+process.env.ACCEPTANCE_W_MODE+'-arm.json','utf8')):null;
 const context=u.pathname==='/mcp'?JSON.parse(readFileSync(root()+'/acceptance-stage0-W-continuation-rerun-20261009-restore-protected-context.json','utf8')):null;
 const type=classify(input,init,process.env,arm,context);
 if(['write','commit','validate_only'].includes(type))closeSync(openSync(root()+'/'+continuationPrefix+'-'+(type==='write'?'provider-write':type==='commit'?'mcp-commit':'validation')+'.claim','wx',0o600));
 if(['read','read_mcc','write','validate_only','oauth_refresh'].includes(type))for(const name of ['provider-counts.jsonl',continuationPrefix+'-'+process.env.ACCEPTANCE_W_MODE+'-calls.jsonl'])appendFileSync(root()+'/'+name,JSON.stringify({type:type==='read_mcc'?'read':type,customer:type==='oauth_refresh'?null:type==='read_mcc'?'4378327049':account,purpose:continuationPrefix})+'\n',{mode:0o600});
 const response=await native(input,{...init,redirect:'error'});
 if(type==='write'||type==='validate_only')writeFileSync(root()+'/'+continuationPrefix+'-'+type+'-http.json',JSON.stringify({http_status:response.status,validate_only:type==='validate_only',partial_failure:false,operation_count:1}),{flag:'wx',mode:0o600});
 return response;
};
