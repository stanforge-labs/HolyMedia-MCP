# Remaining Meta READ capability fixes

Baseline: user-provided `holymedia-AFTER.json`. This change does not replace asset authorization or modify OAuth scopes, connection records, controlled writes or provider business data.

## Live diagnosis

Read-only requests with the existing selected account credential prove:

| Request                                                                   | Token context      | Result                      |
| ------------------------------------------------------------------------- | ------------------ | --------------------------- |
| Page `published_posts`, base fields + shares                              | Page               | HTTP 200                    |
| Direct Page-qualified post, base fields                                   | Same Page strategy | HTTP 200                    |
| Direct post, `id,shares`                                                  | Page               | HTTP 200                    |
| Direct post, `id,reactions.limit(0).summary(true)`                        | Page               | HTTP 400 / code 10          |
| Direct post, `id,comments.limit(0).summary(true)`                         | Page               | HTTP 400 / code 10          |
| Account Insights, spend + purchase_roas, account/campaign/adset/ad levels | User               | HTTP 200 on all four probes |

The configured/requested API version is v20.0; the live `facebook-api-version` response header is v25.0. No version change is made here.

Meta explicitly requires `pages_read_user_content` permission or `Page Public Content Access` feature for the tested reactions/comments reads. The granted scope list does not contain that permission. List posts succeeded because its existing field fallback removed reactions/comments; single-post read had no fallback and always requested reactions. This is not evidence of an invalid OAuth credential.

## Behavior

- `get_page_post` makes a fresh direct Graph GET using the existing Page-token resolver and base fields + shares. It does not reuse a previous list result.
- `get_page_post_engagement` requests actual engagement fields; when Meta supplies the specific requirement, HolyMedia exposes `meta_permission_required`, `required_permission`, and `alternative_feature`. Generic code 10 alone does not invent a named permission.
- `purchase_roas` was rejected locally because it was absent from the metric allowlist. It is now passed under its actual Meta name and parsed as action statistics, not replaced with another ROAS metric.
- The response distinguishes requested, returned, unsupported and unavailable metrics. Omitted ROAS is not fabricated as numeric zero. Empty action arrays are valid empty data.
- A deterministic code-100 mixed request containing ROAS may retry once without ROAS. Only if that request succeeds are its data returned with an explicit rejected-combination explanation. Auth failures and rate limits never enter this fallback. Arbitrary unknown metrics remain locally rejected.

## Review surface / remaining acceptance

The repository runbook `docs/beta/META_APP_REVIEW_RU.md` includes engagement in its demo, but contains no purchase_roas declaration. The external submitted Meta application was not inspected or changed. Full reactions/comments acceptance remains dependent on actual Meta permission/feature access; do not claim it is working merely because the error is now actionable.

The diagnostic script accepts explicit workspace/account/Page/post parameters and performs only GET requests. It emits endpoint, token **type**, version, safe response metadata and numeric metric samples, never credentials. It is provider-level evidence, not a replacement for the PPC client's authenticated MCP E2E.

Second-user / other-assets live E2E remains separate and must not be simulated.

Primary field reference: [Meta Business SDK AdsInsights](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py), which defines `purchase_roas` as `list<AdsActionStats>`.
