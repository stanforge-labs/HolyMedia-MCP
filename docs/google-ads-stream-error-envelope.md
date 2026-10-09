# Google Ads REST streaming error envelopes

Google-only product correction: `googleAdsApiError` previously assumed the HTTP body was one object. A fresh READ acceptance request instead received an HTTP400 flat array containing an `error.details[].GoogleAdsFailure`. The mapper discarded that shape, and the generic HTTP fallback lost the granular Google query error code. No provider request is repeated by this fix.

Official contracts: [v24 SearchStream](https://developers.google.com/google-ads/api/reference/rpc/v24/GoogleAdsService/SearchStream), [REST JSON mappings](https://developers.google.com/google-ads/api/rest/design/json-mappings), [Google error structure](https://developers.google.com/google-ads/api/docs/best-practices/understand-api-errors). SearchStream uses array-wrapped REST messages; GoogleAdsFailure carries granular error entries and request IDs. The array-wrapped **HTTP400 error** case is an observed acceptance transport shape; it is not a claim that every REST error endpoint returns arrays.

The existing mapper now accepts either its original object or a flat array of at most 50 envelopes. It inspects at most 50 detail records per envelope, reports at most 50 error entries total, and bounds field path parsing to 50 elements. It does not recursively unwrap nested arrays or arbitrary response wrappers. Success-only, malformed-only and oversized arrays return no Google-specific mapping, leaving the existing generic failure path intact; no synthetic local code is disguised as a Google error.

Original safe Google codes, field paths, message redaction, manager-metrics specialization and HTTP401/403/429/5xx classification remain. The first valid safe request ID is preserved; unsafe IDs no longer suppress a valid response header fallback. Multiple envelopes retain input error order. Upstream tokens, secrets, cookies and Authorization values are not emitted.

Only the Google mapper and regressions changed. Meta and generic provider HTTP code, request execution, mutation plans and approval guards are untouched. Verification is MOCK-only through providerJson and pure parser tests: no external Google calls, validate_only or writes.
