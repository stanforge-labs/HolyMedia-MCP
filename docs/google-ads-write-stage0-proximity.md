# Stage 0 coordinate-radius targeting

Engineering profile, 2026-10-09. This optional brief extension is implemented and mock-tested, **not live accepted**. Real Google Ads reads, validation and writes for this package: **0**. No DB migration, production change, main merge, deployment or new approval architecture.

The recovered original PPC DOCX (SHA256 `51C94D3D2953B32821DC872822147B1FF6C28E36258211D9DDD916BFF2C30DB0`) includes proximity in paragraphs 77–79. The source is specification data, not additional live-write authorization.

## Typed brief

`create_campaign_from_brief` retains its existing required locations and all existing defaults. Optional `proximities` supplies **additional inclusive** radius criteria:

```json
{
  "proximities": [
    {
      "latitude": 43.238949,
      "longitude": 76.889709,
      "radius": 10,
      "unit": "KILOMETERS"
    }
  ]
}
```

At most 50 closed objects. Latitude -90..90, longitude -180..180; finite numbers and at most six decimal places. Exact microdegree conversion is used; excess coordinate precision fails rather than silently rounding. Radius is finite 1..500 in KILOMETERS or MILES. This is a bounded conservative **product profile**, not a claim that 500 is a documented universal Google API limit. Google validates account/privacy/location eligibility with the existing `validate_only` flow; its published minimum radius is 1 km. MILES minimum 1 is intentionally stricter than 1 km.

No arbitrary Google objects, raw microdegrees, address geocoding, exclusion/negative radius, unknown units or duplicate identical radii are accepted. Invalid input fails before provider reads/validate-only. Radius criteria count toward the existing 500 underlying mutation limit; no truncation.

Locations and radius includes form a combined inclusive targeting collection, not a geographic intersection. Required locations are not silently removed by a radius; use the explicit brief locations intentionally. Default positive/negative geo mode remains PRESENCE.

## Exact provider and safety contract

Each optional radius adds one `CampaignCriterionOperation.create` to the existing atomic Search campaign mutation set:

```json
{
  "campaignCriterionOperation": {
    "create": {
      "campaign": "customers/<selected-account>/campaigns/<temporary-id>",
      "negative": false,
      "proximity": {
        "geoPoint": {
          "latitudeInMicroDegrees": 43238949,
          "longitudeInMicroDegrees": 76889709
        },
        "radius": 10,
        "radiusUnits": "KILOMETERS"
      }
    }
  }
}
```

Temporary campaign references are resolved through the same atomic transport: `partial_failure=false`, no automatic retry. Preview shows the coordinate center, radius/unit, include-only/PRESENCE and canonical expected fields. Campaign, groups and RSA remain PAUSED. No additional mutations/status changes are hidden.

Commit still accepts only the exact immutable stored preview token after manual browser approval, session/owner/audit verification, freshness and reference checks. Gates/allowlist/scope remain unchanged and OFF by default. Creation has no automatic destructive rollback.

Reread selects criterion type, campaign association, negative, both microdegree fields, radius and unit. Verification explicitly expects PROXIMITY, the created campaign association and exact supplied values. Wrong type/association/radius/unit/coordinates or exclusion produces UNVERIFIED, not false success. Selected protobuf default coordinate 0 may be omitted in JSON under the existing verifier contract.

## Clone limitation

Clone remains **PARTIAL**: source proximity is explicitly rejected with `google_clone_unsupported_components`. It is never silently dropped, including when new locations are supplied. Supporting safe source-radius preservation requires its own typed clone profile and regression; this patch does not pretend that scope is done.

## Mock evidence

New regressions cover unchanged 26-operation brief, optional KM/MILES payloads, PAUSED/PRESENCE defaults, validation-only atomic transport, immutable preview, exact provider verification and mismatch rejection, finite bounds/precision/duplicates/closed schema, operation limit, scope/account, expiry/approval and explicit clone rejection. Existing Stage 0 budget and Stage 0/1 controlled-flow regressions are included. No real Google credentials or provider calls are involved; full integration/live acceptance remains a separate authorization gate.

Targeted run: **116 PASS / 0 skipped**, including **37** new proximity cases. A stock controlled-flow mock proves one atomic mutate request with 27 underlying operations, separately counted validation-only and mocked commit, VERIFIED provider reread, PAUSED children and journal. Standard secret scan, targeted formatting/lint, API typecheck/build and schema validation are checked before handoff; root integration runs the broader suite independently.

## Primary Google API v24 references

- [ProximityInfo and GeoPointInfo](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/common/criteria.proto): radius, KILOMETERS/MILES and integer microdegrees.
- [CampaignCriterion proximity is immutable](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/campaign_criterion.proto).
- [Official location/proximity creation guide](https://developers.google.com/google-ads/api/docs/targeting/location-targeting).
- [Google radius/privacy minimum](https://support.google.com/google-ads/answer/1722043?hl=en).
- [Criterion error codes](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/errors/criterion_error.proto): INVALID_PROXIMITY_RADIUS, INVALID_PROXIMITY_RADIUS_UNITS, INVALID_LATITUDE, INVALID_LONGITUDE.
