"""VPS-only isolated acceptance provisioning. Never prints secret values."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys

ROOT = Path('/opt/holymedia-google-acceptance')
PROJECT = 'holymedia-google-acceptance'
SOURCE = '7da2fbbe7d150072183bc5e121cae4abae019ddc'
TAG = 'ghcr.io/stanforge-labs/holymedia-mcp-v2:google-live-acceptance-' + SOURCE
PRODUCTION_FILES = ['/etc/holymedia-v2/app.env', '/etc/holymedia-v2/compose.env']

def command(args):
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('command_failed:' + args[0])
    return result.stdout

def production():
    ids = command(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=holymedia-v2']).split()
    if len(ids) != 5:
        raise RuntimeError('production_service_count_mismatch')
    data = json.loads(command(['docker', 'inspect'] + ids))
    services = {}
    for item in data:
        service = item['Config']['Labels']['com.docker.compose.service']
        if item['State'].get('Health', {}).get('Status') != 'healthy':
            raise RuntimeError('production_unhealthy:' + service)
        services[service] = {'id': item['Id'], 'image': item['Image'], 'started': item['State']['StartedAt'], 'restarts': item['RestartCount']}
    if set(services) != {'api', 'web', 'worker', 'postgres', 'redis'}:
        raise RuntimeError('production_service_set_mismatch')
    return {'services': services, 'files': {p: hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in PRODUCTION_FILES}}

def verify_production():
    if production() != json.loads((ROOT / 'production-baseline.json').read_text()):
        raise RuntimeError('production_changed_stop')

def verify_isolation():
    from urllib.parse import urlsplit
    ids = command(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.project=' + PROJECT]).split()
    if len(ids) != 3:
        raise RuntimeError('acceptance_service_count_mismatch')
    for item in json.loads(command(['docker', 'inspect'] + ids)):
        service = item['Config']['Labels']['com.docker.compose.service']
        if item['State'].get('Health', {}).get('Status') != 'healthy':
            raise RuntimeError('acceptance_unhealthy:' + service)
        if set(item['NetworkSettings']['Networks']) != {PROJECT + '_default'}:
            raise RuntimeError('acceptance_network_mismatch')
        published = {key: value for key, value in item['NetworkSettings']['Ports'].items() if value}
        if service == 'api':
            if published != {'4001/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '4400'}]}:
                raise RuntimeError('acceptance_port_binding_mismatch')
            if item['Config']['Labels'].get('org.opencontainers.image.revision') != SOURCE:
                raise RuntimeError('acceptance_source_mismatch')
            values = dict(x.split('=', 1) for x in item['Config']['Env'])
            db = urlsplit(values['DATABASE_URL'])
            redis = urlsplit(values['REDIS_URL'])
            if db.hostname != 'postgres' or db.path != '/google_acceptance' or redis.hostname != 'redis':
                raise RuntimeError('acceptance_database_or_redis_mismatch')
            write_gate = values['PROVIDER_GOOGLE_ADS_WRITE_ENABLED']
            write_allowlist = values['GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST']
            if not ((write_gate == 'false' and not write_allowlist) or (write_gate == 'true' and write_allowlist == '8590146099')):
                raise RuntimeError('acceptance_write_gate_or_allowlist_invalid')
            if any(values[key] != 'false' for key in ['PUBLIC_MCP_WRITE_SCOPE_ENABLED', 'PUBLIC_MCP_CONTROLLED_WRITE_ENABLED', 'V2_CONFIRMED_WRITE_ENABLED']) or values['V2_PREVIEW_ONLY'] != 'true':
                raise RuntimeError('acceptance_commit_or_public_write_enabled')
            if any(mount['Type'] != 'bind' or not mount['Source'].startswith(str(ROOT) + '/') for mount in item['Mounts']):
                raise RuntimeError('acceptance_api_mount_mismatch')
        else:
            if published or any(mount['Type'] != 'volume' or not mount['Name'].startswith(PROJECT + '_acceptance-') for mount in item['Mounts']):
                raise RuntimeError('acceptance_infrastructure_mount_or_port_mismatch')
    print('ISOLATION_PASS: dedicated network/volumes/DB/Redis; only 127.0.0.1:4400 published; exact source; public/confirmed writes OFF; no real mutate permitted')

def read_env(path, allowed=None):
    values = {}
    for line in Path(path).read_text().splitlines():
        match = re.match(r'^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$', line)
        if not match or (allowed is not None and match[1] not in allowed):
            continue
        key, value = match.groups()
        if key in values:
            raise RuntimeError('duplicate_env_key:' + key)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if '\n' in value or '\r' in value or '\x00' in value:
            raise RuntimeError('invalid_env_value:' + key)
        values[key] = value
    return values

def write_env(values):
    # Single quotes prevent Compose dollar interpolation of the copied secret.
    if any("'" in value for value in values.values()):
        raise RuntimeError('unsupported_env_quote')
    path = ROOT / 'acceptance.env'
    with path.open('w') as stream:
        for key, value in values.items():
            stream.write(key + "='" + value + "'\n")
    os.chmod(path, 0o600)

def compose(*args):
    return command(['docker', 'compose', '-p', PROJECT, '--env-file', str(ROOT / 'acceptance.env'), '-f', str(ROOT / 'compose.yml')] + list(args))

def initialize(upload):
    baseline = production()
    if ROOT.exists():
        raise RuntimeError('acceptance_directory_already_exists')
    if shutil.disk_usage('/').free < 10 * 1024**3:
        raise RuntimeError('insufficient_disk')
    if command(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + PROJECT]).strip():
        raise RuntimeError('acceptance_project_already_exists')
    if any(':4400 ' in line for line in command(['ss', '-ltn']).splitlines()):
        raise RuntimeError('port_4400_in_use')
    allowed = {'PROVIDER_GOOGLE_CLIENT_ID', 'PROVIDER_GOOGLE_CLIENT_SECRET', 'AD_MCP_GOOGLE_OAUTH_CLIENT_ID', 'AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET'}
    google = read_env('/etc/holymedia-v2/app.env', allowed)
    client = google.get('PROVIDER_GOOGLE_CLIENT_ID') or google.get('AD_MCP_GOOGLE_OAUTH_CLIENT_ID')
    secret = google.get('PROVIDER_GOOGLE_CLIENT_SECRET') or google.get('AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET')
    if not client or not secret:
        raise RuntimeError('google_oauth_configuration_unavailable')
    ROOT.mkdir(mode=0o700)
    (ROOT / 'harness').mkdir(mode=0o755)
    (ROOT / 'state').mkdir(mode=0o700)
    os.chown(ROOT / 'state', 1000, 1000)
    for filename in ['guard.mjs', 'gateway.mjs', 'seed.mjs', 'approval.html', 'approval.mjs', 'approval.css']:
        shutil.copyfile(upload / filename, ROOT / 'harness' / filename)
        os.chmod(ROOT / 'harness' / filename, 0o644)
    shutil.copyfile(upload / 'compose.yml', ROOT / 'compose.yml')
    os.chmod(ROOT / 'compose.yml', 0o600)
    (ROOT / 'production-baseline.json').write_text(json.dumps(baseline))
    os.chmod(ROOT / 'production-baseline.json', 0o600)
    db_password, redis_password = secrets.token_hex(32), secrets.token_hex(32)
    write_env({
        'ACCEPTANCE_IMAGE': TAG,
        'POSTGRES_USER': 'google_acceptance', 'POSTGRES_DB': 'google_acceptance', 'POSTGRES_PASSWORD': db_password,
        'ACCEPTANCE_REDIS_PASSWORD': redis_password,
        'DATABASE_URL': 'postgresql://google_acceptance:' + db_password + '@postgres:5432/google_acceptance',
        'REDIS_URL': 'redis://:' + redis_password + '@redis:6379',
        'NODE_ENV': 'development', 'V2_CONFIG_STRICT': 'true', 'API_PORT': '4000', 'LOG_LEVEL': 'warn',
        'SESSION_HASH_SECRET': secrets.token_hex(32),
        'PROVIDER_CREDENTIAL_ENCRYPTION_KEYS': '1:' + base64.b64encode(secrets.token_bytes(32)).decode(),
        'PROVIDER_CREDENTIAL_CURRENT_KEY_VERSION': '1',
        'PROVIDER_GOOGLE_CLIENT_ID': client, 'PROVIDER_GOOGLE_CLIENT_SECRET': secret,
        'PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID': '4378327049', 'PROVIDER_GOOGLE_API_VERSION': 'v24',
        'PROVIDER_GOOGLE_REDIRECT_URI': 'http://localhost:4400/api/v1/oauth/GOOGLE_ADS/callback',
        'PROVIDER_GOOGLE_ADS_WRITE_ENABLED': 'false', 'GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST': '',
        'PUBLIC_MCP_WRITE_SCOPE_ENABLED': 'false', 'PUBLIC_MCP_CONTROLLED_WRITE_ENABLED': 'false',
        'V2_CONFIRMED_WRITE_ENABLED': 'false', 'V2_PREVIEW_ONLY': 'true',
        'HOLYMEDIA_ADMIN_ENABLED': 'false', 'SITE_AUDIT_PRODUCT_ENABLED': 'false',
        'HOLYMEDIA_PUBLIC_BASE_URL': 'http://localhost:4400', 'CORS_ORIGINS': 'http://localhost:4400',
        'ACCEPTANCE_PASSWORD': secrets.token_hex(32),
    })
    compose('config', '--quiet')
    verify_production()
    print('ACCEPTANCE_CONFIGURATION_READY: root:root mode600; fresh vault/session/DB/Redis secrets; Google OAuth available; write OFF/EMPTY')

def start():
    verify_production()
    command(['docker', 'pull', TAG])
    image = json.loads(command(['docker', 'image', 'inspect', TAG]))[0]
    if image['Config']['Labels'].get('org.opencontainers.image.revision') != SOURCE or image['Config']['User'] != 'node':
        raise RuntimeError('image_source_identity_mismatch')
    digest = next(x.split('@')[1] for x in image['RepoDigests'] if x.startswith('ghcr.io/stanforge-labs/holymedia-mcp-v2@'))
    if shutil.disk_usage('/').free < 10 * 1024**3:
        raise RuntimeError('insufficient_disk_after_pull')
    values = read_env(ROOT / 'acceptance.env')
    values['ACCEPTANCE_IMAGE'] = TAG + '@' + digest
    write_env(values)
    compose('up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'redis')
    compose('run', '--rm', '--no-deps', 'api', 'pnpm', '--dir', 'packages/database', 'run', 'prisma:deploy')
    status = compose('run', '--rm', '--no-deps', 'api', 'pnpm', '--dir', 'packages/database', 'run', 'prisma:status')
    if 'Database schema is up to date' not in status:
        raise RuntimeError('prisma_status_not_clean')
    compose('run', '--rm', '--no-deps', 'api', 'node', '/acceptance/seed.mjs')
    compose('up', '-d', 'api')
    verify_production()
    print('ACCEPTANCE_STARTED; PRISMA_CLEAN; EXACT_SOURCE=' + SOURCE + '; DIGEST=' + digest)

try:
    if os.geteuid() != 0:
        raise RuntimeError('sudo_required')
    if sys.argv[1] == 'init':
        initialize(Path(sys.argv[2]).resolve())
    elif sys.argv[1] == 'start':
        start()
    elif sys.argv[1] == 'verify':
        verify_production()
        print('PRODUCTION_UNCHANGED_HEALTHY')
        print(compose('ps', '--format', '{{.Service}} {{.State}} {{.Health}}'))
        if compose('ps', '-q', 'api').strip():
            verify_isolation()
    else:
        raise RuntimeError('unsupported_action')
except Exception as error:
    # Never print subprocess stderr, requests, env values or exception details.
    print('ACCEPTANCE_STOP: ' + (str(error) if isinstance(error, RuntimeError) else type(error).__name__))
    sys.exit(1)
