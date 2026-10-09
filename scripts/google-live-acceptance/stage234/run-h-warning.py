"""Isolated H stock build/validate diagnostic. No server, approval or real write."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess

spec=importlib.util.spec_from_file_location('h_helpers',Path(__file__).with_name('run-readiness.py'))
helpers=importlib.util.module_from_spec(spec);spec.loader.exec_module(helpers)
base=helpers.base

def command(opts,directory,state):
    args=helpers.command(opts,directory,state)
    args[-1]='/stage234/h-warning-only.mjs'
    for before,after in [('PROVIDER_GOOGLE_ADS_WRITE_ENABLED=false','PROVIDER_GOOGLE_ADS_WRITE_ENABLED=true'),('PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED=false','PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED=true')]:
        args[args.index(before)]=after
    args[args.index('hm-stage234-readiness-'+opts.run_id)]='hm-stage234-h-'+opts.run_id
    args[-2:-2]=['-e','STAGE234_H_WARNING_ONLY_AUTHORIZED=true','-e','STAGE234_GUARD_PRELOAD=0']
    return args

def manifest(directory):
    return {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(directory.glob('*.mjs')) if p.is_file() and not p.is_symlink()}

def execute(opts):
    base.validate_options(opts.head,opts.image,opts.run_id)
    base.require(re.fullmatch(r'[a-f0-9]{40}',opts.harness_head or '') is not None,'stage234_h_harness_invalid')
    base.require(hasattr(os,'geteuid') and os.geteuid()==0,'stage234_h_sudo_required')
    selected=base.context_source(opts.context_basename);base.permissions(selected)
    before=base.production_state();env_hash=base.inspect_ready(opts.head,opts.image)
    directory=Path(__file__).resolve().parent;frozen=manifest(directory)
    base.require('h-warning-only.mjs' in frozen and 'targeting-discovery.mjs' in frozen,'stage234_h_files_missing')
    if opts.check_only:
        print(json.dumps({'result':'H_PRECHECK_PASS','provider_reads':0,'validate_only':0,'real_writes':0}));return
    state=base.ROOT/'state'/('stage234-h-'+opts.run_id)
    state.mkdir(mode=0o700);os.chown(state,1000,1000)
    files={'fixture-context.json':selected.read_bytes(),'h-source.json':json.dumps({'runtime_head':opts.head,'harness_head':opts.harness_head,'files':frozen}).encode(),'runtime.env':''.join(k+'='+v+'\n' for k,v in base.docker_env_values((base.ROOT/'acceptance.env').read_text()).items()).encode()}
    for name,data in files.items():
        fd=os.open(state/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'wb') as f:f.write(data)
        os.chown(state/name,1000,1000)
    output=None
    try:output=subprocess.run(command(opts,directory,state),capture_output=True,text=True,timeout=240)
    finally:
        base.require(base.production_state()==before,'stage234_h_production_changed')
        base.require(hashlib.sha256((base.ROOT/'acceptance.env').read_bytes()).hexdigest()==env_hash,'stage234_h_env_changed')
        base.require(manifest(directory)==frozen,'stage234_h_source_changed')
    lines=[s for s in output.stdout.splitlines() if s.startswith('{')]
    base.require(len(lines)==1,'stage234_h_report_missing')
    report=json.loads(lines[0]);allowed={'result','code','failure_stage','validate_only','evidence'}
    projected={k:v for k,v in report.items() if k in allowed}
    projected.update(provider_reads=report.get('read'),real_writes=report.get('write'))
    print(json.dumps(projected))
    if output.returncode:raise SystemExit(1)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for k in ['head','harness-head','image','run-id','context-basename']:p.add_argument('--'+k,required=True)
    p.add_argument('--check-only',action='store_true')
    try:execute(p.parse_args())
    except Exception as e:
        code=str(e) if isinstance(e,RuntimeError) and re.fullmatch(r'stage234_[a-z0-9_]+',str(e)) else 'stage234_h_supervisor_redacted'
        print(json.dumps({'result':'BLOCKED','code':code,'real_writes':0}));raise SystemExit(1)
