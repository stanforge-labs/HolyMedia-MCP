"""Source-pinned disposable N-preview launcher. No SSH, secrets output or writes.

Run only on the acceptance VPS after explicit authorization. --check-only performs
local Docker/config checks without launching the preview or provider requests.
Never restarts/recreates an existing application container.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path('/opt/holymedia-google-acceptance')
PROJECT = 'holymedia-google-acceptance'
NETWORK = PROJECT + '_stage234'


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def capture(command):
    result = subprocess.run(command, capture_output=True, text=True, timeout=120)
    require(result.returncode == 0, 'stage234_docker_check_failed')
    return result.stdout


def validate_options(head, image, run_id):
    require(re.fullmatch(r'[0-9a-f]{40}', head) is not None, 'stage234_source_head_invalid')
    require(re.fullmatch(r'ghcr\.io/stanforge-labs/holymedia-mcp-v2@sha256:[0-9a-f]{64}', image) is not None, 'stage234_immutable_image_required')
    require(re.fullmatch(r'[0-9]{8}T[0-9]{6}Z-[a-z0-9]{1,12}', run_id) is not None, 'stage234_run_id_invalid')


def permissions(path):
    require(path.is_file() and not path.is_symlink() and path.stat().st_mode & 0o077 == 0, 'stage234_protected_file_permissions_invalid')


def context_source(basename):
    require(basename == 'fixture-context.json' or re.fullmatch(r'stage234-scoped-context-[0-9]{8}T[0-9]{6}Z\.json', basename) is not None,
            'stage234_protected_context_basename_invalid')
    return ROOT / 'state' / basename


def safe_report(value):
    # Only explicitly safe checkpoint fields leave this supervisor.
    names = {'result', 'preview_id', 'expires_at', 'provider_reads', 'validate_only', 'real_writes', 'evidence', 'failure_stage', 'code'}
    return {key: item for key, item in value.items() if key in names}


def build_harness_manifest(head, directory):
    require(re.fullmatch(r'[0-9a-f]{40}', head) is not None, 'stage234_source_head_invalid')
    names = ['commit-guard.mjs', 'commit-runner.mjs', 'live-guard.mjs', 'live-runner.mjs', 'context-vault.mjs', 'wait-local-ready.mjs']
    hashes = {}
    for name in names:
        file = directory / name
        require(file.is_file() and not file.is_symlink(), 'stage234_harness_file_invalid')
        data = file.read_bytes()
        require(0 < len(data) <= 500000, 'stage234_harness_file_invalid')
        hashes[name] = hashlib.sha256(data).hexdigest()
    return {'head': head, 'files': hashes}


def production_state():
    ids = capture(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=holymedia-v2']).split()
    require(len(ids) == 5, 'stage234_production_service_set_invalid')
    items = json.loads(capture(['docker', 'inspect'] + ids))
    result = {}
    for item in items:
        require(item.get('State', {}).get('Health', {}).get('Status') == 'healthy', 'stage234_production_service_unhealthy')
        service = item['Config']['Labels']['com.docker.compose.service']
        result[service] = [item['Id'], item['Image'], item['State']['StartedAt'], item['RestartCount']]
    require(set(result) == {'api', 'web', 'worker', 'postgres', 'redis'}, 'stage234_production_service_set_invalid')
    return result


def docker_env_values(text):
    values = {}
    for line in text.splitlines():
        if line and not line.startswith('#'):
            require('=' in line, 'stage234_acceptance_env_parse_failed')
            key, value = line.split('=', 1)
            require(re.fullmatch(r'[A-Z0-9_]+', key) is not None and key not in values, 'stage234_acceptance_env_parse_failed')
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            require('\x00' not in value, 'stage234_acceptance_env_parse_failed')
            values[key] = value
    return values


def inspect_ready(head, image):
    env_file = ROOT / 'acceptance.env'
    permissions(env_file)
    permissions(ROOT / 'state/fixture-context.json')
    values = docker_env_values(env_file.read_text())
    require(values.get('PROVIDER_GOOGLE_API_VERSION') == 'v24' and values.get('PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID') == '4378327049', 'stage234_acceptance_google_config_invalid')
    require(values.get('GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST') == '8590146099', 'stage234_exact_test_allowlist_required')
    require(all(values.get(key) == 'false' for key in ['PUBLIC_MCP_WRITE_SCOPE_ENABLED', 'PUBLIC_MCP_CONTROLLED_WRITE_ENABLED']), 'stage234_public_write_must_remain_off')
    network = json.loads(capture(['docker', 'network', 'inspect', NETWORK]))[0]
    require(network.get('Labels', {}).get('com.docker.compose.project') == PROJECT, 'stage234_acceptance_network_identity_invalid')
    require(network.get('Labels', {}).get('org.holymedia.acceptance-purpose') == 'stage234', 'stage234_acceptance_network_purpose_invalid')
    require(network.get('Containers'), 'stage234_acceptance_network_empty')
    for identity in network['Containers']:
        container = json.loads(capture(['docker', 'inspect', identity]))[0]
        labels = container.get('Config', {}).get('Labels') or {}
        require(labels.get('com.docker.compose.project') == PROJECT, 'stage234_foreign_container_on_network')
        require(container.get('State', {}).get('Running') is True, 'stage234_acceptance_dependency_not_running')
        if labels.get('com.docker.compose.service') in {'postgres', 'redis'}:
            require(container.get('State', {}).get('Health', {}).get('Status') == 'healthy', 'stage234_acceptance_database_or_redis_unhealthy')
        for volume in container.get('Mounts', []):
            source = str(volume.get('Source', ''))
            require('/holymedia-v2' not in source and not source.startswith('/etc/holymedia-v2'), 'stage234_production_volume_forbidden')
            if volume.get('Type') == 'volume':
                require(str(volume.get('Name', '')).startswith(PROJECT + '_'), 'stage234_foreign_volume_forbidden')
    descriptor = json.loads(capture(['docker', 'image', 'inspect', image]))[0]
    require(image in descriptor.get('RepoDigests', []), 'stage234_image_digest_not_loaded')
    require((descriptor.get('Config', {}).get('Labels') or {}).get('org.opencontainers.image.revision') == head, 'stage234_image_source_revision_mismatch')
    return hashlib.sha256(env_file.read_bytes()).hexdigest()


def assert_dependency(container, service):
    labels = container.get('Config', {}).get('Labels') or {}
    require(labels.get('com.docker.compose.project') == PROJECT and labels.get('com.docker.compose.service') == service,
            'stage234_dependency_identity_invalid')
    require(container.get('State', {}).get('Running') is True and container.get('State', {}).get('Health', {}).get('Status') == 'healthy',
            'stage234_dependency_unhealthy')
    require(container.get('Name') == '/' + PROJECT + '-' + service + '-1', 'stage234_dependency_name_invalid')
    for volume in container.get('Mounts', []):
        require(volume.get('Type') == 'volume' and str(volume.get('Name', '')).startswith(PROJECT + '_'), 'stage234_dependency_foreign_volume')


def prepare_network():
    # Secondary network only. Never recreates/restarts/migrates an existing DB,
    # Redis, API or gateway; the old acceptance approval project stays untouched.
    before = production_state()
    dependencies = []
    for service in ['postgres', 'redis']:
        container = json.loads(capture(['docker', 'inspect', PROJECT + '-' + service + '-1']))[0]
        assert_dependency(container, service)
        dependencies.append((service, container))
    probe = subprocess.run(['docker', 'network', 'inspect', NETWORK], capture_output=True, text=True, timeout=30)
    if probe.returncode != 0:
        capture(['docker', 'network', 'create', '--label', 'com.docker.compose.project=' + PROJECT,
                 '--label', 'org.holymedia.acceptance-purpose=stage234', NETWORK])
    network = json.loads(capture(['docker', 'network', 'inspect', NETWORK]))[0]
    labels = network.get('Labels') or {}
    require(labels.get('com.docker.compose.project') == PROJECT and labels.get('org.holymedia.acceptance-purpose') == 'stage234',
            'stage234_acceptance_network_identity_invalid')
    expected = {item['Id'] for _, item in dependencies}
    require(set(network.get('Containers') or {}).issubset(expected), 'stage234_foreign_container_on_network')
    for service, container in dependencies:
        if container['Id'] not in (network.get('Containers') or {}):
            capture(['docker', 'network', 'connect', '--alias', service, NETWORK, container['Id']])
    actual = json.loads(capture(['docker', 'network', 'inspect', NETWORK]))[0]
    require(set(actual.get('Containers') or {}) == expected, 'stage234_acceptance_dependencies_incomplete')
    require(production_state() == before, 'stage234_production_state_changed_stop')
    print(json.dumps({'result': 'ISOLATED_STAGE234_NETWORK_READY', 'network': NETWORK, 'dependencies': ['postgres', 'redis'],
                      'existing_services_restarted': False, 'provider_reads': 0, 'validate_only': 0, 'real_writes': 0}))


def command(image, head, run_id, directory, hold=False, env_file=None):
    # No product module mounts, volumes-from, production networks or host network.
    args = ['docker', 'run', '--init', '--rm', '--name', 'hm-stage234-' + run_id, '--network', NETWORK,
            '--label', 'com.docker.compose.project=' + PROJECT, '--memory', '768m', '--cpus', '1',
            '--env-file', str(env_file or ROOT / 'acceptance.env'), '-v', str(directory) + ':/stage234:ro',
            '-v', str(ROOT / 'harness') + ':/acceptance:ro',
            '-v', str(ROOT / 'state' / ('stage234-' + run_id)) + ':/acceptance-state/stage234-' + run_id, '--entrypoint', 'node']
    if hold:
        args += ['-d', '-p', '127.0.0.1:4402:4001']
    variables = {
        'STAGE234_SOURCE_HEAD': head, 'STAGE234_IMAGE_DIGEST': image.split('@')[1],
        'STAGE234_RUN_DIR': '/acceptance-state/stage234-' + run_id,
        'STAGE234_KEEP_API_ALIVE': str(hold).lower(), 'STAGE234_GUARD_PRELOAD': '1',
        'STAGE234_APPROVAL_GATEWAY': str(hold).lower(),
        'PROVIDER_GOOGLE_ADS_WRITE_ENABLED': 'true', 'PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED': 'true',
        'PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED': 'false', 'PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED': 'false',
        'V2_PREVIEW_ONLY': 'true', 'V2_CONFIRMED_WRITE_ENABLED': 'false',
        'PUBLIC_MCP_WRITE_SCOPE_ENABLED': 'false', 'PUBLIC_MCP_CONTROLLED_WRITE_ENABLED': 'false',
        'HOLYMEDIA_PUBLIC_BASE_URL': 'http://localhost:4402', 'CORS_ORIGINS': 'http://localhost:4402',
        'COOKIE_DOMAIN': '',
        'API_PORT': '4000', 'LOG_LEVEL': 'error',
        'NODE_OPTIONS': '--max-old-space-size=192',
    }
    for key, value in variables.items():
        args += ['-e', key + '=' + value]
    return args + [image, '--max-old-space-size=192', '/stage234/live-runner.mjs']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--head', required=True)
    parser.add_argument('--image', required=True)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--check-only', action='store_true')
    parser.add_argument('--hold-api', action='store_true', help='Keep exact API alive; root must prepare stock human approval gateway separately.')
    parser.add_argument('--prepare-network', action='store_true', help='Prepare a secondary isolated acceptance-only DB/Redis network; no provider call.')
    parser.add_argument('--context-basename', default='fixture-context.json', help='Protected acceptance-state basename only; a separately authorized new scoped key must not overwrite historical context.')
    options = parser.parse_args()
    validate_options(options.head, options.image, options.run_id)
    require(hasattr(os, 'geteuid') and os.geteuid() == 0, 'stage234_vps_sudo_required')
    if options.prepare_network:
        prepare_network()
        return
    selected_context = context_source(options.context_basename)
    permissions(selected_context)
    production = production_state()
    env_hash = inspect_ready(options.head, options.image)
    if options.check_only:
        print(json.dumps({'result': 'RUNTIME_PRECHECK_PASS_NO_PROVIDER_CALLS', 'source_head': options.head, 'provider_reads': 0, 'validate_only': 0, 'real_writes': 0}))
        return
    state = ROOT / 'state' / ('stage234-' + options.run_id)
    state.mkdir(mode=0o700)  # collision = STOP, never replay an attempted preview.
    # Exact acceptance image runs as uid/gid 1000 (node). Only this newly-created,
    # validated disposable checkpoint directory is delegated; no recursive chown.
    os.chown(state, 1000, 1000)
    # The runner can write only its new checkpoint. Historical state is not
    # mounted; copy only the minimum existing scoped credential context into a
    # new mode-600 file, without decoding or printing any secret values.
    context_file = state / 'fixture-context.json'
    context_fd = os.open(context_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(context_fd, 'wb') as stream:
        stream.write(selected_context.read_bytes())
    os.chown(context_file, 1000, 1000)
    # Docker --env-file does not parse Compose quotes. Convert only disposable
    # acceptance config into a new protected file; never modify the original.
    runtime_env = state / 'runtime.env'
    fd = os.open(runtime_env, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as stream:
        for key, value in docker_env_values((ROOT / 'acceptance.env').read_text()).items():
            stream.write(key + '=' + value + '\n')
    os.chown(runtime_env, 1000, 1000)
    script_dir = Path(__file__).resolve().parent
    # Record the immutable source identity and the exact mounted guard/runner
    # bytes before preview creation. A future authorized continuation checks
    # this manifest; it must never replace the preview payload or approval.
    harness_manifest = state / 'harness-source.json'
    manifest_fd = os.open(harness_manifest, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(manifest_fd, 'w') as stream:
        json.dump(build_harness_manifest(options.head, script_dir), stream)
    os.chown(harness_manifest, 1000, 1000)
    args = command(options.image, options.head, options.run_id, script_dir, options.hold_api, runtime_env)
    output = capture(args) if options.hold_api else subprocess.run(args, capture_output=True, text=True, timeout=240)
    require(hashlib.sha256((ROOT / 'acceptance.env').read_bytes()).hexdigest() == env_hash, 'stage234_existing_acceptance_env_changed')
    require(production_state() == production, 'stage234_production_state_changed_stop')
    if options.hold_api:
        print(json.dumps({'result': 'SOURCE_PINNED_ONEOFF_STARTED', 'container': 'hm-stage234-' + options.run_id, 'checkpoint_directory': str(state), 'real_writes_permitted': False, 'approval_gateway': 'ROOT_PREPARATION_REQUIRED'}))
        return
    require(output.returncode == 0, 'stage234_preview_runner_failed_read_checkpoint')
    lines = [line for line in output.stdout.splitlines() if line.startswith('{')]
    require(len(lines) == 1, 'stage234_sanitized_report_missing')
    print(json.dumps(safe_report(json.loads(lines[0]))))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'stage234_[a-z0-9_]+', str(error)) else 'stage234_launch_failed_redacted'
        print(json.dumps({'result': 'BLOCKED', 'code': code, 'real_writes': 0}))
        sys.exit(1)
