// Acceptance-only transport. Every actual mutation and self-approval is denied.
import {readFileSync,writeFileSync,appendFileSync,openSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonical,hierarchyQuery} from './stage0-T-after-O-20261008T183600Z-contract.mjs';
const nativeFetch=globalThis.fetch,root=()=>process.env.ACCEPTANCE_STATE_DIR??'/acceptance-state';
// Load shared query definitions now; then replace their read-only preload with
// this stricter Stage0 guard using the captured native transport exactly once.
await import('./T-after-O-reconcile-read-guard.mjs');
export const prefix='acceptance-stage0-T-live-commit-20261008T185500Z';
export const step={prefix,phase:'readiness',identity:{criterion_id:'11479221'},input:null};
export const validation=null,mutation=null;
function proof(){const p=JSON.parse(readFileSync(root()+'/'+prefix+'-arm.json','utf8')),age=Date.now()-Date.parse(p.verified_at);if(process.env.V2_PREVIEW_ONLY!=='false'||process.env.V2_CONFIRMED_WRITE_ENABLED!=='true'||process.env.PROVIDER_GOOGLE_ADS_WRITE_ENABLED!=='true'||process.env.GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST!=='8590146099'||process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED!=='false'||process.env.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED!=='false')throw Error('T_gate_invalid');if(p.customer_id!=='8590146099'||!p.test_account||p.login_customer_id!=='4378327049'||!p.hierarchy||p.preview_id!=='2c770f7a-e205-4e23-a572-193ade55c4db'||!p.approved||!p.session_valid||!p.approval_audit||!p.immutable||p.operation_count!==26||Date.parse(p.expires_at)<=Date.now()||!Number.isFinite(age)||age<0||age>300000)throw Error('T_approval_or_test_proof_invalid');}

const tables=new Set(['customer','campaign','campaign_budget','campaign_criterion','ad_group','ad_group_criterion','ad_group_ad','asset','campaign_asset','geo_target_constant','language_constant','conversion_action','customer_conversion_goal','campaign_conversion_goal','conversion_goal_campaign_config','custom_conversion_goal','shared_set','shared_criterion','campaign_shared_set']);
export function validateRequest(input,init={}){
 const u=new URL(typeof input==='string'?input:input.url??String(input)),method=(init.method??input.method??'GET').toUpperCase();
 if(u.search||u.hash||u.username||u.password)throw Error('stage0_url_blocked');

 if(u.origin==='http://127.0.0.1:4000'){
  if(method==='GET'&&['/health','/ready'].includes(u.pathname))return 'health';
  const rpc=JSON.parse(init.body??'{}'),c=JSON.parse(readFileSync(root()+'/acceptance-stage0-T-after-O-20261008T183600Z-protected-context.json','utf8'));
  if(method!=='POST'||u.pathname!=='/mcp'||rpc.jsonrpc!=='2.0'||rpc.method!=='tools/call'||new Headers(init.headers).get('authorization')!=='Bearer '+c.service_token)throw Error('T_commit_rpc_forbidden');
  if(rpc.params?.name==='list_change_journal'&&canonical(rpc.params.arguments)===canonical({provider:'GOOGLE_ADS',account_id:'8590146099',limit:30}))return 'journal';
  if(rpc.params?.name==='commit_preview'&&canonical(rpc.params.arguments)===canonical({preview_token:c.preview.preview_token})){proof();return 'commit';}
  throw Error('T_preview_approval_or_replacement_forbidden');
 }
 if(u.origin==='https://oauth2.googleapis.com'&&u.pathname==='/token'&&method==='POST'&&new URLSearchParams(init.body).get('grant_type')==='refresh_token')return 'oauth_refresh';
 if(u.origin!=='https://googleads.googleapis.com'||method!=='POST'||new Headers(init.headers).get('login-customer-id')!=='4378327049')throw Error('stage0_provider_origin_or_login_blocked');
 const body=JSON.parse(init.body??'{}');
 if(u.pathname==='/v24/customers/4378327049/googleAds:searchStream'&&canonical(body)===canonical({query:hierarchyQuery}))return 'read_mcc';
 if(u.pathname==='/v24/geoTargetConstants:suggest'&&canonical(body)===canonical({locale:'ru',countryCode:'KZ',locationNames:{names:['Алматы']}}))return 'read';
 if(u.pathname==='/v24/customers/8590146099/googleAds:searchStream'){
  const q=body.query,table=typeof q==='string'?q.match(/\sFROM\s+([a-z_]+)(?:\s|$)/i)?.[1]:null;
  if(Object.keys(body).join(',')!=='query'||typeof q!=='string'||!q.startsWith('SELECT ')||q.includes(';')||!tables.has(table)||/customers\/(?!8590146099(?:\/|$))\d+/.test(q))throw Error('stage0_query_blocked');
  return 'read';
 }

 if(u.pathname==='/v24/customers/8590146099/googleAds:mutate'){
  proof();
  const prepared=JSON.parse(readFileSync(root()+'/acceptance-stage0-readiness-v4-20261008-prepared-plan.json','utf8')),expected={mutateOperations:prepared.provider_operations,validateOnly:false,partialFailure:false};
  const arm=JSON.parse(readFileSync(root()+'/'+prefix+'-arm.json','utf8'));
  if(canonical(body)!==canonical(expected)||arm.body_digest!==createHash('sha256').update(canonical(body)).digest('hex'))throw Error('T_atomic_exact_payload_required');return 'write';
 }
 throw Error('stage0_other_account_or_mutation_blocked');
}
globalThis.fetch=async(input,init={})=>{
 const type=validateRequest(input,init);
 if(['commit','write'].includes(type)){const fd=openSync(root()+'/'+prefix+(type==='write'?'-provider-write.claim':'-mcp-commit.claim'),'wx',0o600);closeSync(fd);}
 if(['read','read_mcc','write','oauth_refresh'].includes(type))for(const n of ['provider-counts.jsonl',prefix+'-'+(process.env.ACCEPTANCE_STAGE0_MODE??'prepare')+'-calls.jsonl'])appendFileSync(root()+'/'+n,JSON.stringify({type:type==='read_mcc'?'read':type,customer:type==='oauth_refresh'?null:type==='read_mcc'?'4378327049':'8590146099',purpose:prefix})+'\n',{mode:0o600});
 const response=await nativeFetch(input,{...init,redirect:'error'});
 if(['read','read_mcc'].includes(type)&&!response.ok){
  const body=await response.clone().json(),error=(Array.isArray(body)?body[0]?.error:body.error)??body;
  const safe={http_status:response.status,status:error?.status??null,table:JSON.parse(init.body).query.match(/\sFROM\s+([a-z_]+)/i)?.[1]??null,errors:(error?.details??[]).flatMap(d=>d.errors??[]).map(e=>({google_code:e.errorCode??null,field_path:e.location?.fieldPathElements?.map(p=>p.fieldName)??[],unrecognized_field:typeof e.message==='string'?e.message.match(/Unrecognized field[^']*'([^']+)'/i)?.[1]??null:null}))};
  writeFileSync(root()+'/'+prefix+'-provider-error.json',JSON.stringify(safe),{mode:0o600,flag:'wx'});
 }
 if(type==='write')writeFileSync(root()+'/'+prefix+'-write-http-result.json',JSON.stringify({http_status:response.status,validate_only:false,partial_failure:false,operation_count:JSON.parse(init.body).mutateOperations.length}),{mode:0o600,flag:'wx'});
 return response;
};


