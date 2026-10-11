import {
  assertRestoreJPlan,
  target,
  canonical,
  fail,
} from "./geo-restore-guard.mjs";
// A successful exact REMOVE can reread as absent or REMOVED. Never accept
// absence alone, a failed query, partial acknowledgement or changed neighbors.
export function assertRestoredJ(
  before,
  after,
  result,
  removedRows,
  plan,
  origin,
) {
  assertRestoreJPlan(plan, origin);
  if (
    result?.status !== "VERIFIED" ||
    result.account_id !== target.customer ||
    result.operation_count !== 2 ||
    result.atomic !== false ||
    result.partial_failure !== true ||
    result.irreversible !== true ||
    !/^hmc_[A-Za-z0-9_-]{43}$/.test(result.commit_id ?? "") ||
    result.items?.length !== 2 ||
    !Array.isArray(removedRows) ||
    removedRows.length !== 2
  )
    fail("stage234_j_restore_commit_result_invalid");
  const removed = origin.created_criteria.map((c, i) => {
    const ops = result.items[i].operations,
      rows = removedRows[i];
    if (
      ops?.length !== 1 ||
      ops[0].operation !== i ||
      ops[0].success !== true ||
      ops[0].error !== null ||
      ops[0].resource_name !== c.resource_name ||
      (ops[0].actual !== null &&
        (ops[0].actual?.resourceName !== c.resource_name ||
          ops[0].actual.status !== "REMOVED")) ||
      !Array.isArray(rows) ||
      rows.length > 1 ||
      (rows.length === 1 &&
        (rows[0]?.campaignCriterion?.resourceName !== c.resource_name ||
          rows[0].campaignCriterion.campaign !==
            "customers/" + target.customer + "/campaigns/" + target.campaign ||
          rows[0].campaignCriterion.type !== c.type ||
          rows[0].campaignCriterion.status !== "REMOVED"))
    )
      fail("stage234_j_restore_remove_not_verified");
    const existing = before.campaignCriteria.filter(
      (r) => r.campaignCriterion?.resourceName === c.resource_name,
    );
    if (
      existing.length !== 1 ||
      existing[0].campaignCriterion.status !== "ENABLED"
    )
      fail("stage234_j_restore_before_identity_invalid");
    return {
      criterion_id: c.criterion_id,
      resource_name: c.resource_name,
      status: "REMOVED",
      provider_observation: rows.length
        ? "REMOVED row"
        : "exact resource absent",
    };
  });
  const expected = structuredClone(before);
  expected.campaignCriteria = expected.campaignCriteria.filter(
    (r) =>
      !origin.created_criteria.some(
        (c) => c.resource_name === r.campaignCriterion?.resourceName,
      ),
  );
  if (
    canonical(after) !== canonical(expected) ||
    canonical(before) !== canonical(origin.provider_state_after) ||
    canonical(after) !== canonical(origin.provider_state_before)
  )
    fail("stage234_j_restore_neighbor_or_original_snapshot_changed");
  return removed;
}
