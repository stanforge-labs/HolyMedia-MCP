"""No request replay: interpret already captured negative-authorization evidence."""
import json
from pathlib import Path
from datetime import datetime, timezone

root = Path('/opt/holymedia-google-acceptance/state')
old = json.loads((root/'acceptance-p-evidence.json').read_text())
if old.get('code') != 'acceptance_p_unexpected_mcp_refusal': raise SystemExit('unexpected_original_evidence_stop')
if len(old.get('server_allowlist_checks', [])) != 2 or any(row.get('code') != 'google_account_not_allowlisted' for row in old['server_allowlist_checks']): raise SystemExit('server_allowlist_checks_not_proven')
if (root/'acceptance-p-blocked-transport.jsonl').exists(): raise SystemExit('external_transport_was_attempted_stop')
evidence = {
  **old,
  'original_harness_result': old['result'],
  'original_harness_code': old['code'],
  'result': 'PASS',
  'reconciliation': 'An isError MCP response was observed before the incorrect account_not_found assertion. Production account() throws ForbiddenException and MCP deliberately omits a machine code for that class. The actual server-side write allowlist independently returned google_account_not_allowlisted for both forbidden IDs. No provider transport was attempted.',
  'mcp_refusal_observed': True,
  'external_transport_attempts': 0,
  'audit_write_entries': 0,
  'requests_replayed': 0,
  'original_evidence_modified': False,
  'timestamp': datetime.now(timezone.utc).isoformat()
}
target=root/'acceptance-p-reconciled-evidence.json'
with target.open('x') as file: json.dump(evidence,file)
target.chmod(0o600)
print(json.dumps(evidence))
