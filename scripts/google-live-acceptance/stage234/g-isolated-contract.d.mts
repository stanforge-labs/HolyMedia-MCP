export function makeIsolatedGBrief(stamp: string): Record<string, unknown>;
export function assertIsolatedGPlan(plan: unknown): true;
export function gStrategyArgs(ids: {
  campaign_id: string;
  ad_group_id: string;
  criterion_id: string;
}): Record<string, unknown>;
export function gWarningArgs(ids: {
  campaign_id: string;
  ad_group_id: string;
  criterion_id: string;
}): Record<string, unknown>;
export function assertGAutomaticContext(
  proof: unknown,
  ids: { campaign_id: string; ad_group_id: string; criterion_id: string },
): {
  provider_derived_before: Record<string, unknown>;
  expected_raw_after_cpc_micros: string;
  warning_only: true;
  commit_authorized: false;
};
