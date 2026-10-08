export const prefix = "acceptance-stage0-W-20261008T192300Z";
export const account = "8590146099";
export const campaign = "24339483523";
export const args = Object.freeze({provider:"GOOGLE_ADS",account_id:account,campaign_id:campaign});
export const canonical = v => JSON.stringify(v, (_,x)=>x&&typeof x==="object"&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export const hierarchyQuery = "SELECT customer_client.id, customer_client.client_customer, customer_client.level FROM customer_client WHERE customer_client.id = 8590146099 AND customer_client.level <= 1";
export const operation = Object.freeze({campaignOperation:{update:{resourceName:"customers/8590146099/campaigns/24339483523",status:"ENABLED"},updateMask:"status"}});
export const validationBody = Object.freeze({mutateOperations:[operation],validateOnly:true,partialFailure:false});
export function assertWPlan(plan) {
 if(plan.version!==0||plan.account_id!==account||plan.intent.action!=="campaign_resume"||plan.operations.length!==1)throw Error("W_plan_scope_invalid");
 const o=plan.operations[0];
 if(o.kind!=="campaign"||o.method!=="update"||o.resource_name!==operation.campaignOperation.update.resourceName||o.before.status!=="PAUSED"||canonical(o.fields)!==canonical(operation.campaignOperation.update)||o.update_mask!=="status"||o.expected.status!=="ENABLED"||plan.checks.length===0)throw Error("W_status_only_plan_invalid");
 return true;
}
