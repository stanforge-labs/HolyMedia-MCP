import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonical,account,operation} from './W-completion-contract.mjs';
const prefix='acceptance-stage0-W-continuation-rerun-20261009-restore';
function assertWPlan(plan){const o=plan.operations?.[0];if(plan.version!==0||plan.account_id!==account||plan.intent.action!=='campaign_pause'||plan.operations.length!==1||o.kind!=='campaign'||o.method!=='update'||o.resource_name!==operation.campaignOperation.update.resourceName||o.before.status!=='ENABLED'||canonical(o.fields)!==canonical({resourceName:o.resource_name,status:'PAUSED'})||o.update_mask!=='status'||o.expected.status!=='PAUSED'||plan.checks.length!==1)throw Error('W_restore_status_only_plan_invalid');}
createRequire('/workspace/apps/api/package.json')('reflect-metadata');
export const hash=v=>createHash('sha256').update(v).digest('hex');
export const fingerprint=r=>hash(canonical({payload:r.payload,before:r.beforeState,requested:r.requestedState,digest:r.snapshotDigest,expiresAt:r.expiresAt}));
export async function approvalProof(db,config){
 const u=new URL(config.databaseUrl);
 if(u.hostname!=='postgres'||u.pathname!=='/google_acceptance'||!config.providerGoogleAdsWriteEnabled||canonical(config.googleAdsWriteAccountAllowlist)!=='["8590146099"]'||config.publicMcpWriteScopeEnabled||config.publicMcpControlledWriteEnabled||config.providerGoogleLoginCustomerId!=='4378327049'||config.providerGoogleApiVersion!=='v24')throw Error('W_config_invalid');
 const c=JSON.parse(readFileSync('/acceptance-state/'+prefix+'-protected-context.json','utf8'));
 const r=await db.client.mcpPreview.findUnique({where:{id:'7624ef9e-295f-4148-9824-b42e8ac218a6'},include:{account:true}});
 const k=await db.client.serviceToken.findUnique({where:{id:c.service_token_id},include:{serviceIdentity:true}});
 if(!r||!k||c.preview.preview_id!==r.id||r.provider!=='GOOGLE_ADS'||r.account.externalAccountId!==account||!r.account.enabled||r.workspaceId!==r.account.workspaceId||r.serviceTokenId!==k.id||r.operation!=='GOOGLE_STAGE0_CAMPAIGN_PAUSE'||k.tokenDigest!==hash(c.service_token)||r.previewTokenDigest!==hash(c.preview.preview_token)||k.revokedAt||k.expiresAt<=new Date()||k.serviceIdentity.revokedAt||k.serviceIdentity.workspaceId!==r.workspaceId||k.resourceAccessMode!=='STATIC_ALLOWLIST'||canonical(k.accountIds)!==canonical([r.accountId])||!k.scopes.includes('adforge:mcp:read')||!k.scopes.includes('adforge:mcp:write'))throw Error('W_principal_or_preview_invalid');
 if(!r.confirmedAt||!r.approvalSessionId||r.approvedByUserId!==k.serviceIdentity.createdById)throw Error('W_approval_not_persisted');
 if(r.expiresAt<=new Date())throw Error('W_preview_expired');
 if(r.consumedAt||r.commitAttemptedAt||r.cancelledAt)throw Error('W_preview_consumed_or_attempted');
 if(fingerprint(r)!==c.immutable_fingerprint||r.snapshotDigest!==hash(canonical(r.requestedState))||canonical(r.beforeState)!==canonical(r.requestedState.checks)||canonical(r.payload.intent)!==canonical(r.requestedState.intent))throw Error('W_immutable_payload_changed');
 assertWPlan(r.requestedState);
 const s=await db.client.session.findUnique({where:{id:r.approvalSessionId}}),a=await db.client.auditEvent.findMany({where:{targetId:r.id,eventType:'mcp_preview_web_approved'},select:{eventType:true,createdAt:true,success:true,actorUserId:true}});
 if(!s||s.revokedAt||s.expiresAt<=new Date()||s.userId!==r.approvedByUserId||a.length!==1||!a[0].success||a[0].actorUserId!==r.approvedByUserId)throw Error('W_session_or_approval_audit_invalid');
 const enabled=await db.client.providerAccount.findMany({where:{workspaceId:r.workspaceId,provider:'GOOGLE_ADS',enabled:true},select:{externalAccountId:true}});
 if(canonical(enabled)!==canonical([{externalAccountId:account}]))throw Error('W_foreign_account_selected');
 const pending=await db.client.mcpPreview.findMany({where:{workspaceId:r.workspaceId,provider:'GOOGLE_ADS',consumedAt:null,cancelledAt:null,expiresAt:{gt:new Date()}},select:{id:true}});
 if(pending.length!==1||pending[0].id!==r.id)throw Error('W_other_preview_pending');
 const v=JSON.parse(readFileSync('/acceptance-state/acceptance-stage0-W-continuation-rerun-20261009-validate_only-http.json','utf8'));
 if(v.http_status!==200||v.validate_only!==true||v.partial_failure!==false||v.operation_count!==1)throw Error('W_original_validation_not_passed');
 return {context:c,row:r,key:k,safe:{preview_id:r.id,confirmed_at:r.confirmedAt,expires_at:r.expiresAt,session_valid:true,approval_audit:a,immutable:true,consumed:false,validate_only_previous:'PASS'}};
}
