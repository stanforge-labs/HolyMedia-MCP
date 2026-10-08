// Isolated stock MCP checklist/preview only. No commit or browser approval.
import {createRequire} from "node:module";import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,existsSync} from "node:fs";import {spawn} from "node:child_process";
import {prefix,account,campaign,args,canonical,hierarchyQuery,validationBody,assertWPlan} from "./W-completion-contract.mjs";
import {inventoryQuery,sharedQuery,membersQuery,linksQuery,setLinksQuery,negativesQuery} from "./W-completion-fixture-contract.mjs";
createRequire("/workspace/apps/api/package.json")("reflect-metadata");
const {loadConfig}=await import("/workspace/packages/config/dist/index.js");
const {createDatabase,closeDatabase}=await import("/workspace/packages/database/dist/index.js");
const {GoogleAdsAdapter}=await import("/workspace/apps/api/dist/providers/adapters/google.ads.js");
const {CredentialVaultService}=await import("/workspace/apps/api/dist/providers/credential-vault.service.js");
const {stage0Query,stage0ProviderOperations,verifyStage0Mutation,buildPausePlan}=await import("/workspace/apps/api/dist/providers/google-ads-stage0.js");
const config=loadConfig(),db=createDatabase(config.databaseUrl),root="/acceptance-state",head=process.argv[2],mode=process.env.ACCEPTANCE_W_MODE,hash=v=>createHash("sha256").update(v).digest("hex");
const evidence={acceptance_test:"W",phase:mode,branch:"codex/google-ads-stage01-integration-final",HEAD:head,test_customer_id:account,campaign_id:campaign,result:"BLOCKED",production_changed:false,main_changed:false};
const output=root+"/"+prefix+"-"+mode+"-evidence.json",ledger=root+"/"+prefix+"-"+mode+"-calls.jsonl";
let server,stage="config";
try{
 if(!/^[a-f0-9]{40}$/.test(head)||!["prepare","preview"].includes(mode)||existsSync(output))throw Error("W_attempt_already_exists");
 const url=new URL(config.databaseUrl);
 if(url.hostname!=="postgres"||url.pathname!=="/google_acceptance"||!config.previewOnly||config.confirmedWriteEnabled||!config.providerGoogleAdsWriteEnabled||canonical(config.googleAdsWriteAccountAllowlist)!=='["8590146099"]'||config.publicMcpWriteScopeEnabled||config.publicMcpControlledWriteEnabled||config.providerGoogleLoginCustomerId!=="4378327049"||config.providerGoogleApiVersion!=="v24")throw Error("W_isolation_config_invalid");
 const priorFile=root+"/acceptance-stage0-T-live-commit-20261008T185500Z-commit-evidence.json",prior=JSON.parse(readFileSync(priorFile,"utf8")),priorHash=hash(readFileSync(priorFile));
 if(prior.result!=="T_LIVE_COMMIT_PASS"||prior.campaign_id!==campaign||prior.commit_result.status!=="VERIFIED"||prior.independent_reread.verified_operations!==26||prior.real_provider_write_call_count!==1)throw Error("W_T_not_verified");
 const T=await db.client.mcpPreview.findUnique({where:{id:"2c770f7a-e205-4e23-a572-193ade55c4db"},include:{account:true}});
 if(!T||T.commitStatus!=="VERIFIED"||!T.consumedAt||T.account.externalAccountId!==account||!T.account.enabled)throw Error("W_T_database_mismatch");
 const context=JSON.parse(readFileSync(root+"/acceptance-stage0-T-renew-20261008T172700Z-key-context.json","utf8")),key=await db.client.serviceToken.findUnique({where:{id:context.service_token_id},include:{serviceIdentity:true}});
 if(!key||key.revokedAt||key.expiresAt<=new Date()||key.tokenDigest!==hash(context.service_token)||key.resourceAccessMode!=="STATIC_ALLOWLIST"||canonical(key.accountIds)!==canonical([T.accountId])||!key.scopes.includes("adforge:mcp:read")||!key.scopes.includes("adforge:mcp:write")||key.serviceIdentity.revokedAt||key.serviceIdentity.workspaceId!==T.workspaceId)throw Error("W_principal_invalid");
 const enabled=await db.client.providerAccount.findMany({where:{workspaceId:T.workspaceId,provider:"GOOGLE_ADS",enabled:true},select:{externalAccountId:true}});
 if(canonical(enabled)!==canonical([{externalAccountId:account}]))throw Error("W_other_account_selected");
 const pending=await db.client.mcpPreview.findMany({where:{workspaceId:T.workspaceId,provider:"GOOGLE_ADS",consumedAt:null,cancelledAt:null,expiresAt:{gt:new Date()}},select:{id:true}});
 if(pending.length)throw Error("W_pending_preview_exists");
 const ids=(await db.client.mcpPreview.findMany({where:{workspaceId:T.workspaceId},select:{id:true}})).map(r=>r.id);
 const history=async()=>({previews:await db.client.mcpPreview.findMany({where:{id:{in:ids}},orderBy:{id:"asc"}}),audits:await db.client.auditEvent.findMany({where:{targetId:{in:ids}},orderBy:{id:"asc"}})});
 const historyHash=hash(canonical(await history()));
 const connection=await db.client.providerConnection.findUnique({where:{id:T.connectionId},include:{credential:true}});
 if(!connection?.credential||connection.workspaceId!==T.workspaceId)throw Error("W_vault_unavailable");
 const adapter=new GoogleAdsAdapter(config),vault=new CredentialVaultService();
 let credentials=vault.decrypt(connection.credential.encryptedPayload,connection.credential.encryptionVersion);
 if(!credentials.scopes.includes("https://www.googleapis.com/auth/adwords"))throw Error("W_scope_missing");
 if(credentials.expiresAt&&Date.parse(credentials.expiresAt)<=Date.now()+30000)credentials=await adapter.refreshCredentials(credentials);
 const read=q=>adapter.searchStream(credentials.accessToken,account,"4378327049",q);
 stage="test_proof";
 const proof=await read("SELECT customer.id, customer.test_account, customer.currency_code, customer.time_zone FROM customer");
 if(proof.length!==1||String(proof[0].customer.id)!==account||proof[0].customer.testAccount!==true||proof[0].customer.currencyCode!=="USD")throw Error("W_test_account_unproven");
 const hierarchy=await adapter.searchStream(credentials.accessToken,"4378327049","4378327049",hierarchyQuery);
 if(hierarchy.length!==1||String(hierarchy[0].customerClient.id)!==account||Number(hierarchy[0].customerClient.level)!==1)throw Error("W_hierarchy_invalid");
 evidence.test_account=true;evidence.hierarchy=true;evidence.account_timezone=proof[0].customer.timeZone;
 const plan=T.requestedState,operations=prior.created_resources.map(r=>({success:true,resource_name:r.resource_name,error:null}));
 const readT=async()=>{
  const result=await verifyStage0Mutation(plan,operations,read);
  if(result.status!=="VERIFIED"||result.actual.length!==26||result.items.some(i=>!i.success))throw Error("W_T_structure_changed");
  return result.actual;
 };
 const readOriginal=async()=>{
  const baseline=prior.provider_state_after,fixture={},kinds={campaign_budget:"campaignBudget",campaign:"campaign",campaign_criterion:"campaignCriterion",ad_group:"adGroup",ad_group_criterion:"adGroupCriterion",ad_group_ad:"adGroupAd"};
  for(const [table,rows] of Object.entries(baseline.fixture)){
   const names=rows.map(r=>r.resourceName),kind=kinds[table];
   fixture[table]=(await read(stage0Query(kind,table+".resource_name IN ("+names.map(n=>"'"+n+"'").join(", ")+")"))).map(r=>r[kind]).map(r=>{const copy={...r};delete copy.policySummary;return copy;}).sort((a,b)=>canonical(a).localeCompare(canonical(b),"en"));
  }
  const state={fixture,campaign_negatives:await read(negativesQuery),shared_sets:await read(sharedQuery),campaign_shared_sets:await read(linksQuery),keyword_inventory:await read(inventoryQuery),shared_members:await read(membersQuery),shared_list_links:await read(setLinksQuery)};
  if(canonical(state)!==canonical(baseline))throw Error("W_original_fixture_changed");
  return state;
 };
 stage="fresh_fixture_reread";evidence.T_structure_before=await readT();const originalBefore=await readOriginal();
 evidence.original_fixture={original_keywords_enabled:20,phrase_status:"PAUSED",campaign:"PAUSED",group:"PAUSED",rsa:"PAUSED",shared_members:3,attachments:0};
 stage="stock_runtime";
 server=spawn(process.execPath,["--max-old-space-size=192","--import","/acceptance/W-completion-guard.mjs","/workspace/apps/api/dist/main.js"],{cwd:"/workspace",stdio:"ignore",env:{...process.env,LOG_LEVEL:"error"}});
 let ready=false;for(let i=0;i<35;i++){if(server.exitCode!==null)throw Error("W_runtime_start_failed");try{if((await fetch("http://127.0.0.1:4000/ready",{signal:AbortSignal.timeout(2000)})).status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}if(!ready)throw Error("W_runtime_unhealthy");
 const mcp=async(name)=>{
  const r=await fetch("http://127.0.0.1:4000/mcp",{method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream",authorization:"Bearer "+context.service_token},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}}),signal:AbortSignal.timeout(90000)});
  const rpc=await r.json(),value=rpc.result?.structuredContent??(rpc.result?.content?.[0]?.text?JSON.parse(rpc.result.content[0].text):rpc.error);
  if(!r.ok||rpc.result?.isError||rpc.error){evidence.mcp_error={http_status:r.status,code:value?.code??null};throw Error("W_mcp_failed");}return value;
 };
 stage="real_launch_checklist";const checklist=await mcp("get_launch_checklist");
 evidence.launch_checklist={ready:checklist.ready,can_resume:checklist.can_resume,checklist:checklist.checklist};
 const goal=checklist.checklist.find(c=>c.code==="conversion_goal");
 if(!goal||goal.status!=="WARNING"||checklist.ready!==false||checklist.can_resume!==true||checklist.checklist.some(c=>c.status==="FAIL"))throw Error("W_launch_checklist_blocks_resume");
 evidence.conversion_goal={status:goal.status,reason:"MANUAL_CPC missing goal warning; not conversion-based strategy or full launch readiness"};
 stage="prepare_exact_resume";const pc={accountId:account,currency:"USD",credentials,metadata:{loginCustomerId:"4378327049"}},resume=await adapter.stage0(pc,"resume",args);assertWPlan(resume);
 if(canonical({mutateOperations:stage0ProviderOperations(resume),validateOnly:true,partialFailure:false})!==canonical(validationBody))throw Error("W_wire_plan_mismatch");
 const pause=await buildPausePlan(account,args,async()=>[{campaign:{...checklist.structure.campaign,status:"ENABLED"}}]);
 if(pause.operations.length!==1||pause.operations[0].fields.status!=="PAUSED"||pause.intent.action!=="campaign_pause")throw Error("W_restore_mock_invalid");
 evidence.restore_plan_mock={status:"PASS",status_only:true,human_approval_required:true,live_run:"NOT_RUN"};evidence.resume_semantics={before:"PAUSED",after:"ENABLED",campaign_id:campaign,operation_count:1,groups_and_ads_unchanged:true,partial_failure:false};
 if(mode==="prepare"){
  writeFileSync(root+"/"+prefix+"-prepared-plan.json",JSON.stringify({plan:resume,provider_operations:stage0ProviderOperations(resume)}),{flag:"wx",mode:0o600});
  evidence.result="W_PREFLIGHT_PASS";
 }else{
  const prepared=JSON.parse(readFileSync(root+"/"+prefix+"-prepared-plan.json","utf8"));
  if(canonical(prepared.provider_operations)!==canonical(stage0ProviderOperations(resume)))throw Error("W_prepared_payload_changed");
  writeFileSync(root+"/"+prefix+"-proof.json",JSON.stringify({customer_id:account,test_account:true,hierarchy:true,verified_at:new Date().toISOString()}),{flag:"wx",mode:0o600});
  stage="JIT_stock_preview";const p=await mcp("preview_resume_campaign"),stored=await db.client.mcpPreview.findUnique({where:{id:p.preview_id}});
  if(!stored||stored.confirmedAt||stored.consumedAt||stored.expiresAt<=new Date()||stored.accountId!==T.accountId||stored.serviceTokenId!==key.id||stored.snapshotDigest!==hash(canonical(stored.requestedState))||stored.previewTokenDigest!==hash(p.preview_token))throw Error("W_preview_record_invalid");
  assertWPlan(stored.requestedState);
  if(canonical(stage0ProviderOperations(stored.requestedState))!==canonical(prepared.provider_operations)||stored.requestedState.intent.action!=="campaign_resume")throw Error("W_preview_payload_changed");
  const validation=JSON.parse(readFileSync(root+"/"+prefix+"-validation.json","utf8"));
  if(validation.http_status!==200||validation.validate_only!==true||validation.partial_failure!==false||validation.operation_count!==1)throw Error("W_validate_only_failed");
  const fingerprint=hash(canonical({payload:stored.payload,before:stored.beforeState,requested:stored.requestedState,digest:stored.snapshotDigest,expiresAt:stored.expiresAt}));
  writeFileSync(root+"/"+prefix+"-protected-context.json",JSON.stringify({service_token:context.service_token,service_token_id:key.id,preview:p,immutable_fingerprint:fingerprint}),{flag:"wx",mode:0o600});
  evidence.preview={preview_id:p.preview_id,approval_url:p.approval_url,expires_at:stored.expiresAt,confirmed:false,consumed:false,immutable_fingerprint:fingerprint,before:stored.requestedState.items[0].before,after:stored.requestedState.items[0].after,warnings:stored.requestedState.items[0].warnings};evidence.validation=validation;evidence.result="W_PREVIEW_WAITING_FOR_APPROVAL";
 }
 stage="no_provider_change";evidence.T_structure_after=await readT();await readOriginal();
 if(canonical(evidence.T_structure_before)!==canonical(evidence.T_structure_after)||canonical(originalBefore)!==canonical(prior.provider_state_after))throw Error("W_preview_side_effect");
 if(historyHash!==hash(canonical(await history()))||priorHash!==hash(readFileSync(priorFile)))throw Error("W_history_changed");
 evidence.provider_unchanged=true;evidence.audit_history_unchanged=true;evidence.final_campaign_status="PAUSED";
}catch(error){evidence.result="BLOCKED";evidence.failure_stage=stage;evidence.code=/^[A-Za-z0-9_]+$/.test(error.message)?error.message:"W_internal_error";evidence.error_class=error.constructor.name;process.exitCode=1;}
finally{
 if(server){server.kill("SIGTERM");await new Promise(r=>{server.once("exit",r);setTimeout(r,5000);});if(server.exitCode===null)server.kill("SIGKILL");}
 const events=existsSync(ledger)?readFileSync(ledger,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse):[];
 evidence.provider_read_call_count=events.filter(e=>e.type==="read").length;evidence.validate_only_call_count=events.filter(e=>e.type==="validate_only").length;evidence.real_provider_write_call_count=events.filter(e=>e.type==="write").length;evidence.oauth_refresh_call_count=events.filter(e=>e.type==="oauth_refresh").length;evidence.timestamp=new Date().toISOString();
 if(evidence.real_provider_write_call_count!==0){evidence.result="BLOCKED";evidence.code="W_write_invariant";process.exitCode=1;}
 writeFileSync(output,JSON.stringify(evidence),{flag:"wx",mode:0o600});
 console.log(JSON.stringify({result:evidence.result,failure_stage:evidence.failure_stage,code:evidence.code,checklist:evidence.launch_checklist,preview:evidence.preview,calls:[evidence.provider_read_call_count,evidence.validate_only_call_count,evidence.real_provider_write_call_count]}));await closeDatabase(db);
}
