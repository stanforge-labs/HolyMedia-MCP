# Meta read-only reviewer repair — verification record

## Baseline and root causes

Source: user-supplied `holymedia-test-results.json` (2026-09-11). The actual file contains 14 result envelopes, but no original call arguments and no detailed-report result. Therefore a full exact argument replay cannot be inferred from that file.

Production logs around 08:20–08:25 UTC correlate the asset failures with `ForbiddenException` / 403. Requests without `account_id` failed the mandatory account resolver. Requests containing `account_id` reached the blanket connection-wide restriction for account-restricted credentials. Pages and businesses were incorrectly routed through that ad-account-only boundary. `get_connected_assets` used another compatibility branch without that guard, explaining its successful discovery.

Detailed report previously returned campaign discovery without Insights. Flexible Insights used the normalized summary adapter, discarding requested fields, breakdowns and raw action arrays. Campaign pagination used a local offset over the first fetched subset.

## Implemented authorization

The caller must have read scope. An enabled, token-authorized account in the caller workspace selects a current Meta connection. Page and business IDs are checked against live assets of that connection's credential, never against ad-account UUIDs. Business ad accounts are intersected with enabled/token-authorized accounts. No read authorization contains fixed tenant, token, account, page or business IDs. No cross-tenant asset cache exists.

List discovery is bounded; responses indicate truncation at the discovery ceiling. Insights, campaign and post reads expose provider cursors. Direct ad/campaign/adset reads verify returned account ownership. Known Page post reads verify Page-qualified IDs.

Detailed reports contain campaign-level Insights and explicitly cover campaigns with Insights in the requested period. Status lookups are limited to five concurrent requests. Missing numeric values remain null, not fabricated zeroes. Raw action arrays accompany normalized conversion totals; those totals are not a universal campaign-objective result definition.

## Validation and error contracts

Meta metric allowlist, conservative breakdown combinations, date ordering/calendar validation and bounded ranges/limits are enforced server-side. Domain errors include safe code, operation, retryability, user action and sanitized numeric upstream codes. Logs include request/workspace/connection/asset context, never credential values.

## Acceptance still required

- Production candidate CI, immutable image and controlled deploy.
- Live matrix using the actual user credential associated with the supplied baseline.
- A second ordinary user with an independent Meta OAuth connection and different assets. Unit fixtures demonstrate isolation but are not live second-user evidence.
- Reviewer account entitlement/expiry verification through 2026-10-01.
- Sanitized AFTER JSON with actual responses, not inferred successes.

At implementation time the task's MCP connection authenticates to a different workspace from the baseline. No plaintext token was requested or recovered. No browser was used.

## Write scope

No provider mutations performed. Existing controlled-write policy is unchanged. Its exact-resource restriction remains a separate future review topic; this read repair does not claim asset-independent writes.
