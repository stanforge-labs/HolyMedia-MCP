# Acceptance L: isolated PAUSED RSA preview-only packet

Source baseline: 35054868ecde62c5c037855f8252418889dbbe43. New harness is not a live result.

## Contract

- Uses the real stock private MCP tool `google_ads_ads_assets_preview` and exact `plannedRsaArguments(false)`; one new RSA in existing TEST group 206587491811/campaign 24324170853, customer 8590146099.
- Create status is PAUSED. GoogleAdsService has exactly one adGroupAdOperation.create, validateOnly=true and partialFailure=true.
- Fetch preload rejects real mutate, altered create payload, foreign customer/login, broad queries, approvals, commit, cancellation and other MCP tools. Exclusive validation claim forbids retries.
- Only bounded fixed owned fixture reads and Stage4 builder queries are allowed. Fresh canonical TEST/MCC/hierarchy, paused delivery, existing RSA/keywords/targeting/budget snapshot must pass. After preview all snapshots must remain identical.
- Approval UI/session readiness and exact API readiness occur BEFORE the single JIT preview. No independent K/I/H/N tests consume preview TTL.
- Persisted Stage4 plan, intent, fields, expected state and snapshot digest must match exactly; preview audit must exist. Old baseline preview/audit hash must remain unchanged.
- Uses existing encrypted credential/scoped service key context; never provisions auth or exports secrets.
- New state `state/stage234-l-<run-id>`, `l-harness-source.json`, `proof.json`, `calls.jsonl`, encrypted `protected-preview-context.json` and sanitized `evidence.json`. All use mode600, directory700; never overwrite historical N files.
- Separate gateway: VPS127.0.0.1:4403 → gateway4001. Human local tunnel therefore localhost4403. Existing N gateway4402 is not stopped/replaced.

## Root-authorized operational handoff (not executed by this package)

```text
python3 run-rsa-preview.py --head <exact image source SHA40> --image ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:<digest64> --run-id <UTCYYYYMMDDTHHMMSSZ-unique> --context-basename stage234-scoped-context-<UTCYYYYMMDDTHHMMSSZ>.json --check-only
python3 run-rsa-preview.py <same arguments without --check-only>
```

Requires existing isolated healthy acceptance DB/Redis network and protected env/context. Supervisor refuses image source mismatch, production unhealthy/change, state collision or changed mounted harness manifest. It neither prepares/restarts networks nor edits config.

The detached runner emits the intended user-facing approval URL only after immutable DB/audit, validation and unchanged provider state checks pass. URL itself is user-facing; nonce/token is never separately printed. At this checkpoint **L live commit is pending**, not LIVE PASS. A separate explicit authorization and persisted human approval are required for any future commit; this packet cannot commit or cancel.

No VPS/provider/auth calls were executed while implementing/testing this packet.
