import { test } from "node:test";
import assert from "node:assert/strict";
const controls = { addEventListener() {}, hidden: true };
globalThis.document = { querySelector: () => controls };
globalThis.location = { hash: "", pathname: "/mcp/approve" };
globalThis.history = { replaceState() {} };
let calls = 0;
globalThis.fetch = async () => {
  calls++;
  throw new Error("unexpected_request");
};
const { approvalRows } = await import("./approval.mjs");
test("keyword approval displays provider before/after and exact resource identity", () => {
  for (const [before, after] of [
    ["ENABLED", "PAUSED"],
    ["PAUSED", "ENABLED"],
  ]) {
    const rows = approvalRows({
      items: [
        {
          keyword: "test marketing",
          match_type: "EXACT",
          criterion_id: "11743561",
          resource_name:
            "customers/8590146099/adGroupCriteria/206587491811~11743561",
          campaign_id: "24324170853",
          ad_group_id: "206587491811",
          before_status: before,
          after_status: after,
        },
      ],
    });
    assert.equal(rows.length, 1);
    assert.match(rows[0].keyword, /test marketing.*EXACT.*11743561/);
    assert.equal(rows[0].before.status, before);
    assert.equal(rows[0].after.status, after);
    assert.equal(rows[0].before.campaign_id, "24324170853");
    assert.equal(rows[0].before.ad_group_id, "206587491811");
  }
  assert.equal(calls, 0);
});
test("Stage 0/1 rows are unchanged and no load ever approves automatically", () => {
  const items = [
    { kind: "campaign", before: null, after: { status: "PAUSED" } },
  ];
  assert.equal(approvalRows({ stage1_items: items }), items);
  assert.equal(calls, 0);
});
