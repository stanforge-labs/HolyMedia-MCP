export const TEST_CLIENT = "8590146099";
export const TEST_MCC = "4378327049";
export const PREFLIGHT_QUERIES = Object.freeze({
  customer:
    "SELECT customer.id, customer.resource_name, customer.test_account, customer.currency_code, customer.time_zone FROM customer",
  hierarchy:
    "SELECT customer_client.id, customer_client.level FROM customer_client WHERE customer_client.id = 8590146099 AND customer_client.level = 1",
  campaigns:
    "SELECT campaign.resource_name, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.campaign_budget, campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared FROM campaign WHERE campaign.id IN (24324170853,24339483523) AND campaign.status != REMOVED",
  groups:
    "SELECT campaign.id, ad_group.resource_name, ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros FROM ad_group WHERE campaign.id IN (24324170853,24339483523) AND ad_group.status != REMOVED",
  keywords:
    "SELECT campaign.id, ad_group.id, ad_group_criterion.resource_name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.cpc_bid_micros, ad_group_criterion.status FROM ad_group_criterion WHERE campaign.id IN (24324170853,24339483523) AND ad_group_criterion.type = KEYWORD AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status != REMOVED",
  ads: "SELECT campaign.id, ad_group.id, ad_group_ad.resource_name, ad_group_ad.status, ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.policy_summary.approval_status FROM ad_group_ad WHERE campaign.id IN (24324170853,24339483523) AND ad_group_ad.status != REMOVED",
  user_lists:
    "SELECT user_list.resource_name, user_list.id, user_list.name, user_list.membership_status, user_list.account_user_list_status, user_list.eligible_for_search, user_list.eligible_for_display FROM user_list LIMIT 100",
  custom_audiences:
    "SELECT custom_audience.resource_name, custom_audience.id, custom_audience.name, custom_audience.status, custom_audience.type FROM custom_audience LIMIT 100",
  user_interests:
    "SELECT user_interest.resource_name, user_interest.user_interest_id, user_interest.name, user_interest.taxonomy_type, user_interest.launched_to_all, user_interest.availabilities FROM user_interest LIMIT 100",
  detailed_demographics:
    "SELECT detailed_demographic.resource_name, detailed_demographic.id, detailed_demographic.name, detailed_demographic.launched_to_all, detailed_demographic.availabilities FROM detailed_demographic LIMIT 100",
  images:
    "SELECT asset.resource_name, asset.id, asset.name, asset.type, asset.image_asset.full_size.width_pixels, asset.image_asset.full_size.height_pixels FROM asset WHERE asset.type = IMAGE LIMIT 100",
  conversions:
    "SELECT conversion_action.resource_name, conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.category, conversion_action.type, conversion_action.primary_for_goal FROM conversion_action LIMIT 100",
  shared_set:
    "SELECT shared_set.resource_name, shared_set.id, shared_set.name, shared_set.type, shared_set.status FROM shared_set WHERE shared_set.id = 12261567996",
  attachments:
    "SELECT campaign_shared_set.resource_name, campaign_shared_set.campaign, campaign_shared_set.shared_set, campaign_shared_set.status FROM campaign_shared_set WHERE campaign_shared_set.shared_set = 'customers/8590146099/sharedSets/12261567996' AND campaign_shared_set.status != REMOVED",
});
export function classifyReadOnlyRequest(input, init = {}) {
  const url = new URL(
    typeof input === "string" || input instanceof URL
      ? String(input)
      : input.url,
  );
  const method = (init.method ?? "GET").toUpperCase();
  if (url.search || url.hash || url.username || url.password)
    throw Error("stage234_read_origin_invalid");
  if (
    url.origin === "https://oauth2.googleapis.com" &&
    url.pathname === "/token" &&
    method === "POST" &&
    new URLSearchParams(init.body).get("grant_type") === "refresh_token"
  )
    return "oauth_refresh";
  if (
    url.origin !== "https://googleads.googleapis.com" ||
    method !== "POST" ||
    new Headers(init.headers).get("login-customer-id") !== TEST_MCC
  )
    throw Error("stage234_non_read_request_blocked");
  const body = JSON.parse(String(init.body));
  if (Object.keys(body).join(",") !== "query")
    throw Error("stage234_read_payload_invalid");
  if (
    url.pathname === `/v24/customers/${TEST_CLIENT}/googleAds:searchStream` &&
    Object.values(PREFLIGHT_QUERIES).includes(body.query) &&
    body.query !== PREFLIGHT_QUERIES.hierarchy
  )
    return "read";
  if (
    url.pathname === `/v24/customers/${TEST_MCC}/googleAds:searchStream` &&
    [PREFLIGHT_QUERIES.customer, PREFLIGHT_QUERIES.hierarchy].includes(
      body.query,
    )
  )
    return "read";
  throw Error("stage234_non_read_request_blocked");
}
