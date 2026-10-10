import test from "node:test";
import assert from "node:assert/strict";
import { assertIJournal } from "./audience-journal.mjs";
import { canonical, target } from "./audience-commit-guard.mjs";
const fixture = () => {
  const original = {
    id: "preview",
    workspaceId: "workspace",
    snapshotDigest: "hash",
    requestedState: { immutable: true },
    beforeState: [],
  };
  const stored = {
    ...original,
    consumedAt: new Date(),
    commitStatus: "VERIFIED",
  };
  const resources = [
    target.groupResource,
    `customers/${target.customer}/adGroupCriteria/${target.group}~51668099935`,
  ];
  const result = {
    status: "VERIFIED",
    account_id: target.customer,
    preview_id: original.id,
    operation_count: 2,
    atomic: true,
    partial_failure: false,
    commit_id: "commit",
    items: [
      {
        operations: resources.map((resource_name, operation) => ({
          operation,
          resource_name,
          success: true,
          error: null,
          actual: { resourceName: resource_name },
        })),
      },
    ],
  };
  const events = [0, 1].flatMap((index) =>
    ["attempted", "success"].map((phase) => ({
      eventType: "mcp_google_stage1_operation",
      targetId: original.id,
      workspaceId: original.workspaceId,
      success: true,
      createdAt: new Date(phase === "attempted" ? 1000 : 2000),
      metadata: {
        provider: "GOOGLE_ADS",
        accountId: target.customer,
        previewId: original.id,
        commitId: result.commit_id,
        campaignId: target.campaign,
        adGroupId: target.group,
        operation: "targeting",
        providerOperation: index,
        result: phase,
        googleErrorCode: null,
        objectId: resources[index],
        before: "null",
        after: "{}",
        actual:
          phase === "attempted"
            ? null
            : canonical(result.items[0].operations[index].actual),
      },
    })),
  );
  events.push({
    eventType: "mcp_google_commit_result",
    targetId: original.id,
    workspaceId: original.workspaceId,
    success: true,
    createdAt: new Date(3000),
    metadata: {
      provider: "GOOGLE_ADS",
      accountId: target.customer,
      previewId: original.id,
      commitId: result.commit_id,
      result: "VERIFIED",
      operation: "GOOGLE_STAGE3_TARGETING",
    },
  });
  return structuredClone({ stored, original, result, events });
};
test("actual I contract: two attempted + two success audit rows means two verified operations", () => {
  assert.equal(assertIJournal(fixture()).verified_operations, 2);
});
test("attempts alone, missing terminal, duplicates, failures and wrong operation cannot verify", () => {
  for (const edit of [
    (f) => f.events.splice(1, 1),
    (f) => f.events.push(f.events[1]),
    (f) => (f.events[1].metadata.result = "attempted"),
    (f) => (f.events[1].success = false),
    (f) => (f.events[1].metadata.result = "failure"),
    (f) => (f.events[1].metadata.providerOperation = 1),
    (f) => (f.events[1].metadata.accountId = target.mcc),
    (f) => (f.events[1].metadata.commitId = "other"),
    (f) => (f.events[1].metadata.objectId = "foreign"),
    (f) => (f.events[1].metadata.actual = "{}"),
    (f) => (f.events[1].createdAt = new Date(999)),
    (f) => (f.events[4].metadata.result = "UNVERIFIED"),
    (f) => (f.events[4].createdAt = new Date(1999)),
    (f) => (f.stored.requestedState = { immutable: false }),
    (f) => (f.stored.snapshotDigest = "changed"),
    (f) => (f.stored.beforeState = [{}]),
    (f) => (f.stored.consumedAt = null),
  ]) {
    const f = fixture();
    edit(f);
    assert.throws(() => assertIJournal(f));
  }
});
