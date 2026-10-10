import { canonical, fail, target } from "./audience-commit-guard.mjs";
import { timestampMillis } from "./timestamp.mjs";

// Stock audit has attempted + terminal records for EACH provider operation.
// success=true on an attempted record means audit persistence, not verification.
export function assertIJournal({ stored, original, result, events }) {
  if (
    result?.status !== "VERIFIED" ||
    result.account_id !== target.customer ||
    result.operation_count !== 2 ||
    result.atomic !== true ||
    result.partial_failure !== false ||
    stored?.id !== original?.id ||
    result.preview_id !== stored?.id ||
    !stored?.consumedAt ||
    stored.commitStatus !== "VERIFIED" ||
    stored.snapshotDigest !== original.snapshotDigest ||
    canonical(stored.requestedState) !== canonical(original.requestedState) ||
    canonical(stored.beforeState) !== canonical(original.beforeState) ||
    !Array.isArray(events)
  )
    fail("stage234_i_journal_immutable_or_result_invalid");
  const operations = result.items?.[0]?.operations;
  if (
    result.items?.length !== 1 ||
    operations?.length !== 2 ||
    operations.some(
      (o, i) =>
        o.operation !== i ||
        o.success !== true ||
        o.error !== null ||
        typeof o.resource_name !== "string" ||
        !o.actual,
    )
  )
    fail("stage234_i_journal_operation_results_invalid");
  const rows = events.filter(
    (e) => e.eventType === "mcp_google_stage1_operation",
  );
  if (rows.length !== 4) fail("stage234_i_journal_operation_count_invalid");
  for (let index = 0; index < 2; index++) {
    const pair = rows.filter((e) => e.metadata?.providerOperation === index);
    const attempts = pair.filter((e) => e.metadata?.result === "attempted");
    const finals = pair.filter((e) => e.metadata?.result === "success");
    if (pair.length !== 2 || attempts.length !== 1 || finals.length !== 1)
      fail("stage234_i_journal_attempt_terminal_pair_invalid");
    const attempt = attempts[0],
      final = finals[0],
      op = operations[index];
    if (
      pair.some(
        (e) =>
          e.success !== true ||
          e.targetId !== stored.id ||
          e.workspaceId !== stored.workspaceId ||
          e.metadata?.provider !== "GOOGLE_ADS" ||
          e.metadata.accountId !== target.customer ||
          e.metadata.previewId !== stored.id ||
          e.metadata.commitId !== result.commit_id ||
          e.metadata.campaignId !== target.campaign ||
          e.metadata.adGroupId !== target.group ||
          e.metadata.operation !== "targeting" ||
          e.metadata.googleErrorCode !== null ||
          !Number.isFinite(timestampMillis(e.createdAt)),
      ) ||
      timestampMillis(attempt.createdAt) > timestampMillis(final.createdAt) ||
      final.metadata.objectId !== op.resource_name ||
      final.metadata.actual !== canonical(op.actual) ||
      attempt.metadata.before !== final.metadata.before ||
      attempt.metadata.after !== final.metadata.after ||
      attempt.metadata.actual !== null
    )
      fail("stage234_i_journal_identity_state_or_order_invalid");
  }
  const commits = events.filter(
    (e) => e.eventType === "mcp_google_commit_result",
  );
  if (commits.length !== 1) fail("stage234_i_journal_commit_count_invalid");
  const commit = commits[0];
  if (
    commit.success !== true ||
    commit.targetId !== stored.id ||
    commit.workspaceId !== stored.workspaceId ||
    commit.metadata?.provider !== "GOOGLE_ADS" ||
    commit.metadata.accountId !== target.customer ||
    commit.metadata.previewId !== stored.id ||
    commit.metadata.commitId !== result.commit_id ||
    commit.metadata.result !== "VERIFIED" ||
    commit.metadata.operation !== "GOOGLE_STAGE3_TARGETING" ||
    !Number.isFinite(timestampMillis(commit.createdAt)) ||
    rows.some(
      (e) => timestampMillis(e.createdAt) > timestampMillis(commit.createdAt),
    )
  )
    fail("stage234_i_journal_commit_identity_or_order_invalid");
  return {
    result: "VERIFIED",
    attempted_operations: 2,
    verified_operations: 2,
    terminal_commit_events: 1,
    provider_mutation_calls_inferred_from_audit: false,
  };
}
