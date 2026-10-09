import { Buffer } from "node:buffer";
import {
  VERIFIED_L as L,
  readVerifiedLResidual,
} from "./verified-l-residual.mjs";
export function mockLProof(change = (r) => r, options = {}) {
  const r = change({
    result: "L_COMMIT_VERIFIED",
    source_head: L.source,
    harness_head: L.harness,
    test_customer_id: L.customer,
    campaign_id: L.campaign,
    ad_group_id: L.group,
    commit: {
      status: "VERIFIED",
      commit_id: L.commit,
      account_id: L.customer,
      operation_count: 1,
      partial_failure: true,
      atomic: false,
      provider_mutation_attempted: true,
      items: [
        {
          success: true,
          operations: [
            {
              resource_name: L.resource,
              success: true,
              error: null,
              actual: {
                resourceName: L.resource,
                status: "PAUSED",
                ad: { id: L.ad },
              },
            },
          ],
        },
      ],
    },
    created_rsa: { ad_id: L.ad, resource_name: L.resource, status: "PAUSED" },
    approval: {
      preview_id: L.preview,
      confirmed_at: "2026-10-09T20:20:00Z",
      expires_at: "2026-10-09T20:30:00Z",
      session_valid: true,
      audit_valid: true,
    },
    audit: [
      "mcp_preview_web_approved",
      "mcp_google_stage1_operation",
      "mcp_google_commit_result",
    ].map((type) => ({ type, success: true })),
    real_provider_write_call_count: 1,
    validate_only_call_count: 0,
    production_changed: false,
    main_changed: false,
  });
  return readVerifiedLResidual({
    read: () => Buffer.from(JSON.stringify(r)),
    stat: () => ({
      isFile: () => true,
      isSymbolicLink: () => false,
      mode: 0o600,
      uid: 1000,
      size: 1000,
      ...options.stat,
    }),
    hash: () => options.hash ?? L.sha256,
  });
}
export function mockLAd(ad = L.ad, campaign = L.campaign, group = L.group) {
  return {
    campaign: { id: campaign },
    adGroup: { id: group },
    adGroupAd: {
      resourceName: `customers/${L.customer}/adGroupAds/${group}~${ad}`,
      status: "PAUSED",
      ad: { id: ad, type: "RESPONSIVE_SEARCH_AD" },
    },
  };
}
