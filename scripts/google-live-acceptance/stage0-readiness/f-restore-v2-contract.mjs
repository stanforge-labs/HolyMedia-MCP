export const canonical = (v) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );
export const oldResource =
  "customers/8590146099/adGroupCriteria/206587491811~11743561";
export const newResource =
  "customers/8590146099/adGroupCriteria/206587491811~11479221";
export const stage1KeywordSelect =
  "SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.resource_name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.negative, ad_group_criterion.final_urls, ad_group_criterion.cpc_bid_micros, ad_group_criterion.type FROM ad_group_criterion";
export const inventoryQuery =
  stage1KeywordSelect +
  " WHERE ad_group.id = 206587491811 AND ad_group_criterion.type = KEYWORD";
export const sharedQuery =
  "SELECT shared_set.resource_name, shared_set.id, shared_set.name, shared_set.status, shared_set.type FROM shared_set";
export const membersQuery =
  "SELECT shared_criterion.resource_name, shared_criterion.criterion_id, shared_criterion.shared_set, shared_criterion.keyword.text, shared_criterion.keyword.match_type, shared_criterion.type FROM shared_criterion WHERE shared_criterion.shared_set = 'customers/8590146099/sharedSets/12261567996' AND shared_criterion.type = KEYWORD";
export const linksQuery =
  "SELECT campaign.id, campaign.name, campaign_shared_set.resource_name, campaign_shared_set.campaign, campaign_shared_set.shared_set, campaign_shared_set.status FROM campaign_shared_set WHERE campaign.id = 24324170853";
export const setLinksQuery =
  "SELECT campaign.id, campaign.name, campaign_shared_set.resource_name, campaign_shared_set.campaign, campaign_shared_set.shared_set, campaign_shared_set.status FROM campaign_shared_set WHERE campaign_shared_set.shared_set = 'customers/8590146099/sharedSets/12261567996' AND campaign_shared_set.status = ENABLED";
export const negativesQuery =
  "SELECT campaign.id, campaign.name, campaign_criterion.resource_name, campaign_criterion.criterion_id, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type, campaign_criterion.status, campaign_criterion.negative, campaign_criterion.type FROM campaign_criterion WHERE campaign.id = 24324170853 AND campaign_criterion.type = KEYWORD";
export function restoration(phase) {
  if (!["old", "new"].includes(phase)) throw Error("f_restore_phase_invalid");
  const resource = phase === "old" ? oldResource : newResource,
    status = phase === "old" ? "ENABLED" : "PAUSED";
  const identity = {
    campaign_id: "24324170853",
    ad_group_id: "206587491811",
    criterion_id: phase === "old" ? "11743561" : "11479221",
    resource_name: resource,
  };
  const input = {
    provider: "GOOGLE_ADS",
    account_id: "8590146099",
    entity_type: "keyword",
    status,
    items: [identity],
  };
  const operations = [
    { update: { resourceName: resource, status }, updateMask: "status" },
  ];
  const query =
    "SELECT campaign.id, campaign.name, campaign.status, ad_group.id, ad_group.name, ad_group.status, ad_group_criterion.resource_name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.negative, ad_group_criterion.type FROM ad_group_criterion WHERE ad_group_criterion.type = KEYWORD AND ad_group_criterion.negative = FALSE AND ad_group_criterion.resource_name IN ('" +
    resource +
    "')";
  return {
    phase,
    prefix: "acceptance-f-restore-v2-" + phase,
    identity,
    input,
    operations,
    query,
    before: phase === "old" ? "PAUSED" : "ENABLED",
    after: status,
    match: phase === "old" ? "EXACT" : "PHRASE",
  };
}
