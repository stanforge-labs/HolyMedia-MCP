// Mechanical reuse of proven isolated full-fixture verification. No network.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const src='artifacts/google-live-acceptance/f-restore-v2-20261008/harness/',out='artifacts/google-live-acceptance/stage0-readiness-20261008/harness/';mkdirSync(out,{recursive:true});
const read=n=>readFileSync(src+n,'utf8'),write=(n,s)=>writeFileSync(out+n,s);
function replace(s,a,b){if(!s.includes(a))throw Error('specialization_anchor_missing');return s.replace(a,b);}
let source=read('f-restore-v2.mjs');
const stop=source.indexOf(" stage='provider_before';");if(stop<0)throw Error('provider_anchor_missing');
source=source.slice(0,stop);
source=source.replaceAll('f-restore-v2-guard.mjs','stage0-guard.mjs').replaceAll('ACCEPTANCE_F_RESTORE_MODE','ACCEPTANCE_STAGE0_MODE');
source=replace(source,"commit=mode==='commit'","commit=false");
source=replace(source,"['prepare','preview','commit'].includes(mode)","['prepare','preview'].includes(mode)");
source=replace(source,"callsName=prefix+(commit?'-commit':'-preview')+'-calls.jsonl'","callsName=prefix+'-'+mode+'-calls.jsonl'");
source=replace(source,"acceptance_test:'F',phase:'RESTORE_'+step.phase.toUpperCase()","acceptance_test:'STAGE0_T_U_V_W',phase:mode");
source=replace(source,"if(step.phase==='new'){const oldRestore=JSON.parse(readFileSync(root+'/acceptance-f-restore-v2-old-commit-evidence.json','utf8'));if(oldRestore.result!=='F_RESTORE_OLD_PASS'||oldRestore.commit_result.status!=='VERIFIED')throw Error('f_old_not_restored');baseline=oldRestore.provider_state_after_commit;}","const restored=JSON.parse(readFileSync(root+'/acceptance-f-restore-v2-new-commit-evidence.json','utf8'));if(restored.result!=='F_RESTORE_NEW_PASS'||restored.commit_result.status!=='VERIFIED')throw Error('f_not_restored');baseline=restored.provider_state_after_commit;");
source=replace(source,"if(step.phase==='new')files.push('acceptance-f-restore-v2-old-commit-evidence.json');","files.push('acceptance-f-restore-v2-old-commit-evidence.json','acceptance-f-restore-v2-new-commit-evidence.json');");
const as=source.indexOf(' if(commit){'),ae=source.indexOf(' const pending=',as);source=source.slice(0,as)+source.slice(ae);
source=replace(source,"if(pending!==(commit?1:0))throw Error('f_restore_another_preview_pending');","if(!prepare&&pending!==0)throw Error('stage0_another_preview_pending');");
source+=String.raw`
 stage='fixture_before';const beforeState=await readState();if(canonical(beforeState)!==canonical(baseline))throw Error('stage0_fixture_changed');evidence.provider_state_before=beforeState;
 const {makeBrief,invalidBrief,assertTPlan,hierarchyQuery}=await import('/acceptance/stage0-contract.mjs');
 const {stage0ProviderOperations,normalizeBrief}=await import('/workspace/apps/api/dist/providers/google-ads-stage0.js');
 stage='hierarchy_proof';const hierarchy=await adapter.searchStream(credentials.accessToken,'4378327049','4378327049',hierarchyQuery);
 if(hierarchy.length!==1||String(hierarchy[0].customerClient.id)!=='8590146099'||Number(hierarchy[0].customerClient.level)!==1)throw Error('stage0_hierarchy_invalid');
 const currency=proof[0].customer.currencyCode;if(currency!=='USD')throw Error('stage0_unexpected_currency');
 let inputs;
 if(prepare){const stamp=new Date().toISOString().slice(0,19).replace(/[-:]/g,'')+'Z',brief=makeBrief(stamp,currency);inputs={brief,invalid:invalidBrief(brief)};writeFileSync(root+'/'+prefix+'-inputs.json',JSON.stringify(inputs),{mode:0o600,flag:'wx'});}
 else {inputs=JSON.parse(readFileSync(root+'/'+prefix+'-inputs.json','utf8'));writeFileSync(root+'/'+prefix+'-preview-test-proof.json',JSON.stringify({customer_id:'8590146099',test_account:true,hierarchy:true,verified_at:new Date().toISOString()}),{mode:0o600,flag:'wx'});}
 stage='stock_runtime';server=spawn(process.execPath,['--max-old-space-size=192','--import','/acceptance/stage0-guard.mjs','/workspace/apps/api/dist/main.js'],{cwd:'/workspace',stdio:'ignore',env:{...process.env,LOG_LEVEL:'error'}});
 let healthy=false;for(let i=0;i<35;i++){if(server.exitCode!==null)throw Error('stage0_runtime_start_failed');try{if((await fetch('http://127.0.0.1:4000/ready',{signal:AbortSignal.timeout(2000)})).status===200){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}if(!healthy)throw Error('stage0_runtime_not_ready');
 const mcp=async(name,args,allowError=false)=>{const r=await fetch('http://127.0.0.1:4000/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer '+context.service_token},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(60000)});const rpc=await r.json(),value=rpc.result?.structuredContent??(rpc.result?.content?.[0]?.text?JSON.parse(rpc.result.content[0].text):rpc.error);if(!r.ok||rpc.error||rpc.result?.isError){evidence.last_mcp_error={tool:name,http_status:r.status,code:value?.code??null,message:value?.message??null,google_errors:value?.google_errors??[]};if(allowError)return {failed:true,code:value?.code??null,message:value?.message??null};throw Error('stage0_mcp_failed');}return {failed:false,value};};
 if(prepare){
  stage='U_invalid_rsa';const beforeCalls=calls().length,count=await db.client.mcpPreview.count({where:{workspaceId:old.workspaceId}}),u=await mcp('create_campaign_from_brief',inputs.invalid,true);
  if(!u.failed||u.code!=='google_brief_invalid'||calls().length!==beforeCalls||await db.client.mcpPreview.count({where:{workspaceId:old.workspaceId}})!==count)throw Error('stage0_U_validation_invariant_failed');
  evidence.U={status:'LIVE_INPUT_REJECTION_PASS',result:u,field_intent:'ad_groups[0].rsa[0].headlines[0].text',headline_length:31,provider_calls:0,provider_writes:0,preview_created:false};
  stage='V_live_checklist';const v=(await mcp('get_launch_checklist',{provider:'GOOGLE_ADS',account_id:'8590146099',campaign_id:'24324170853'})).value,goal=v.checklist?.find(c=>c.code==='conversion_goal');
  if(!goal||!['WARNING','FAIL'].includes(goal.status)||v.ready!==false)throw Error('stage0_V_missing_goal_not_detected');
  evidence.V={status:'LIVE_READ_ONLY_PASS',campaign_id:'24324170853',goal_status:goal.status,ready:v.ready,can_resume:v.can_resume,checklist:v.checklist};
  stage='T_prepare_plan';normalizeBrief(inputs.brief);const plan=await adapter.stage0(providerContext,'build',inputs.brief);assertTPlan(plan);const operations=stage0ProviderOperations(plan);
  writeFileSync(root+'/'+prefix+'-prepared-plan.json',JSON.stringify({plan,provider_operations:operations}),{mode:0o600,flag:'wx'});
  evidence.T={status:'READ_ONLY_PLAN_PREPARED_NOT_GOOGLE_VALIDATED',brief:inputs.brief,operation_count:plan.operations.length,summary:plan.summary,object_plan:plan.operations,partial_failure:false,provider_validation:'NOT_RUN',commit:'NOT_RUN',campaign_initial:'PAUSED',groups_initial:'PAUSED',rsa_initial:'PAUSED',keywords_initial:'ENABLED_INSIDE_PAUSED_PARENTS'};
  stage='W_prepare_resume';if(v.can_resume){const p=await adapter.stage0(providerContext,'resume',{provider:'GOOGLE_ADS',account_id:'8590146099',campaign_id:'24324170853'});evidence.W={resume_plan_prepared:true,provider_validation:'NOT_RUN',commit:'NOT_RUN',operations:p.operations,checklist:v.checklist,restoration_path:'BLOCKED_AT_BASE_HEAD_CAMPAIGN_PAUSE_NOT_IMPLEMENTED; scoped_mock_fix_separate_branch_pending'};}else evidence.W={resume_plan_prepared:false,guard:'google_launch_checklist_failed',restoration_path:'separate_product_fix_pending',commit:'NOT_RUN'};
  evidence.result='STAGE0_INDEPENDENT_U_V_PASS_T_W_PREPARED';
 }else{
  stage='T_JIT_preview';const p=(await mcp('create_campaign_from_brief',inputs.brief)).value;
  if(p.status==='preview')writeFileSync(root+'/'+prefix+'-protected-context.json',JSON.stringify({service_token:context.service_token,preview:p}),{mode:0o600,flag:'wx'});
  if(p.status!=='preview'||p.provider_validation!=='passed'||p.partial_failure!==false||!p.approval_url)throw Error('stage0_T_preview_validation_failed');
  const stored=await db.client.mcpPreview.findUnique({where:{id:p.preview_id}}),prepared=JSON.parse(readFileSync(root+'/'+prefix+'-prepared-plan.json','utf8'));
  if(stored.operation!=='GOOGLE_STAGE0_CAMPAIGN_CREATE'||stored.confirmedAt||stored.consumedAt||stored.commitAttemptedAt||stored.expiresAt<=new Date()||canonical(stage0ProviderOperations(stored.requestedState))!==canonical(prepared.provider_operations))throw Error('stage0_T_immutable_plan_invalid');
  const absent=await read('SELECT campaign.id, campaign.name FROM campaign WHERE campaign.name = '+"'"+inputs.brief.campaign_name+"'");if(absent.length)throw Error('stage0_T_created_during_preview');
  evidence.preview_result={status:p.status,preview_id:p.preview_id,expires_at:p.expires_at,operation_count:p.operation_count,provider_validation:p.provider_validation,partial_failure:p.partial_failure,campaign_plan:p.campaign_plan,items:p.items};evidence.immutable_preview_fingerprint=fingerprint(stored);evidence.validation=JSON.parse(readFileSync(root+'/'+prefix+'-validation.json','utf8'));evidence.campaign_exists_before_commit=false;evidence.result='WAITING_FOR_MANUAL_T_APPROVAL';
 }
 stage='provider_after';const afterState=await readState();if(canonical(afterState)!==canonical(beforeState))throw Error('stage0_unexpected_fixture_change');evidence.provider_state_after=afterState;evidence.before_after_unchanged=true;
 const hierarchyProof={customer_id:'8590146099',test_account:true,hierarchy:true,verified_at:new Date().toISOString()};
 if(prepare)writeFileSync(root+'/'+prefix+'-test-proof.json',JSON.stringify(hierarchyProof),{mode:0o600,flag:'wx'});
 else {const prior=JSON.parse(readFileSync(root+'/'+prefix+'-test-proof.json','utf8'));if(prior.customer_id!=='8590146099'||prior.test_account!==true)throw Error('stage0_proof_invalid');}
 for(const [n,digest] of Object.entries(fileHashes))if(hash(readFileSync(root+'/'+n))!==digest)throw Error('stage0_historical_evidence_changed');if(historyHash!==hash(canonical(await history()))||!readFileSync(root+'/provider-counts.jsonl','utf8').startsWith(countPrefix))throw Error('stage0_historical_database_changed');evidence.historical_evidence_unchanged=true;
 const events=calls();if(events.some(e=>e.type==='write'||!['read','validate_only','oauth_refresh'].includes(e.type)||e.type!=='oauth_refresh'&&!['8590146099','4378327049'].includes(e.customer))||events.filter(e=>e.type==='validate_only').length!==(prepare?0:1))throw Error('stage0_counter_invariant_failed');
}catch(error){evidence.result='BLOCKED';evidence.failure_stage=stage;evidence.code=error.code??(/^[a-zA-Z0-9_]+$/.test(error.message)?error.message:'stage0_internal_error');evidence.error_class=error.constructor.name;process.exitCode=1;}
finally{if(server){server.kill('SIGTERM');await new Promise(r=>{server.once('exit',r);setTimeout(r,5000);});if(server.exitCode===null)server.kill('SIGKILL');}const events=calls();evidence.provider_read_call_count=events.filter(e=>e.type==='read').length;evidence.validate_only_call_count=events.filter(e=>e.type==='validate_only').length;evidence.real_provider_write_call_count=events.filter(e=>e.type==='write').length;evidence.oauth_refresh_call_count=events.filter(e=>e.type==='oauth_refresh').length;evidence.timestamp=new Date().toISOString();writeFileSync(root+'/'+fileName,JSON.stringify(evidence),{mode:0o600,flag:'wx'});console.log(JSON.stringify({result:evidence.result,failure_stage:evidence.failure_stage,code:evidence.code,U:evidence.U,V:evidence.V?{status:evidence.V.status,goal_status:evidence.V.goal_status,ready:evidence.V.ready,can_resume:evidence.V.can_resume}:null,T:evidence.T?{status:evidence.T.status,operation_count:evidence.T.operation_count}:null,W:evidence.W?{resume_plan_prepared:evidence.W.resume_plan_prepared,guard:evidence.W.guard}:null,preview_result:evidence.preview_result,calls:[evidence.provider_read_call_count,evidence.validate_only_call_count,evidence.real_provider_write_call_count],runtime_product_module_sha256:evidence.runtime_product_module_sha256}));await closeDatabase(db);}
`;
write('stage0-readiness.mjs',source);
let runner=read('run-f-restore-v2.py').replaceAll("('old','new')","('stage0',)").replaceAll("('prepare','preview','commit')","('prepare','preview')").replaceAll("prefix='acceptance-f-restore-v2-'+phase","prefix='acceptance-stage0-readiness-20261008'").replaceAll("'f-restore-v2-contract.mjs','f-restore-v2-guard.mjs','f-restore-v2.mjs','keyword-snapshot-proof.mjs'","'f-restore-v2-contract.mjs','stage0-contract.mjs','stage0-guard.mjs','stage0-readiness.mjs','keyword-snapshot-proof.mjs'").replaceAll('ACCEPTANCE_F_RESTORE_MODE','ACCEPTANCE_STAGE0_MODE').replaceAll("'/acceptance/f-restore-v2.mjs'","'/acceptance/stage0-readiness.mjs'");
// Guard also preloads parent direct adapter reads, not just child stock API.
runner=replace(runner,"['docker','compose'","['docker','compose'");
runner=replace(runner,"command+=['api','/acceptance/stage0-readiness.mjs',head]","command+=['api','--import','/acceptance/stage0-guard.mjs','/acceptance/stage0-readiness.mjs',head]");
write('run-stage0-readiness.py',runner);
for(const n of ['f-restore-v2-contract.mjs','keyword-snapshot-proof.mjs','reconcile-read-guard.mjs'])write(n,read(n));
console.log('Stage0 read-only/mock readiness harness generated offline; all real writes denied.');
