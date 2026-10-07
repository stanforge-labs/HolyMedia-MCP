"""Acceptance-only guard installation / exact two-key preview gate update."""
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

ROOT = Path('/opt/holymedia-google-acceptance')
UPLOAD = Path('/home/ubuntu/holymedia-google-acceptance-harness')
API = 'holymedia-google-acceptance-api-1'

def run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('acceptance_command_failed')
    return result.stdout

def verify():
    run(['python3', str(UPLOAD / 'provision.py'), 'verify'])

def wait_healthy():
    for _ in range(45):
        if json.loads(run(['docker', 'inspect', API]))[0]['State'].get('Health', {}).get('Status') == 'healthy':
            verify()
            return
        time.sleep(1)
    raise RuntimeError('acceptance_api_unhealthy')

try:
    if os.geteuid() != 0: raise RuntimeError('sudo_required')
    verify()
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    if sys.argv[1] == 'guard':
        target = ROOT / 'harness/guard.mjs'
        backup = target.with_name('guard.mjs.pre-fixture-' + stamp + '.bak')
        shutil.copy2(target, backup)
        shutil.copyfile(UPLOAD / 'guard.mjs', target)
        os.chown(target, 0, 0)
        os.chmod(target, 0o644)
        for name in ['prove-fixture-account.mjs', 'prepare-fixture.mjs']:
            shutil.copyfile(UPLOAD / name, ROOT / 'harness' / name)
            os.chmod(ROOT / 'harness' / name, 0o644)
        run(['docker', 'exec', API, 'node', '--check', '/acceptance/guard.mjs'])
        print('GUARD_INSTALLED; BACKUP=' + str(backup))
    elif sys.argv[1] == 'approval':
        target = ROOT / 'harness/gateway.mjs'
        backup = target.with_name('gateway.mjs.pre-fixture-approval-' + stamp + '.bak')
        shutil.copy2(target, backup)
        for name in ['gateway.mjs', 'approval.html', 'approval.mjs', 'approval.css', 'verify-fixture-approval.mjs']:
            shutil.copyfile(UPLOAD / name, ROOT / 'harness' / name)
            os.chown(ROOT / 'harness' / name, 0, 0)
            os.chmod(ROOT / 'harness' / name, 0o644)
        run(['docker', 'exec', API, 'node', '--check', '/acceptance/gateway.mjs'])
        run(['docker', 'restart', API])
        wait_healthy()
        print('ACCEPTANCE_APPROVAL_UI_READY; BACKUP=' + str(backup))
    elif sys.argv[1] == 'gate':
        proof = json.loads((ROOT / 'state/test-proof.json').read_text())
        verified = datetime.datetime.fromisoformat(proof['verified_at'].replace('Z', '+00:00'))
        age = (datetime.datetime.now(datetime.timezone.utc) - verified).total_seconds()
        if proof['customer_id'] != '8590146099' or proof['test_account'] is not True or proof['mcc_id'] != '4378327049' or proof['hierarchy'] is not True or not 0 <= age <= 1800:
            raise RuntimeError('test_account_proof_failed_stop')
        target = ROOT / 'acceptance.env'
        backup = target.with_name('acceptance.env.pre-fixture-' + stamp + '.bak')
        before = target.read_text()
        after = before
        for key, old, new in [('PROVIDER_GOOGLE_ADS_WRITE_ENABLED', 'false', 'true'), ('GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST', '', '8590146099')]:
            pattern = r'^' + key + "='" + old + "'$"
            after, count = re.subn(pattern, key + "='" + new + "'", after, flags=re.MULTILINE)
            if count != 1: raise RuntimeError('unexpected_acceptance_gate_stop')
        if len([1 for a,b in zip(before.splitlines(), after.splitlines()) if a != b]) != 2:
            raise RuntimeError('unexpected_env_diff_stop')
        shutil.copy2(target, backup)
        target.write_text(after)
        os.chmod(target, 0o600)
        run(['docker', 'compose', '-p', 'holymedia-google-acceptance', '--env-file', str(target), '-f', str(ROOT / 'compose.yml'), 'up', '-d', '--no-deps', 'api'])
        wait_healthy()
        print('PREVIEW_GATE_ON_ACCEPTANCE_ONLY; ALLOWLIST=8590146099; BACKUP=' + str(backup))
    else: raise RuntimeError('unsupported_action')
except Exception as error:
    print(str(error) if isinstance(error, RuntimeError) else 'acceptance_fixture_install_failed')
    raise SystemExit(1)
