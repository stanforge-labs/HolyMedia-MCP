# Acceptance I: one-shot commit readiness

This packet is code/mock tested only. It does not execute Google calls, create a preview, approve anything or submit a restoration.

The API source is pinned to `55d9df3553ff1ad01586978b6e4ecc07913969c5` and its verified image digest. Actual harness Git identity is separate: the preview supervisor now requires `--harness-head`; the commit supervisor requires `--harness-head` and `--preview-harness-head`.

`run-audience-commit.py` requires an exact `--authorize-exact-preview` UUID, `--preview-run-id`, unique `--run-id`, source/image pins and protected unchanged parent files. First use a separate unique run with `--db-precheck`: this verifies persisted approval, owner/key/session/audit/TTL and immutable plan without credential decryption, token refresh, Google calls or API startup. It does not claim a live write. The subsequent explicitly authorized run claims the parent once, then stock MCP and Google mutation each have exclusive retained claims. Failed or ambiguous runs cannot be automatically retried.

The committed plan must contain exactly the initial ABSENT-to-OBSERVATION ad-group restriction update and AFFINITY `90100` criterion creation in TEST Client `8590146099`, group `206587491811`, campaign `24324170853`. Both operations are atomic (`partial_failure=false`). No revalidation, preview replacement or caller payload change is allowed.

The five-minute discovery-artifact freshness rule applies only to JIT preview preparation. Commit instead verifies the persisted preview's actual TTL and fresh TEST/hierarchy/full raw fixture snapshot plus CPC proof. A manual approval after ten minutes is not rejected merely because the earlier discovery artifact aged.

Post-read verification preserves all eleven original inventories including the verified L RSA and its raw metadata. Only one new owned USER_INTEREST criterion and the declared AUDIENCE OBSERVATION restriction are permitted. An omitted protobuf `negative=false` is normalized only for that new criterion. Two successful operation journal entries plus the matching commit-result event are required.

The resulting evidence includes a pure restoration request derived from the actual VERIFIED created criterion ID. It proposes `audience_remove` with `acknowledge_irreversible:true`, requires a new human approval and is never automatically submitted. Removal leaves the disclosed OBSERVATION restriction: restoration to the original absent restriction is a local implementation gap, not a Google API limitation. Acceptance I is not claimed fully restored until the later controlled removal is verified and that residual is acknowledged.
