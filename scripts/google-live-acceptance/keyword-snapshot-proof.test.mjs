import { test } from "node:test";
import assert from "node:assert/strict";
import { assertKeywordSnapshot } from "./keyword-snapshot-proof.mjs";
const expected = {
  identity: {
    campaign_id: "24324170853",
    ad_group_id: "206587491811",
    criterion_id: "11743561",
    resource_name: "customers/8590146099/adGroupCriteria/206587491811~11743561",
  },
  before: "PAUSED",
  match: "EXACT",
};
const snapshot = {
  ...expected.identity,
  account_id: "8590146099",
  keyword: "test marketing",
  match_type: "EXACT",
  status: "PAUSED",
  campaign_status: "PAUSED",
  ad_group_status: "PAUSED",
};
test("actual typed provider snapshot with keyword is accepted", () => {
  assert.doesNotThrow(() => assertKeywordSnapshot([snapshot], expected));
});
test("old Stage1 ResourceSnapshot text shape must not substitute typed keyword", () => {
  const wrong = { ...snapshot, text: snapshot.keyword };
  delete wrong.keyword;
  assert.throws(() => assertKeywordSnapshot([wrong], expected));
});
test("identity, status, parents and keyword changes still fail closed", () => {
  for (const [field, value] of Object.entries({
    account_id: "4378327049",
    campaign_id: "999",
    ad_group_id: "999",
    criterion_id: "999",
    resource_name: "customers/9999999999/adGroupCriteria/206587491811~11743561",
    status: "ENABLED",
    campaign_status: "ENABLED",
    ad_group_status: "ENABLED",
    keyword: "other",
    match_type: "PHRASE",
  }))
    assert.throws(() =>
      assertKeywordSnapshot([{ ...snapshot, [field]: value }], expected),
    );
  assert.throws(() => assertKeywordSnapshot([], expected));
  assert.throws(() => assertKeywordSnapshot([snapshot, snapshot], expected));
});
