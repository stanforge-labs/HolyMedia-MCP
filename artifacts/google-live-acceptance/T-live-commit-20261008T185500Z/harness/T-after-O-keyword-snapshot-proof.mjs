// Acceptance-only typed proof: GoogleKeywordSnapshot exposes `keyword`, not `text`.
export function assertKeywordSnapshot(rows, expected) {
  if (
    rows.length !== 1 ||
    rows[0].account_id !== "8590146099" ||
    rows[0].resource_name !== expected.identity.resource_name ||
    rows[0].campaign_id !== expected.identity.campaign_id ||
    rows[0].ad_group_id !== expected.identity.ad_group_id ||
    rows[0].criterion_id !== expected.identity.criterion_id ||
    rows[0].status !== expected.before ||
    rows[0].keyword !== "test marketing" ||
    rows[0].match_type !== expected.match ||
    rows[0].campaign_status !== "PAUSED" ||
    rows[0].ad_group_status !== "PAUSED"
  )
    throw Error("f_restore_keyword_changed");
}


