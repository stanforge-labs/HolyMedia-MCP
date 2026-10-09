# Stage 3 I/J, PMax prerequisites and private Q/R/S readiness

This package is **READ/mock scenario preparation only**. It does not execute requests, create a preview, approve, commit, upload media, create goals, or perform cleanup. Prepared typed intents are proposals for the existing stock MCP flow, not authorization or evidence of a live PASS.

Prepared baseline: `94edb8c3c082bbd8951bf166e8797e83f3b8a5dc`. Callers must pass the actual immutable candidate source SHA and fresh READ proof from that same source; the baseline is not a claim that an old runtime executes new code.

## Functions and proof shape

`scripts/google-live-acceptance/stage234/scenario-targeting-readiness.mjs` exports:

- `TARGETING_READ_QUERIES`: fixed bounded GAQL manifest. These are future authorized READs, not requests already run by this package. A separate authorized runner must integrate the exact manifest explicitly; existing transport guards are not modified.
- `classifyTargetingRead(input, init)`: only Google Ads API v24 searchStream, the exact TEST Client `8590146099`, login MCC `4378327049`, and exact manifest queries. MCC permits **only** the direct TEST-child hierarchy query. Any mutation, validate-only mutation, approval endpoint, extra payload, changed query, foreign customer, missing/mismatched login header or another origin is rejected.
- `prepareAudienceIScenario(proof, expectedSource, now)`: candidate OBSERVATION audience add using a real, owned, eligible supplied catalog row and the existing paused fixture; otherwise structured HOLYMEDIA blockers. No actual new criterion ID or remove payload is invented.
- `prepareGeoJScenario(proof, expectedSource, now)`: city by resolved provider name/ID, excluded district with proven provider parent relationship, plus explicitly supplied TEST proximity coordinates. It returns one closed typed three-row proposal only after all evidence exists.
- `pmaxPrerequisiteReadiness(proof, expectedSource, now)`: reports existing enabled same-account conversion actions, image dimensions/file size/MIME, text candidates and observed paused PMax brand-guidelines booleans. No PMax brief/create operation is generated.
- `crossClientReadiness(proof, expectedSource)`: separates connected-client preparation from live Q/R/S acceptance; it never reports LIVE PASS from connection booleans or mocks.

Common fixture proof is a closed object containing `source_head`, `verified_at`, selected `customer`, direct-child `hierarchy`, campaign/group snapshots, 21 existing keyword snapshots and the existing RSA snapshot. It requires TEST proof, same owned identities, campaign/group/RSA PAUSED, all 20 original keywords ENABLED, residual PHRASE `11479221` PAUSED, a valid account timezone and a maximum two-minute proof age. Selected fields must be projected from actual queried rows; never synthesize catalog IDs or substitute production credentials. Source/owner/status changes block readiness. Inventory and nested secret-bearing inputs are bounded/rejected; output contains typed semantics, counts/digests and static safe blockers, not raw credentials or tokens.

## I — audience OBSERVATION

The previous sample of **100 VERTICAL_GEO rows is insufficient evidence** for eligible IN_MARKET/AFFINITY absence. This helper returns `audience_eligibility_not_proven`, `BOUNDED_SAMPLE_ONLY` and `absence_of_eligible_catalog_proven=false` when it has no qualified new audience. Targeted provider READs may yield a different eligible inventory. Search user lists need OPEN membership, ENABLED account list and `eligible_for_search=true`; taxonomy segments need correct kind plus actual launch/channel availability. Detailed-demographic IDs come only from owned real catalog rows with availability proof. CUSTOM on Search is not fabricated as supported.

The proposed audience row explicitly states `mode=OBSERVATION`. Existing criteria are not removed/replaced. Campaign/group audience-mode conflicts are blockers; the stock builder remains authoritative for inherited mode, incremental restriction operations, ownership, duplicates, stale checks and Google validate-only. After a separately approved live add, record the provider-created criterion identity; any restore is a new approved controlled removal with explicit irreversible acknowledgement.

