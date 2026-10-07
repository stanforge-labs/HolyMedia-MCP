"""Install only the acceptance gateway patch; preserve production baseline."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

ROOT = Path('/opt/holymedia-google-acceptance')
UPLOAD = Path('/home/ubuntu/holymedia-google-acceptance-harness')
TARGET = ROOT / 'harness/gateway.mjs'
API = 'holymedia-google-acceptance-api-1'
OLD_HASH = '196dc7da0fe988fa1bdb102d227af57680f69c6904770593a61aa160daf5da26'

def command(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('acceptance_command_failed')
    return result.stdout

def verify():
    command(['python3', str(UPLOAD / 'provision.py'), 'verify'])

def healthy():
    return json.loads(command(['docker', 'inspect', API]))[0]['State'].get('Health', {}).get('Status') == 'healthy'

try:
    if os.geteuid() != 0:
        raise RuntimeError('sudo_required')
    verify()
    old = TARGET.read_bytes().replace(b'\r\n', b'\n')
    if hashlib.sha256(old).hexdigest() != OLD_HASH:
        raise RuntimeError('unexpected_existing_gateway_stop')
    replacement = UPLOAD / 'gateway.mjs'
    command(['docker', 'exec', API, 'node', '--check', '/acceptance/gateway.mjs'])
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = TARGET.with_name('gateway.mjs.pre-callback-mapping-' + stamp + '.bak')
    shutil.copy2(TARGET, backup)
    shutil.copyfile(replacement, TARGET)
    os.chown(TARGET, 0, 0)
    os.chmod(TARGET, 0o644)
    try:
        command(['docker', 'exec', API, 'node', '--check', '/acceptance/gateway.mjs'])
        command(['docker', 'restart', API])
        for _ in range(45):
            if healthy():
                break
            time.sleep(1)
        else:
            raise RuntimeError('acceptance_health_failed')
        verify()
    except Exception:
        shutil.copy2(backup, TARGET)
        command(['docker', 'restart', API])
        raise RuntimeError('acceptance_gateway_restored_stop')
    print('CALLBACK_GATEWAY_INSTALLED; BACKUP=' + str(backup))
    print('ACCEPTANCE_HEALTHY; PRODUCTION_UNCHANGED_HEALTHY; WRITE_OFF; ALLOWLIST_EMPTY')
except Exception as error:
    print(str(error) if isinstance(error, RuntimeError) else 'acceptance_install_failed')
    raise SystemExit(1)
