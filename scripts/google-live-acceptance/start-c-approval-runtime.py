"""Start a temporary, externally-write-blocked approval process; leave existing services alone."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

ROOT=Path('/opt/holymedia-google-acceptance')
UPLOAD=Path('/home/ubuntu/holymedia-google-acceptance-harness')
NAME='holymedia-google-c-human-approval'

def run(args):
    result=subprocess.run(args,capture_output=True,text=True)
    if result.returncode: raise RuntimeError('approval_runtime_command_failed:'+args[0])
    return result.stdout

def verify():
    run(['python3',str(UPLOAD/'provision.py'),'verify'])

try:
    if os.geteuid()!=0 or len(sys.argv)!=2 or not re.fullmatch(r'[0-9a-f]{64}',sys.argv[1]):
        raise RuntimeError('approval_runtime_arguments_invalid')
    verify()
    module=ROOT/'harness/mcp-preview-mixed-fixed.js'
    if hashlib.sha256(module.read_bytes()).hexdigest()!=sys.argv[1]:
        raise RuntimeError('approval_runtime_product_hash_mismatch')
    if run(['docker','ps','-aq','--filter','name=^/'+NAME+'$']).strip():
        raise RuntimeError('approval_runtime_already_exists_stop')
    if any(':4401 ' in line for line in run(['ss','-ltn']).splitlines()):
        raise RuntimeError('approval_runtime_port_in_use')
    mem=dict(line.split(':',1) for line in Path('/proc/meminfo').read_text().splitlines())
    if int(mem['MemAvailable'].split()[0])*1024<640*1024*1024:
        raise RuntimeError('approval_runtime_insufficient_memory')
    for name in ['approval-gateway.mjs','approval-runtime-guard.mjs','approval-runtime.compose.yml']:
        target=ROOT/'harness'/name
        if target.exists() and target.read_bytes()!=(UPLOAD/name).read_bytes():
            raise RuntimeError('approval_runtime_file_collision')
        shutil.copyfile(UPLOAD/name,target)
        os.chown(target,0,0)
        os.chmod(target,0o644)
    compose=['docker','compose','-p','holymedia-google-acceptance-approval','--env-file',str(ROOT/'acceptance.env'),'-f',str(ROOT/'harness/approval-runtime.compose.yml')]
    run(compose+['config','--quiet'])
    run(compose+['run','-d','--rm','--no-deps','--name',NAME,'--publish','127.0.0.1:4401:4001','approval_api'])
    for _ in range(40):
        item=json.loads(run(['docker','inspect',NAME]))[0]
        if item['State'].get('Health',{}).get('Status')=='healthy': break
        if not item['State']['Running']: raise RuntimeError('approval_runtime_not_running_stop')
        time.sleep(1)
    else: raise RuntimeError('approval_runtime_not_healthy_stop')
    if item['NetworkSettings']['Ports'].get('4001/tcp')!=[{'HostIp':'127.0.0.1','HostPort':'4401'}]:
        raise RuntimeError('approval_runtime_port_mismatch')
    if set(item['NetworkSettings']['Networks'])!={'holymedia-google-acceptance_default'}:
        raise RuntimeError('approval_runtime_network_mismatch')
    env=dict(line.split('=',1) for line in item['Config']['Env'])
    if env['V2_PREVIEW_ONLY']!='true' or env['V2_CONFIRMED_WRITE_ENABLED']!='false':
        raise RuntimeError('approval_runtime_write_flags_unsafe')
    check=run(['docker','exec',NAME,'node','-e',
      "const f=require('node:fs');const c=require('node:crypto');console.log(c.createHash('sha256').update(f.readFileSync('/workspace/apps/api/dist/mcp/mcp-preview.service.js')).digest('hex'))"])
    if check.strip()!=sys.argv[1]: raise RuntimeError('approval_runtime_loaded_module_mismatch')
    verify()
    print(json.dumps({'approval_runtime':'HEALTHY','loopback_port':4401,'external_transport':'BLOCKED','compiled_product_sha256':sys.argv[1],'existing_acceptance_api_changed':False,'production_changed':False}))
except Exception as error:
    print(str(error) if isinstance(error,RuntimeError) else 'approval_runtime_failed')
    raise SystemExit(1)
