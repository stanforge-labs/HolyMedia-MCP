// A single pinned historical VERIFIED L proof; never authorization for another write.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
export const VERIFIED_L = Object.freeze({
  sha256: "962cdada67ba61df6f3cb67442c5855aa9aa8d961c18e0e0ee0a3e7acebc4017",
  source: "c11f14c263b8e3a27418d87146b1894c7d9107dc",
  harness: "9f267cf73d43047aef050a5e54006b6431fa6496",
  preview: "49e76856-b8a9-451a-a240-207d8bf7fa40",
  commit: "hmc_Wnhn4AOtMiJ7N0oYSTV3v_zB1t3HFnTzHNt7thTGp9Y",
  customer: "8590146099",
  campaign: "24324170853",
  group: "206587491811",
  ad: "827463920328",
  resource: "customers/8590146099/adGroupAds/206587491811~827463920328",
  path: "/verified-l/l-verified-evidence.json",
});
const verified = new WeakSet();
const fail = () => {
  const e = new Error("readiness_verified_l_proof_invalid");
  e.code = "readiness_verified_l_proof_invalid";
  throw e;
};
export function assertVerifiedLResidual(proof) {
  if (!proof || !verified.has(proof)) fail();
}
export function readVerifiedLResidual({
  read = readFileSync,
  stat = lstatSync,
  hash = (bytes) => createHash("sha256").update(bytes).digest("hex"),
} = {}) {
  const s = stat(VERIFIED_L.path);
  if (
    !s.isFile() ||
    s.isSymbolicLink() ||
    s.mode & 0o077 ||
    s.uid !== 1000 ||
    !Number.isSafeInteger(s.size) ||
    s.size <= 0 ||
    s.size > 1024 * 1024
  )
    fail();
  const bytes = read(VERIFIED_L.path);
  if (hash(bytes) !== VERIFIED_L.sha256) fail();
  let r;
  try {
    r = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail();
  }
  const op = r.commit?.items?.[0]?.operations?.[0];
  if (
    r.result !== "L_COMMIT_VERIFIED" ||
    r.test_customer_id !== VERIFIED_L.customer ||
    r.campaign_id !== VERIFIED_L.campaign ||
    r.ad_group_id !== VERIFIED_L.group ||
    r.source_head !== VERIFIED_L.source ||
    r.harness_head !== VERIFIED_L.harness ||
    r.commit?.commit_id !== VERIFIED_L.commit ||
    r.commit?.status !== "VERIFIED" ||
    r.commit?.account_id !== VERIFIED_L.customer ||
    r.commit?.operation_count !== 1 ||
    r.commit?.partial_failure !== true ||
    r.commit?.atomic !== false ||
    r.commit?.provider_mutation_attempted !== true ||
    !Array.isArray(r.commit?.items) ||
    r.commit.items.length !== 1 ||
    r.commit.items[0].success !== true ||
    !Array.isArray(r.commit.items[0].operations) ||
    r.commit.items[0].operations.length !== 1 ||
    op?.resource_name !== VERIFIED_L.resource ||
    op?.success !== true ||
    op?.error !== null ||
    op?.actual?.resourceName !== VERIFIED_L.resource ||
    op?.actual?.status !== "PAUSED" ||
    op?.actual?.ad?.id !== VERIFIED_L.ad ||
    r.created_rsa?.ad_id !== VERIFIED_L.ad ||
    r.created_rsa?.resource_name !== VERIFIED_L.resource ||
    r.created_rsa?.status !== "PAUSED" ||
    r.approval?.preview_id !== VERIFIED_L.preview ||
    r.approval?.session_valid !== true ||
    r.approval?.audit_valid !== true ||
    !Number.isFinite(Date.parse(r.approval?.confirmed_at)) ||
    !Number.isFinite(Date.parse(r.approval?.expires_at)) ||
    Date.parse(r.approval.confirmed_at) >= Date.parse(r.approval.expires_at) ||
    !Array.isArray(r.audit) ||
    ![
      "mcp_preview_web_approved",
      "mcp_google_stage1_operation",
      "mcp_google_commit_result",
    ].every((type) =>
      r.audit.some((a) => a.type === type && a.success === true),
    ) ||
    r.real_provider_write_call_count !== 1 ||
    r.validate_only_call_count !== 0 ||
    r.production_changed !== false ||
    r.main_changed !== false
  )
    fail();
  const proof = Object.freeze({
    source_head: VERIFIED_L.source,
    harness_head: VERIFIED_L.harness,
    preview_id: VERIFIED_L.preview,
    commit_id: VERIFIED_L.commit,
    sha256: VERIFIED_L.sha256,
    ad_id: VERIFIED_L.ad,
    resource_name: VERIFIED_L.resource,
    status: "PAUSED",
  });
  verified.add(proof);
  return proof;
}
export function assertVerifiedLGroupAds(rows, proof) {
  assertVerifiedLResidual(proof);
  const allowed = ["827349040712", VERIFIED_L.ad],
    seen = new Set();
  if (!Array.isArray(rows) || rows.length !== 2) fail();
  for (const row of rows) {
    const a = row.adGroupAd;
    if (
      row.campaign?.id !== VERIFIED_L.campaign ||
      row.adGroup?.id !== VERIFIED_L.group ||
      !a ||
      !allowed.includes(a.ad?.id) ||
      a.resourceName !==
        `customers/${VERIFIED_L.customer}/adGroupAds/${VERIFIED_L.group}~${a.ad.id}` ||
      a.status !== "PAUSED" ||
      a.ad.type !== "RESPONSIVE_SEARCH_AD" ||
      seen.has(a.resourceName)
    )
      fail();
    seen.add(a.resourceName);
  }
}
export function assertVerifiedLDeliveryAds(rows, proof) {
  assertVerifiedLResidual(proof);
  const allowed = new Map([
      ["827349040712", [VERIFIED_L.campaign, VERIFIED_L.group]],
      [VERIFIED_L.ad, [VERIFIED_L.campaign, VERIFIED_L.group]],
      ["827487091340", ["24339483523", "200180930839"]],
      ["827362851813", ["24339483523", "200180931039"]],
    ]),
    seen = new Set();
  if (!Array.isArray(rows) || rows.length !== 4) fail();
  for (const row of rows) {
    const a = row.adGroupAd,
      parent = allowed.get(a?.ad?.id);
    if (
      !parent ||
      row.campaign?.id !== parent[0] ||
      row.adGroup?.id !== parent[1] ||
      a.status !== "PAUSED" ||
      a.ad.type !== "RESPONSIVE_SEARCH_AD" ||
      a.resourceName !==
        `customers/${VERIFIED_L.customer}/adGroupAds/${parent[1]}~${a.ad.id}` ||
      seen.has(a.resourceName)
    )
      fail();
    seen.add(a.resourceName);
  }
}
