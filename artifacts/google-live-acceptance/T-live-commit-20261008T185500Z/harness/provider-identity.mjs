export function verifiedResourceIdentity(kind, resource) {
 if(typeof resource!=='string'||!resource.startsWith('customers/8590146099/'))throw Error('verified_test_resource_required');
 const patterns={campaignBudget:/^customers\/8590146099\/campaignBudgets\/(\d+)$/,campaign:/^customers\/8590146099\/campaigns\/(\d+)$/,adGroup:/^customers\/8590146099\/adGroups\/(\d+)$/,asset:/^customers\/8590146099\/assets\/(\d+)$/,adGroupAd:/^customers\/8590146099\/adGroupAds\/(\d+)~(\d+)$/,adGroupCriterion:/^customers\/8590146099\/adGroupCriteria\/(\d+)~(\d+)$/,campaignCriterion:/^customers\/8590146099\/campaignCriteria\/(\d+)~(\d+)$/,campaignAsset:/^customers\/8590146099\/campaignAssets\/(\d+)~(\d+)~([A-Z_]+)$/};
 const m=resource.match(patterns[kind]??/$a/);if(!m)throw Error('real_resource_identity_invalid');
 return {kind,resource_name:resource,id:m[2]??m[1],...(m[2]?{parent_id:m[1]}:{}),...(m[3]?{field_type:m[3]}:{})};
}

