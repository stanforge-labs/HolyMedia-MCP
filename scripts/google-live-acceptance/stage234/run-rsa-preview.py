"""L preview-only launcher. No key provision, provider write, self approval or N replay."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess

spec = importlib.util.spec_from_file_location("n_preview_helpers", Path(__file__).with_name("run-live.py"))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

def manifest(head, directory):
    names = ["rsa-preview-guard.mjs", "rsa-preview-runner.mjs", "rsa-approval-gateway.mjs", "scenario-preparation.mjs", "live-guard.mjs", "live-runner.mjs", "context-vault.mjs", "approval-gateway.mjs", "startup-diagnostics.mjs"]
    result = {}
    for name in names:
        path = directory / name
        base.require(path.is_file() and not path.is_symlink() and 0 < path.stat().st_size <= 500000, "stage234_l_manifest_file_invalid")
        result[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return {"head":head, "purpose":"L_PREVIEW_ONLY", "files":result}

def command(image, head, run_id, directory, state):
    name = "stage234-l-" + run_id
    args = ["docker","run","--init","--rm","-d","--name","hm-" + name,"--network",base.NETWORK,
        "--label","com.docker.compose.project=" + base.PROJECT,"--label","org.holymedia.acceptance-purpose=L-preview",
        "--memory","768m","--cpus","1","--env-file",str(state / "runtime.env"),
        "-p","127.0.0.1:4403:4001","-v",str(directory)+":/stage234:ro",
        "-v",str(base.ROOT / "harness")+":/acceptance:ro","-v",str(state)+":/acceptance-state/"+name,"--entrypoint","node"]
    env = {
        "STAGE234_SOURCE_HEAD":head,"STAGE234_IMAGE_DIGEST":image.split("@")[1],
        "STAGE234_RUN_DIR":"/acceptance-state/"+name,"STAGE234_KEEP_API_ALIVE":"true",
        "STAGE234_GUARD_PRELOAD":"0","STAGE234_L_GUARD_PRELOAD":"1","STAGE234_COMMIT_GUARD_PRELOAD":"0",
        "STAGE234_APPROVAL_GATEWAY":"true","PROVIDER_GOOGLE_ADS_WRITE_ENABLED":"true",
        "PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED":"false","PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED":"false",
        "PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED":"true","V2_PREVIEW_ONLY":"true","V2_CONFIRMED_WRITE_ENABLED":"false",
        "PUBLIC_MCP_WRITE_SCOPE_ENABLED":"false","PUBLIC_MCP_CONTROLLED_WRITE_ENABLED":"false",
        "HOLYMEDIA_PUBLIC_BASE_URL":"http://localhost:4403","CORS_ORIGINS":"http://localhost:4403",
        "COOKIE_DOMAIN":"","API_PORT":"4000","LOG_LEVEL":"error","NODE_OPTIONS":"--max-old-space-size=192"
    }
    for key,value in env.items():
        args += ["-e",key+"="+value]
    return args + [image,"--max-old-space-size=192","/stage234/rsa-preview-runner.mjs"]

def execute(options):
    base.validate_options(options.head, options.image, options.run_id)
    base.require(hasattr(os,"geteuid") and os.geteuid()==0,"stage234_l_sudo_required")
    source = base.context_source(options.context_basename)
    base.permissions(source)
    production = base.production_state()
    env_hash = base.inspect_ready(options.head,options.image)
    directory = Path(__file__).resolve().parent
    frozen = manifest(options.head,directory)
    if options.check_only:
        print(json.dumps({"result":"L_RUNTIME_PRECHECK_PASS_NO_PROVIDER_CALLS","real_writes":0,"source_head":options.head}))
        return
    # No touching an existing API/gateway. Collision STOP; all L state is new.
    state = base.ROOT / "state" / ("stage234-l-"+options.run_id)
    state.mkdir(mode=0o700)
    os.chown(state,1000,1000)
    files = {"fixture-context.json":source.read_bytes(), "l-harness-source.json":json.dumps(frozen).encode(),
      "runtime.env":("\n".join(key+"="+value for key,value in base.docker_env_values((base.ROOT/"acceptance.env").read_text()).items())+"\n").encode()}
    for name,data in files.items():
        fd=os.open(state/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,"wb") as stream: stream.write(data)
        os.chown(state/name,1000,1000)
    try:
        base.capture(command(options.image,options.head,options.run_id,directory,state))
    finally:
        base.require(base.production_state()==production,"stage234_l_production_state_changed")
        base.require(hashlib.sha256((base.ROOT/"acceptance.env").read_bytes()).hexdigest()==env_hash,"stage234_l_existing_env_changed")
        base.require(manifest(options.head,directory)==frozen,"stage234_l_harness_changed")
    print(json.dumps({"result":"L_SOURCE_PINNED_PREVIEW_ONLY_STARTED","checkpoint_directory":str(state),"container":"hm-stage234-l-"+options.run_id,"approval_origin":"http://localhost:4403","real_writes_permitted":False}))

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ["head","image","run-id"]: parser.add_argument("--"+name,required=True)
    parser.add_argument("--context-basename",required=True)
    parser.add_argument("--check-only",action="store_true")
    try: execute(parser.parse_args())
    except Exception as error:
        code=str(error) if isinstance(error,RuntimeError) and re.fullmatch(r"stage234_[a-z0-9_]+",str(error)) else "stage234_l_supervisor_failure_redacted"
        print(json.dumps({"result":"BLOCKED","code":code,"real_writes":0}))
        raise SystemExit(1)