## J — city / exclusion / proximity

The prepared city scenario uses provider-resolved **Astana City in KZ**, never a hardcoded ID. District inventory is bounded, and a district must have `parent_geo_target` matching the selected city. Ambiguous/missing matches, existing criteria, mismatched resource IDs and country/status errors block the proposal. The stock builder must re-resolve through GeoTargetConstantService and freeze an exact GAQL constant proof before approval.

Owned existing campaign DEVICE criteria are retained in the full preserved-criteria digest, including optional `bidModifier` exactly as read (absence is not changed to 1; device opt-out 0 remains 0). The device object is closed to the actual v24 device type enum; modifiers must be finite numeric 0.1–10, with 0 allowed only for DEVICE. Unknown/unspecified devices, extra fields, foreign parents and string/null modifiers block planning. This READ snapshot support neither adds a device mutation to the J plan nor weakens country/parent/coordinate checks. Primary fields: [v24 CampaignCriterion](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/campaign_criterion.proto), [v24 DeviceEnum](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/enums/device.proto).

Google's [v24 GeoTargetConstant proto](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/geo_target_constant.proto) has canonical name and parent reference, but no center coordinates. Therefore radius center coordinates require separately explicit TEST input, not guessed coordinates or a fake geocoding result. Radius is typed 1–500 kilometers/miles; existing criteria get a preserved snapshot digest. Future Google validate-only still decides provider/privacy restrictions. Remove only newly created exact criterion identities through new previews/approvals; preserve neighboring geo/language/proximity settings.

## PMax prerequisites, not policy or live readiness

Usable conversion actions must actually exist, be ENABLED and owned by the TEST conversion customer. Cross-account ownership is blocked. `primary_for_goal` is reported, not silently changed; selecting an action for a new explicit custom goal still belongs to the stock approved PMax profile. This package does not create goals or fabricate conversion history.

Existing media are **metadata candidates**: landscape at least 600×314 with 1.91 ratio, square at least 300×300, logo square at least 128×128, bounded PNG/JPEG bytes/dimensions and text at most 25 characters. The helper does not inspect binary content, verify branding rights/identity, moderation, or existing field-type associations. Thus `PREREQUISITES_OBSERVED_NOT_LIVE` still requires exact selected-resource reread, user review of brand/media contents, asset-association/brand-guidelines minimum checks and stock Google validate-only. Any empty bounded sample means prerequisites unproven, not global account absence. No upload, image generation or PMax create is authorized. [Google PMax asset requirements](https://developers.google.com/google-ads/api/performance-max/assets).

## Q/R/S connection action

Connect the **private source-pinned candidate** through stock user OAuth in ChatGPT and one second MCP client, selecting the `google_ads_write` profile. Do not paste passwords, cookies, access/refresh tokens or API keys into chat. First verify private tools/list and a TEST READ. Q/R still require actual client A/B/C/M evidence; S requires actual persisted human approval before commit. A schema/build/mock or a connection flag is not LIVE evidence. No public write URL, fixed credential or automatic consent is provided.

## Next authorized runner steps

1. Verify exact OCI source/digest, isolated acceptance resources, TEST proof, flags/allowlist, private approval page and audit readiness.
2. Execute only explicitly permitted fixed READs with a transport guard. Do not broaden production/read scopes or reuse an old runtime.
3. Normalize the selected queried metadata into these closed proof structures without invented values. Keep complete criteria snapshots and exact returned catalog/resource IDs.
4. Prepare I/J proposal only when all proofs exist. Stock parser/builder/mock tests confirm compatibility, but live preview still requires normal ownership/stale/validate-only protections.
5. Create exactly one just-in-time stock preview; obtain a human approval before any immutable commit. Reconcile only by READ if a future commit is ambiguous. No retries or raw cleanup.

All synthetic IDs/coordinates in the regression tests are explicitly mock fixtures; they must not become live defaults. Product Stage 3/PMax code, common transport, runtime, historical evidence, main and production are unchanged by this package.
