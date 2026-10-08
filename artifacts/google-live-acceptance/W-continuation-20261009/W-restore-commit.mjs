import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {approvalProof,hash,fingerprint} from './W-restore-approval-proof.mjs';
import {prefix,account,campaign,args,canonical,hierarchyQuery} from './W-completion-contract.mjs';
import {continuationPrefix} from './W-restore-commit-guard.mjs';
const operation={campaignOperation:{update:{resourceName:'customers/8590146099/campaigns/24339483523',status:'PAUSED'},updateMask:'status'}};
import {inventoryQuery,sharedQuery,membersQuery,linksQuery,setLinksQuery,negativesQuery} from './W-completion-fixture-contract.mjs';
const {loadConfig}=await import('/workspace/packages/config/dist/index.js'),{createDatabase,closeDatabase}=await import('/workspace/packages/database/dist/index.js'),{GoogleAdsAdapter}=await import('/workspace/apps/api/dist/providers/adapters/google.ads.js'),{CredentialVaultService}=await import('/workspace/apps/api/dist/providers/credential-vault.service.js'),{stage0Query,stage0ProviderOperations,verifyStage0Mutation,rereadStage0Checks}=await import('/workspace/apps/api/dist/providers/google-ads-stage0.js');
const config=loadConfig(),db=createDatabase(config.databaseUrl),root='/acceptance-state',mode=process.env.ACCEPTANCE_W_MODE,head=process.argv[2],commit=mode==='commit',output=root+'/'+continuationPrefix+'-'+mode+'-evidence.json';
let server,stage='preflight';
const evidence={acceptance_test:'W',phase:mode,branch:'codex/google-ads-stage01-integration-final',HEAD:head,test_customer_id:account,campaign_id:campaign,result:'BLOCKED',production_changed:false,main_changed:false};
try{
 if(!/^[a-f0-9]{40}$/.test(head??'')||!['commit','restorepreview'].includes(mode)||existsSync(output))throw Error('W_attempt_invalid');
 let approved,context,key,approval;
 if(commit){const p=await approvalProof(db,config);approved=p.row;context=p.context;key=p.key;approval=p.safe;evidence.approval=approval;}
 else{
  context=JSON.parse(readFileSync(root+'/'+prefix+'-protected-context.json','utf8'));
  approved=await db.client.mcpPreview.findUnique({where:{id:context.preview.preview_id},include:{account:true}});
  key=await db.client.serviceToken.findUnique({where:{id:context.service_token_id},include:{serviceIdentity:true}});
  const u=new URL(config.databaseUrl),previous=JSON.parse(readFileSync(root+'/'+continuationPrefix+'-commit-evidence.json','utf8'));
  if(previous.result!=='W_RESUME_COMMIT_VERIFIED'||u.hostname!=='postgres'||u.pathname!=='/google_acceptance'||!config.previewOnly||config.confirmedWriteEnabled||!config.providerGoogleAdsWriteEnabled||canonical(config.googleAdsWriteAccountAllowlist)!=='["8590146099"]'||config.publicMcpWriteScopeEnabled||config.publicMcpControlledWriteEnabled||config.providerGoogleLoginCustomerId!=='4378327049'||config.providerGoogleApiVersion!=='v24'||approved?.commitStatus!=='VERIFIED'||!approved.consumedAt||approved.account.externalAccountId!==account||!approved.account.enabled||!key||key.revokedAt||key.expiresAt<=new Date()||key.tokenDigest!==hash(context.service_token)||key.resourceAccessMode!=='STATIC_ALLOWLIST'||canonical(key.accountIds)!==canonical([approved.accountId])||key.serviceIdentity.revokedAt||key.serviceIdentity.workspaceId!==approved.workspaceId)throw Error('W_restore_principal_or_state_invalid');
  const pending=await db.client.mcpPreview.findMany({where:{workspaceId:approved.workspaceId,provider:'GOOGLE_ADS',consumedAt:null,cancelledAt:null,expiresAt:{gt:new Date()}},select:{id:true}});if(pending.length)throw Error('W_other_preview_pending');
 }
 if(config.previewOnly===commit||config.confirmedWriteEnabled!==commit)throw Error('W_controlled_process_flags_invalid');
 const priorFile=root+'/acceptance-stage0-T-live-commit-20261008T185500Z-commit-evidence.json',prior=JSON.parse(readFileSync(priorFile,'utf8')),priorHash=hash(readFileSync(priorFile));
 const T=await db.client.mcpPreview.findUnique({where:{id:'2c770f7a-e205-4e23-a572-193ade55c4db'}});
 if(prior.result!=='T_LIVE_COMMIT_PASS'||T?.commitStatus!=='VERIFIED'||!T.consumedAt)throw Error('W_T_not_verified');
 const ids=(await db.client.mcpPreview.findMany({where:{workspaceId:approved.workspaceId,id:{not:approved.id}},select:{id:true}})).map(r=>r.id);
 const history=async()=>({previews:await db.client.mcpPreview.findMany({where:{id:{in:ids}},orderBy:{id:'asc'}}),audits:await db.client.auditEvent.findMany({where:{targetId:{in:ids}},orderBy:{id:'asc'}})});
 const historyHash=hash(canonical(await history()));
 const connection=await db.client.providerConnection.findUnique({where:{id:approved.connectionId},include:{credential:true}});
 if(!connection?.credential||connection.workspaceId!==approved.workspaceId)throw Error('W_vault_missing');
 const adapter=new GoogleAdsAdapter(config),vault=new CredentialVaultService();let credentials=vault.decrypt(connection.credential.encryptedPayload,connection.credential.encryptionVersion);
 if(!credentials.scopes.includes('https://www.googleapis.com/auth/adwords'))throw Error('W_scope_missing');
 if(credentials.expiresAt&&Date.parse(credentials.expiresAt)<=Date.now()+30000)credentials=await adapter.refreshCredentials(credentials);
 const read=q=>adapter.searchStream(credentials.accessToken,account,'4378327049',q);
 stage='test_account_and_hierarchy';
 const proof=await read('SELECT customer.id, customer.test_account, customer.currency_code, customer.time_zone FROM customer'),h=await adapter.searchStream(credentials.accessToken,'4378327049','4378327049',hierarchyQuery);
 if(proof.length!==1||String(proof[0].customer.id)!==account||proof[0].customer.testAccount!==true||proof[0].customer.currencyCode!=='USD'||h.length!==1||String(h[0].customerClient.id)!==account||Number(h[0].customerClient.level)!==1)throw Error('W_test_proof_invalid');
 evidence.test_account=true;evidence.hierarchy=true;
 const readOriginal=async()=>{
  const baseline=prior.provider_state_after,fixture={},kinds={campaign_budget:'campaignBudget',campaign:'campaign',campaign_criterion:'campaignCriterion',ad_group:'adGroup',ad_group_criterion:'adGroupCriterion',ad_group_ad:'adGroupAd'};
  for(const [table,rows] of Object.entries(baseline.fixture)){const names=rows.map(r=>r.resourceName),kind=kinds[table];fixture[table]=(await read(stage0Query(kind,table+'.resource_name IN ('+names.map(n=>"'"+n+"'").join(', ')+')'))).map(r=>r[kind]).map(r=>{const copy={...r};delete copy.policySummary;return copy;}).sort((a,b)=>canonical(a).localeCompare(canonical(b),'en'));}
  const s={fixture,campaign_negatives:await read(negativesQuery),shared_sets:await read(sharedQuery),campaign_shared_sets:await read(linksQuery),keyword_inventory:await read(inventoryQuery),shared_members:await read(membersQuery),shared_list_links:await read(setLinksQuery)};
  if(canonical(s)!==canonical(baseline))throw Error('W_original_fixture_changed');return s;
 };
 const readT=async(status)=>{
  // Verification-only copy reflects the separately approved campaign status change.
  // The immutable historical T plan and its evidence are never modified.
  const verificationPlan=structuredClone(T.requestedState);verificationPlan.operations.find(o=>o.kind==='campaign').expected.status=status;
  const result=await verifyStage0Mutation(verificationPlan,prior.created_resources.map(r=>({success:true,resource_name:r.resource_name,error:null})),read);
  if(result.status!=='VERIFIED'||result.actual.length!==26||result.items.some(r=>!r.success))throw Error('W_T_structure_unverified');
  const groups=verificationPlan.operations.flatMap((o,i)=>o.kind==='adGroup'?[result.actual[i]]:[]),ads=verificationPlan.operations.flatMap((o,i)=>o.kind==='adGroupAd'?[result.actual[i]]:[]);
  if(groups.length!==2||ads.length!==2||groups.some(g=>g.status!=='PAUSED')||ads.some(a=>a.status!=='PAUSED')||result.actual[1].status!==status)throw Error('W_parent_status_invariant');return result.actual;
 };
 stage='provider_preflight';evidence.structure_before=await readT('ENABLED');const originalBefore=await readOriginal();
 if(commit){
  stage='fresh_stale_snapshot';const checks=await rereadStage0Checks(approved.requestedState,read);
  if(canonical(checks)!==canonical(approved.requestedState.checks))throw Error('W_stale_snapshot_stop_no_write');
  const p=await approvalProof(db,config);if(fingerprint(p.row)!==fingerprint(approved))throw Error('W_approval_changed_before_commit');
 }
 const body={mutateOperations:commit?[operation]:[{campaignOperation:{update:{resourceName:operation.campaignOperation.update.resourceName,status:'PAUSED'},updateMask:'status'}}],validateOnly:!commit,partialFailure:false};
 if(commit&&canonical(stage0ProviderOperations(approved.requestedState))!==canonical(body.mutateOperations))throw Error('W_exact_body_changed');
 evidence.exact_semantics={before:'ENABLED',after:'PAUSED',operation_count:1,partial_failure:false,groups_and_ads_unchanged:true};
 writeFileSync(root+'/'+continuationPrefix+'-'+mode+'-arm.json',JSON.stringify({customer_id:account,test_account:true,hierarchy:true,verified_at:new Date().toISOString(),preview_id:approved.id,approved:commit,session_valid:commit,approval_audit:commit,immutable:true,stale_protection:commit,expires_at:approved.expiresAt.toISOString(),body_digest:hash(canonical(body))}),{mode:0o600,flag:'wx'});
 stage='stock_mcp_runtime';server=spawn(process.execPath,['--max-old-space-size=192','--import','/acceptance/W-restore-commit-guard.mjs','/workspace/apps/api/dist/main.js'],{cwd:'/workspace',stdio:'ignore',env:{...process.env,LOG_LEVEL:'error'}});
 let healthy=false;for(let i=0;i<35;i++){if(server.exitCode!==null)throw Error('W_runtime_failed');try{if((await fetch('http://127.0.0.1:4000/ready',{signal:AbortSignal.timeout(2000)})).status===200){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}if(!healthy)throw Error('W_runtime_unhealthy');
 const mcp=async(name,input)=>{const r=await fetch('http://127.0.0.1:4000/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer '+context.service_token},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:input}}),signal:AbortSignal.timeout(90000)}),rpc=await r.json(),v=rpc.result?.structuredContent??(rpc.result?.content?.[0]?.text?JSON.parse(rpc.result.content[0].text):rpc.error);if(!r.ok||rpc.result?.isError||rpc.error){evidence.mcp_error={http_status:r.status,code:v?.code??null};throw Error('W_mcp_error_stop_no_retry');}return v;};
 if(commit){
  stage='single_immutable_commit';const result=await mcp('commit_preview',{preview_token:context.preview.preview_token});evidence.commit_result=result;
  writeFileSync(root+'/'+continuationPrefix+'-commit-result.json',JSON.stringify(result),{mode:0o600,flag:'wx'});
  const operations=result.items?.flatMap(i=>i.operations??[])??[];
  if(result.status!=='VERIFIED'||result.preview_id!==approved.id||result.account_id!==account||result.operation_count!==1||result.partial_failure!==false||result.atomic!==true||operations.length!==1||!operations[0].success||operations[0].resource_name!==operation.campaignOperation.update.resourceName)throw Error('W_commit_unverified_stop_no_retry');
  stage='independent_reread';const v=await verifyStage0Mutation(approved.requestedState,operations.map(o=>({success:true,resource_name:o.resource_name,error:null})),read);
  if(v.status!=='VERIFIED'||v.actual[0]?.status!=='PAUSED')throw Error('W_independent_reread_unverified');
  evidence.independent_reread=v;evidence.commit_id=result.commit_id;
  const stored=await db.client.mcpPreview.findUnique({where:{id:approved.id}});if(!stored.consumedAt||!stored.commitAttemptedAt||stored.commitStatus!=='VERIFIED'||fingerprint(stored)!==context.immutable_fingerprint)throw Error('W_consumed_record_invalid');
  stage='audit_journal';const journal=await mcp('list_change_journal',{provider:'GOOGLE_ADS',account_id:account,limit:30}),entry=journal.items?.find(r=>r.preview_id===approved.id&&r.commit_id===result.commit_id);
  const a=await db.client.auditEvent.findMany({where:{targetId:approved.id},orderBy:{createdAt:'asc'}}),success=a.filter(r=>r.eventType==='mcp_google_stage1_operation'&&r.success&&r.metadata?.result==='success'&&r.metadata?.operation==='campaign_pause'),events=a.filter(r=>r.eventType==='mcp_google_commit_result'&&r.success&&r.metadata?.result==='VERIFIED'&&r.metadata?.commitId===result.commit_id);
  if(!entry||entry.result!=='VERIFIED'||entry.operation!=='GOOGLE_STAGE0_CAMPAIGN_PAUSE'||success.length!==1||events.length!==1)throw Error('W_audit_journal_missing');
  evidence.audit_journal={entry,successful_operations:1,result_events:1};evidence.preview_id=approved.id;evidence.result='W_RESTORE_COMMIT_VERIFIED';
 }else{
  stage='JIT_restore_preview';const p=await mcp('preview_pause_campaign',args),stored=await db.client.mcpPreview.findUnique({where:{id:p.preview_id}});
  if(!stored||stored.confirmedAt||stored.consumedAt||stored.expiresAt<=new Date()||stored.serviceTokenId!==key.id||stored.accountId!==approved.accountId||stored.operation!=='GOOGLE_STAGE0_CAMPAIGN_PAUSE'||stored.snapshotDigest!==hash(canonical(stored.requestedState))||stored.previewTokenDigest!==hash(p.preview_token)||canonical(stage0ProviderOperations(stored.requestedState))!==canonical(body.mutateOperations))throw Error('W_restore_preview_invalid');
  const validation=JSON.parse(readFileSync(root+'/'+continuationPrefix+'-validate_only-http.json','utf8'));if(validation.http_status!==200||validation.validate_only!==true||validation.partial_failure!==false||validation.operation_count!==1)throw Error('W_restore_validation_failed');
  writeFileSync(root+'/'+continuationPrefix+'-restore-protected-context.json',JSON.stringify({service_token:context.service_token,service_token_id:key.id,preview:p,immutable_fingerprint:fingerprint(stored)}),{mode:0o600,flag:'wx'});
  evidence.preview={preview_id:p.preview_id,approval_url:p.approval_url,expires_at:stored.expiresAt,confirmed:false,consumed:false,immutable_fingerprint:fingerprint(stored),before:stored.requestedState.items[0].before,after:stored.requestedState.items[0].after};evidence.validation=validation;evidence.result='W_RESTORE_WAITING_FOR_MANUAL_APPROVAL';
 }
 stage='full_post_reread';evidence.structure_after=await readT('PAUSED');const originalAfter=await readOriginal();
 const normalize=s=>s.map((r,i)=>{const x=structuredClone(r);delete x.policySummary;if(i===1)delete x.status;return x;});
 if(canonical(normalize(evidence.structure_before))!==canonical(normalize(evidence.structure_after))||canonical(originalBefore)!==canonical(originalAfter))throw Error('W_unexpected_side_effect');
 evidence.original_fixture_unchanged=true;evidence.final_campaign_status='PAUSED';evidence.ad_group_statuses=['PAUSED','PAUSED'];evidence.rsa_statuses=['PAUSED','PAUSED'];
 evidence.all_test_campaigns=await read('SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.status != REMOVED');
 if(evidence.all_test_campaigns.some(r=>r.campaign.status!=='PAUSED'))throw Error('W_active_test_campaign_remains');
 if(historyHash!==hash(canonical(await history()))||priorHash!==hash(readFileSync(priorFile)))throw Error('W_historical_evidence_changed');evidence.history_unchanged=true;
}catch(e){evidence.result='BLOCKED';evidence.failure_stage=stage;evidence.code=/^[A-Za-z0-9_]+$/.test(e.message)?e.message:'W_internal_error';evidence.error_class=e.constructor.name;process.exitCode=1;}
finally{
 if(server){server.kill('SIGTERM');await new Promise(r=>{server.once('exit',r);setTimeout(r,5000);});if(server.exitCode===null)server.kill('SIGKILL');}
 const ledger=root+'/'+continuationPrefix+'-'+mode+'-calls.jsonl',events=existsSync(ledger)?readFileSync(ledger,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 evidence.provider_read_call_count=events.filter(r=>r.type==='read').length;evidence.validate_only_call_count=events.filter(r=>r.type==='validate_only').length;evidence.real_provider_write_call_count=events.filter(r=>r.type==='write').length;evidence.oauth_refresh_call_count=events.filter(r=>r.type==='oauth_refresh').length;evidence.timestamp=new Date().toISOString();
 if(evidence.result!=='BLOCKED'&&(evidence.real_provider_write_call_count!==(commit?1:0)||evidence.validate_only_call_count!==(commit?0:1))){evidence.result='BLOCKED';evidence.code='W_call_accounting_invariant';process.exitCode=1;}
 writeFileSync(output,JSON.stringify(evidence),{mode:0o600,flag:'wx'});console.log(JSON.stringify({result:evidence.result,failure_stage:evidence.failure_stage,code:evidence.code,commit_id:evidence.commit_id,preview:evidence.preview,current_campaign_state:evidence.final_campaign_status,groups:evidence.ad_group_statuses,RSA:evidence.rsa_statuses,calls:[evidence.provider_read_call_count,evidence.validate_only_call_count,evidence.real_provider_write_call_count]}));await closeDatabase(db);
}
