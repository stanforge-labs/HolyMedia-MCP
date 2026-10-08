import {appendFileSync,readFileSync,writeFileSync,openSync,closeSync} from "node:fs";
import {prefix,account,args,canonical,hierarchyQuery,validationBody} from "./W-completion-contract.mjs";
const nativeFetch=globalThis.fetch, root=()=>process.env.ACCEPTANCE_STATE_DIR??"/acceptance-state";
const tables=new Set(["customer","campaign","campaign_budget","campaign_criterion","ad_group","ad_group_criterion","ad_group_ad","campaign_asset","asset","campaign_conversion_goal","customer_conversion_goal","conversion_goal_campaign_config","custom_conversion_goal","conversion_action","shared_set","shared_criterion","campaign_shared_set"]);
export function classify(input,init={},env=process.env,proof=null) {
 const u=new URL(typeof input==="string"?input:input.url??String(input)), method=(init.method??input.method??"GET").toUpperCase();
 if(u.search||u.hash||u.username||u.password)throw Error("W_url_blocked");
 if(u.origin==="http://127.0.0.1:4000"){
  if(method==="GET"&&["/health","/ready"].includes(u.pathname))return "health";
  const r=JSON.parse(init.body??"{}");
  if(method!=="POST"||u.pathname!=="/mcp"||r.method!=="tools/call"||r.jsonrpc!=="2.0"||canonical(r.params?.arguments)!==canonical(args))throw Error("W_internal_route_blocked");
  if(r.params.name==="get_launch_checklist")return "checklist";
  if(env.ACCEPTANCE_W_MODE==="preview"&&r.params.name==="preview_resume_campaign")return "preview";
  throw Error("W_commit_or_approval_blocked");
 }
 if(u.origin==="https://oauth2.googleapis.com"&&u.pathname==="/token"&&method==="POST"&&new URLSearchParams(init.body).get("grant_type")==="refresh_token")return "oauth_refresh";
 if(u.origin!=="https://googleads.googleapis.com"||method!=="POST"||new Headers(init.headers).get("login-customer-id")!=="4378327049")throw Error("W_provider_origin_or_login_blocked");
 const body=JSON.parse(init.body??"{}");
 if(u.pathname==="/v24/customers/4378327049/googleAds:searchStream"&&canonical(body)===canonical({query:hierarchyQuery}))return "read_mcc";
 if(u.pathname==="/v24/customers/8590146099/googleAds:searchStream"){
  const q=body.query,t=typeof q==="string"?q.match(/\sFROM\s+([a-z_]+)(?:\s|$)/i)?.[1]:null;
  if(Object.keys(body).join(",")!=="query"||!q?.startsWith("SELECT ")||q.includes(";")||!tables.has(t)||/customers\/(?!8590146099(?:\/|$))\d+/.test(q))throw Error("W_query_blocked");
  return "read";
 }
 if(u.pathname==="/v24/customers/8590146099/googleAds:mutate"){
  if(env.ACCEPTANCE_W_MODE!=="preview"||env.V2_PREVIEW_ONLY!=="true"||env.V2_CONFIRMED_WRITE_ENABLED!=="false"||env.PROVIDER_GOOGLE_ADS_WRITE_ENABLED!=="true"||env.GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST!=="8590146099"||env.PUBLIC_MCP_WRITE_SCOPE_ENABLED!=="false"||env.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED!=="false")throw Error("W_mutation_gate_blocked");
  if(!proof||proof.customer_id!==account||proof.test_account!==true||proof.hierarchy!==true||Date.now()-Date.parse(proof.verified_at)>300000||Date.parse(proof.verified_at)>Date.now()+1000||canonical(body)!==canonical(validationBody))throw Error("W_validation_or_proof_invalid");
  return "validate_only";
 }
 throw Error("W_other_account_or_mutation_blocked");
}
globalThis.fetch=async(input,init={})=>{
 let proof=null;
 const u=new URL(typeof input==="string"?input:input.url??String(input));
 if(u.pathname.endsWith("/googleAds:mutate"))proof=JSON.parse(readFileSync(root()+"/"+prefix+"-proof.json","utf8"));
 const type=classify(input,init,process.env,proof);
 if(type==="validate_only")closeSync(openSync(root()+"/"+prefix+"-validation.claim","wx",0o600));
 if(["read","read_mcc","validate_only","oauth_refresh"].includes(type))for(const file of ["provider-counts.jsonl",prefix+"-"+process.env.ACCEPTANCE_W_MODE+"-calls.jsonl"])appendFileSync(root()+"/"+file,JSON.stringify({type:type==="read_mcc"?"read":type,customer:type==="oauth_refresh"?null:type==="read_mcc"?"4378327049":account,purpose:prefix})+"\n",{mode:0o600});
 const response=await nativeFetch(input,{...init,redirect:"error"});
 if(type==="validate_only")writeFileSync(root()+"/"+prefix+"-validation.json",JSON.stringify({http_status:response.status,validate_only:true,partial_failure:false,operation_count:1}),{flag:"wx",mode:0o600});
 return response;
};
