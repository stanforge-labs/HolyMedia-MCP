# Immutable acceptance artifacts and secret scanning

Date: 2026-10-09. New findings were investigated independently; no assumption that the earlier E-status review covered them.

Nine files produced 17 scanner matches. Inspection located every match in a public readiness/status literal or an assignment of that literal, not an OAuth/provider credential. The review is represented by exact artifact paths, full SHA256 content hashes and individual match digests in `v2-secret-scan-policy.mjs`. It is not a directory exclusion, token-family exception or global status allowlist.

Regression requires the reviewed fixtures to exist. Altered bytes, another path, a different match, an additional EA-style token, Google client secret or OpenAI key remain rejected. The original credential-family and forbidden-path checks are unchanged.

Specific `.gitattributes -text` entries preserve immutable historical bytes, including CRLF where present, on Windows and Linux. This does not exempt files from secret scanning. Application source continues to use the integration branch's LF policy.

Historical commit/audit evidence is not rewritten. The original Stage0 fixture result remains UNVERIFIED with a separate VERIFIED reconciliation. T live creation has its own VERIFIED evidence; a separate resource-ID supplement corrects only the harness's RSA display extraction.

Release authorization remains separate. Production/main were not modified; integration review, cross-client acceptance and any infrastructure-dependent skipped checks must be assessed before deployment.
