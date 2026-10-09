import test from "node:test";
import assert from "node:assert/strict";
import {
  VERIFIED_L as L,
  assertVerifiedLResidual,
  assertVerifiedLGroupAds,
  assertVerifiedLDeliveryAds,
} from "./verified-l-residual.mjs";
import { mockLProof, mockLAd } from "./verified-l-residual.fixtures.mjs";
test("pinned historical proof brands safe core independently of current source revision", () => {
  const p = mockLProof();
  assert.doesNotThrow(() => assertVerifiedLResidual(p));
  assert.equal(p.source_head, L.source);
  assert.ok(Object.isFrozen(p));
  assert.throws(() => assertVerifiedLResidual({ ...p }));
});
test("hash, file ownership, symlink and permission failures cannot authorize residual", () => {
  for (const opts of [
    { hash: "0".repeat(64) },
    { stat: { uid: 0 } },
    { stat: { mode: 0o644 } },
    { stat: { isSymbolicLink: () => true } },
    { stat: { size: 1048577 } },
    { stat: { isFile: () => false } },
  ])
    assert.throws(() => mockLProof(undefined, opts));
});
test("foreign, unconfirmed, unverified and enabled historical proofs rejected", () => {
  const changes = [
    (r) => {
      r.test_customer_id = "9999999999";
    },
    (r) => {
      r.source_head = "a".repeat(40);
    },
    (r) => {
      r.approval.preview_id = "wrong";
    },
    (r) => {
      r.approval.session_valid = false;
    },
    (r) => {
      r.approval.audit_valid = false;
    },
    (r) => {
      r.approval.confirmed_at = r.approval.expires_at;
    },
    (r) => {
      r.commit.commit_id = "wrong";
    },
    (r) => {
      r.commit.status = "UNVERIFIED";
    },
    (r) => {
      r.created_rsa.status = "ENABLED";
    },
    (r) => {
      r.commit.items[0].operations[0].actual.status = "ENABLED";
    },
    (r) => {
      r.audit = [];
    },
    (r) => {
      r.production_changed = true;
    },
  ];
  for (const f of changes)
    assert.throws(() =>
      mockLProof((r) => {
        f(r);
        return r;
      }),
    );
});
test("exact two group and four delivery associations only, no duplicate or changed resource", () => {
  const p = mockLProof(),
    rows = [mockLAd("827349040712"), mockLAd()],
    all = [
      ...rows,
      mockLAd("827487091340", "24339483523", "200180930839"),
      mockLAd("827362851813", "24339483523", "200180931039"),
    ];
  assert.doesNotThrow(() => assertVerifiedLGroupAds(rows, p));
  assert.doesNotThrow(() => assertVerifiedLDeliveryAds(all, p));
  for (const change of [
    (a) => {
      a[1] = a[0];
    },
    (a) => {
      a[1].adGroupAd.status = "ENABLED";
    },
    (a) => {
      a[1].adGroupAd.resourceName = a[1].adGroupAd.resourceName.replace(
        L.customer,
        "9999999999",
      );
    },
    (a) => {
      a[1].adGroupAd.ad.type = "TEXT_AD";
    },
    (a) => {
      a[1].adGroup.id = "99";
    },
  ]) {
    const x = JSON.parse(JSON.stringify(all));
    change(x);
    assert.throws(() => assertVerifiedLDeliveryAds(x, p));
    assert.throws(() => assertVerifiedLGroupAds(x.slice(0, 2), p));
  }
  assert.throws(() => assertVerifiedLGroupAds(rows, { ...p }));
  assert.throws(() => assertVerifiedLDeliveryAds(all.slice(0, 3), p));
});
