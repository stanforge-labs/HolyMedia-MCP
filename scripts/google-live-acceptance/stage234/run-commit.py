"""Explicit exact-preview N supervisor. No execution on import; check-only is read-only.

This deliberately has no approval command, gateway lifecycle, provider client or
retry. Only the separately reviewed stock commit-runner can issue the one write.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit

spec = importlib.util.spec_from_file_location('stage234_preview_supervisor', Path(__file__).with_name('run-live.py'))
preview_supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview_supervisor)
ROOT = preview_supervisor.ROOT
PROJECT = preview_supervisor.PROJECT
NETWORK = preview_supervisor.NETWORK
require = preview_supervisor.require
FILES = {'commit-guard.mjs', 'commit-runner.mjs', 'live-guard.mjs', 'live-runner.mjs', 'context-vault.mjs', 'wait-local-ready.mjs'}
CLAIMS = {'n-supervisor-launch.claim', 'n-mcp_commit.claim', 'n-write.claim', 'n-mcp_rollback_preview.claim', 'n-validate_only.claim', 'n-authority.json', 'n-proof.json', 'n-commit-evidence.json', 'n-blocked-evidence.json', 'commit.runtime.env'}


def validate_options(options):
    preview_supervisor.validate_options(options.head, options.image, options.run_id)
    require(re.fullmatch(r'[0-9a-f]{40}', options.harness_head or '') is not None, 'stage234_commit_harness_head_invalid')
    require(re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', options.authorize_exact_preview or '') is not None,
            'stage234_commit_explicit_exact_preview_authorization_required')


def assert_authorization(options, context, evidence, now=None):
    validate_options(options)
    encrypted = context.get('purpose') == 'STAGE234_ACCEPTANCE_CONTEXT'
    if encrypted:
        # Public hints cannot authorize a write. Node decrypts with the stock
        # vault and binds tokens, exact plan, DB approval and snapshot digest.
        require(set(context) == {'version','purpose','ciphertext','encryptionVersion','public'} and context.get('version') == 1
                and isinstance(context.get('ciphertext'), str) and context['ciphertext'].startswith('hm1.')
                and isinstance(context.get('encryptionVersion'), int), 'stage234_commit_encrypted_envelope_invalid')
        p = (context.get('public') or {}).get('preview') or {}
    else:
        p = context.get('preview') or {}
    require(p.get('preview_id') == options.authorize_exact_preview == evidence.get('preview_id'), 'stage234_commit_authorized_preview_mismatch')
    require(p.get('provider') == 'GOOGLE_ADS' and p.get('account_id') == '8590146099' and p.get('provider_validation') == 'passed'
            and p.get('operation_count') == 1, 'stage234_commit_protected_preview_invalid')
    if not encrypted:
        require(isinstance(p.get('preview_token'), str) and bool(p['preview_token']) and isinstance(context.get('service_token'), str)
                and bool(context['service_token']), 'stage234_commit_protected_preview_invalid')
    require(evidence.get('source_head') == options.head and evidence.get('image_digest') == options.image.split('@')[1]
            and evidence.get('persisted_preview_immutable') is True and evidence.get('before_after_unchanged') is True
            and evidence.get('committed') is False and evidence.get('real_provider_write_call_count') == 0
            and evidence.get('provider_validation') == 'passed', 'stage234_commit_preview_source_or_evidence_invalid')
    try:
        require(isinstance(p.get('expires_at'), str), 'stage234_commit_preview_expiry_invalid')
        expiry = datetime.fromisoformat(p['expires_at'].replace('Z', '+00:00'))
        require(expiry.tzinfo is not None and expiry > (now or datetime.now(timezone.utc)), 'stage234_commit_preview_expired')
    except (KeyError, TypeError, ValueError):
        raise RuntimeError('stage234_commit_preview_expiry_invalid') from None
    if encrypted:
        require(evidence.get('semantic_payload') == {'provider':'GOOGLE_ADS','account_id':'8590146099','items':[{'campaign_id':'24324170853','ad_group_id':'206587491811','field':'ad_group_cpc','change':{'mode':'absolute','amount':'0.11','currency':'USD'}}]}, 'stage234_commit_preview_semantic_payload_invalid')
        before = (evidence.get('provider_state_before') or {}).get('group', [{}])[0].get('adGroup') or {}
        after = evidence.get('expected_after') or {}
        items = [{'campaign_id':'24324170853','ad_group_id':'206587491811','before':before,'after':after}]
    else:
        items = p.get('items') or []
    require(len(items) == 1 and items[0].get('campaign_id') == '24324170853' and items[0].get('ad_group_id') == '206587491811', 'stage234_commit_preview_target_invalid')
    before, after = items[0].get('before') or {}, items[0].get('after') or {}
    require(before.get('resourceName') == 'customers/8590146099/adGroups/206587491811'
            and str(before.get('cpcBidMicros')) == '100000' and before.get('status') == 'PAUSED'
            and after == dict(before, cpcBidMicros='110000'), 'stage234_commit_preview_semantics_invalid')


def protected(path, directory=False):
    require(not path.is_symlink(), 'stage234_commit_protected_symlink_invalid')
    info = path.stat()
    require((path.is_dir() if directory else path.is_file()) and info.st_mode & 0o077 == 0 and info.st_uid == 1000,
            'stage234_commit_protected_permissions_or_owner_invalid')


def verify_manifest(manifest, head, directory):
    require(set(manifest) == {'head', 'files'} and manifest['head'] == head and isinstance(manifest['files'], dict)
            and set(manifest['files']) == FILES, 'stage234_commit_harness_manifest_invalid')
    for name, expected in manifest['files'].items():
        path = directory / name
        require(path.is_file() and not path.is_symlink() and re.fullmatch(r'[0-9a-f]{64}', expected or '') is not None
                and hashlib.sha256(path.read_bytes()).hexdigest() == expected, 'stage234_commit_harness_bytes_mismatch')


def inspect_state(options, directory):
    state = ROOT / 'state' / ('stage234-' + options.run_id)
    protected(state, True)
    for name in ['protected-preview-context.json', 'evidence.json', 'runtime.env', 'harness-source.json']:
        protected(state / name)
    require(not any((state / name).exists() or (state / name).is_symlink() for name in CLAIMS), 'stage234_commit_previously_attempted_no_retry')
    context = json.loads((state / 'protected-preview-context.json').read_text())
    evidence = json.loads((state / 'evidence.json').read_text())
    assert_authorization(options, context, evidence)
    verify_manifest(json.loads((state / 'harness-source.json').read_text()), options.harness_head, directory)
    values = preview_supervisor.docker_env_values((state / 'runtime.env').read_text())
    require(urlsplit(values.get('DATABASE_URL', '')).hostname == 'postgres' and urlsplit(values.get('DATABASE_URL', '')).path == '/google_acceptance'
            and urlsplit(values.get('REDIS_URL', '')).hostname == 'redis', 'stage234_commit_disposable_database_required')
    require(values.get('PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID') == '4378327049' and values.get('PROVIDER_GOOGLE_API_VERSION') == 'v24'
            and values.get('GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST') == '8590146099'
            and all(values.get(k) == 'false' for k in ['PUBLIC_MCP_WRITE_SCOPE_ENABLED', 'PUBLIC_MCP_CONTROLLED_WRITE_ENABLED']), 'stage234_commit_acceptance_env_invalid')
    return state, values, hashlib.sha256((state / 'runtime.env').read_bytes()).hexdigest()


def gateway_state(run_id):
    container = json.loads(preview_supervisor.capture(['docker', 'inspect', 'hm-stage234-' + run_id]))[0]
    labels = container.get('Config', {}).get('Labels') or {}
    ports = container.get('NetworkSettings', {}).get('Ports', {}).get('4001/tcp') or []
    require(labels.get('com.docker.compose.project') == PROJECT and container.get('State', {}).get('Running') is True
            and ports == [{'HostIp': '127.0.0.1', 'HostPort': '4402'}], 'stage234_commit_existing_approval_gateway_unavailable')
    return [container['Id'], container['Image'], container['State']['StartedAt'], container['RestartCount']]


def command(options, directory, state):
    # No public port, product bind, production mount, gateway, or container reuse.
    args = ['docker', 'run', '--init', '--rm', '--name', 'hm-stage234-n-commit-' + options.run_id,
            '--network', NETWORK, '--label', 'com.docker.compose.project=' + PROJECT,
            '--label', 'org.holymedia.acceptance-purpose=n-exact-commit', '--memory', '768m', '--cpus', '1',
            '--env-file', str(state / 'commit.runtime.env'), '-v', str(directory) + ':/stage234:ro',
            '-v', str(state) + ':/acceptance-state/stage234-' + options.run_id, '--entrypoint', 'node']
    variables = {
        'STAGE234_SOURCE_HEAD': options.head, 'STAGE234_HARNESS_HEAD': options.harness_head,
        'STAGE234_IMAGE_DIGEST': options.image.split('@')[1], 'STAGE234_RUN_DIR': '/acceptance-state/stage234-' + options.run_id,
        'STAGE234_EXPLICIT_COMMIT_AUTHORIZED': 'true', 'STAGE234_GUARD_PRELOAD': '0',
        'STAGE234_COMMIT_GUARD_PRELOAD': '0', 'STAGE234_APPROVAL_GATEWAY': 'false', 'STAGE234_KEEP_API_ALIVE': 'false',
        'PROVIDER_GOOGLE_ADS_WRITE_ENABLED': 'true', 'PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED': 'true',
        'PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED': 'false', 'PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED': 'false',
        'GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST': '8590146099', 'PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID': '4378327049',
        'PROVIDER_GOOGLE_API_VERSION': 'v24', 'V2_PREVIEW_ONLY': 'false', 'V2_CONFIRMED_WRITE_ENABLED': 'true',
        'PUBLIC_MCP_WRITE_SCOPE_ENABLED': 'false', 'PUBLIC_MCP_CONTROLLED_WRITE_ENABLED': 'false',
        'HOLYMEDIA_PUBLIC_BASE_URL': 'http://localhost:4402', 'CORS_ORIGINS': 'http://localhost:4402', 'COOKIE_DOMAIN': '',
        'API_PORT': '4000', 'LOG_LEVEL': 'error', 'NODE_OPTIONS': '--max-old-space-size=192',
    }
    for key, value in variables.items():
        args += ['-e', key + '=' + value]
    return args + [options.image, '--max-old-space-size=192', '/stage234/commit-runner.mjs']


def safe_report(value):
    keys = {'result', 'code', 'failure_stage', 'preview_id', 'commit_id', 'expires_at', 'provider_reads', 'validate_only', 'real_writes'}
    return {k: v for k, v in value.items() if k in keys}


def execute(options):
    validate_options(options)  # authorization required even before check-only Docker reads.
    require(hasattr(os, 'geteuid') and os.geteuid() == 0, 'stage234_commit_vps_sudo_required')
    directory = Path(__file__).resolve().parent
    production = preview_supervisor.production_state()
    approval = gateway_state(options.run_id)
    acceptance_hash = preview_supervisor.inspect_ready(options.head, options.image)
    state, values, runtime_hash = inspect_state(options, directory)
    if options.check_only:
        require(preview_supervisor.production_state() == production and gateway_state(options.run_id) == approval, 'stage234_commit_service_state_changed')
        print(json.dumps({'result': 'N_COMMIT_CHECK_ONLY_PASS', 'provider_reads': 0, 'validate_only': 0, 'real_writes': 0}))
        return
    # Exclusive claims are retained on failure: neither the supervisor nor runner retries.
    fd = os.open(state / 'n-supervisor-launch.claim', os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump({'preview_id': options.authorize_exact_preview, 'source_head': options.head, 'harness_head': options.harness_head}, stream)
    os.chown(state / 'n-supervisor-launch.claim', 1000, 1000)
    fd = os.open(state / 'commit.runtime.env', os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as stream:
        for key, value in values.items():
            stream.write(key + '=' + value + '\n')
    os.chown(state / 'commit.runtime.env', 1000, 1000)
    result = None
    try:
        output = subprocess.run(command(options, directory, state), capture_output=True, text=True, timeout=300)
        lines = [line for line in output.stdout.splitlines() if line.startswith('{')]
        require(len(lines) == 1, 'stage234_commit_sanitized_runner_report_missing')
        result = safe_report(json.loads(lines[0]))
    finally:
        # No restart/stop: verify identity, health and fingerprints of untouched services.
        require(preview_supervisor.production_state() == production and gateway_state(options.run_id) == approval, 'stage234_commit_service_state_changed')
        require(hashlib.sha256((ROOT / 'acceptance.env').read_bytes()).hexdigest() == acceptance_hash
                and hashlib.sha256((state / 'runtime.env').read_bytes()).hexdigest() == runtime_hash, 'stage234_commit_existing_env_changed')
    if result is not None:
        print(json.dumps(result))
    if output.returncode != 0:
        # The stock runner already emitted safe exact call counts; one report only.
        raise SystemExit(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--head', required=True)
    parser.add_argument('--harness-head', required=True)
    parser.add_argument('--image', required=True)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--authorize-exact-preview', help='Explicit permission for exactly this protected preview UUID; required even for check-only.')
    parser.add_argument('--check-only', action='store_true')
    execute(parser.parse_args())


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'stage234_[a-z0-9_]+', str(error)) else 'stage234_commit_supervisor_failure_redacted'
        print(json.dumps({'result': 'BLOCKED', 'code': code, 'real_writes': None,
                          'next_action': 'Inspect protected N evidence and claims; never retry an ambiguous commit.'}))
        sys.exit(1)
