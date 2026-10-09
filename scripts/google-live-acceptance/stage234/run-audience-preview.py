"""I preview-only launcher. No key provision, provider write, self approval or N replay."""
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
    names = ["run-audience-preview.py", "audience-preview-guard.mjs", "audience-preview-runner.mjs", "rsa-approval-gateway.mjs", "live-guard.mjs", "context-vault.mjs", "targeting-readiness-runner.mjs", "targeting-discovery.mjs", "scenario-targeting-readiness.mjs", "read-only-guard.mjs", "startup-diagnostics.mjs", "verified-l-residual.mjs"]
    result = {}
    for name in names:
        path = directory / name
        base.require(path.is_file() and not path.is_symlink() and 0 < path.stat().st_size <= 500000, "stage234_l_manifest_file_invalid")
        result[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return {"head":head, "api_head":"55d9df3553ff1ad01586978b6e4ecc07913969c5", "purpose":"I_PREVIEW_ONLY", "files":result}

def command(image, head, run_id, directory, state, readiness_hash, readiness_harness, candidate_key, candidate_id, harness_head):
    name = "stage234-i-" + run_id
    args = ["docker","run","--init","--rm","-d","--name","hm-" + name,"--network",base.NETWORK,
        "--label","com.docker.compose.project=" + base.PROJECT,"--label","org.holymedia.acceptance-purpose=I-preview",
        "--memory","768m","--cpus","1","--env-file",str(state / "runtime.env"),
        "-p","127.0.0.1:4403:4001","-v",str(directory)+":/stage234:ro",
        "-v",str(base.ROOT / "harness")+":/acceptance:ro","-v",str(state)+":/acceptance-state/"+name,"--entrypoint","node"]
    env = {
        "STAGE234_SOURCE_HEAD":head,"STAGE234_HARNESS_HEAD":harness_head,"STAGE234_IMAGE_DIGEST":image.split("@")[1],
        "STAGE234_I_READINESS_SHA256":readiness_hash,"STAGE234_I_READINESS_HARNESS_HEAD":readiness_harness,"STAGE234_I_CANDIDATE_KEY":candidate_key,"STAGE234_I_CANDIDATE_ID":candidate_id,
        "STAGE234_RUN_DIR":"/acceptance-state/"+name,"STAGE234_KEEP_API_ALIVE":"true",
        "STAGE234_GUARD_PRELOAD":"0","STAGE234_L_GUARD_PRELOAD":"0","STAGE234_I_GUARD_PRELOAD":"1","STAGE234_COMMIT_GUARD_PRELOAD":"0","STAGE234_L_COMMIT_GUARD_PRELOAD":"0",
        "STAGE234_APPROVAL_GATEWAY":"true","PROVIDER_GOOGLE_ADS_WRITE_ENABLED":"true",
        "PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED":"false","PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED":"true",
        "PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED":"false","V2_PREVIEW_ONLY":"true","V2_CONFIRMED_WRITE_ENABLED":"false",
        "PUBLIC_MCP_WRITE_SCOPE_ENABLED":"false","PUBLIC_MCP_CONTROLLED_WRITE_ENABLED":"false",
        "HOLYMEDIA_PUBLIC_BASE_URL":"http://localhost:4403","CORS_ORIGINS":"http://localhost:4403",
        "COOKIE_DOMAIN":"","API_PORT":"4000","LOG_LEVEL":"error","NODE_OPTIONS":"--max-old-space-size=192"
    }
    for key,value in env.items():
        args += ["-e",key+"="+value]
    return args + [image,"--max-old-space-size=192","/stage234/audience-preview-runner.mjs"]

def execute(options):
    base.validate_options(options.head, options.image, options.run_id)
    base.require(hasattr(os,"geteuid") and os.geteuid()==0,"stage234_l_sudo_required")
    base.require(options.head=="55d9df3553ff1ad01586978b6e4ecc07913969c5" and options.image=="ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:2d7cd20cb25c268f74abd16f324d7b92ce5d804989a8de9b3fa062a0ca138d35","stage234_i_source_mismatch")
    base.require(re.fullmatch(r"stage234-[A-Za-z0-9_-]+/targeting-readiness-evidence\.json",options.readiness_relative or "") and re.fullmatch(r"[a-f0-9]{64}",options.readiness_sha256 or "") and re.fullmatch(r"[a-f0-9]{40}",options.readiness_harness_head or "") and options.candidate_key in ["IN_MARKET","AFFINITY","GLOBAL_IN_MARKET","GLOBAL_AFFINITY"],"stage234_i_readiness_reference_invalid")
    readiness=base.ROOT/"state"/options.readiness_relative
    base.permissions(readiness)
    base.require(not readiness.parent.is_symlink() and readiness.stat().st_size<=2*1024*1024 and hashlib.sha256(readiness.read_bytes()).hexdigest()==options.readiness_sha256,"stage234_i_readiness_hash_mismatch")
    source = base.context_source(options.context_basename)
    base.permissions(source)
    production = base.production_state()
    env_hash = base.inspect_ready(options.head,options.image)
    directory = Path(__file__).resolve().parent
    base.require(re.fullmatch(r"[a-f0-9]{40}",options.harness_head or ""),"stage234_i_harness_pin_invalid")
    frozen = manifest(options.harness_head,directory)
    if options.check_only:
        print(json.dumps({"result":"I_RUNTIME_PRECHECK_PASS_NO_PROVIDER_CALLS","real_writes":0,"source_head":options.head}))
        return
    # No touching an existing API/gateway. Collision STOP; all L state is new.
    state = base.ROOT / "state" / ("stage234-i-"+options.run_id)
    state.mkdir(mode=0o700)
    os.chown(state,1000,1000)
    files = {"fixture-context.json":source.read_bytes(), "i-harness-source.json":json.dumps(frozen).encode(),
      "readiness-evidence.json":readiness.read_bytes(), "runtime.env":("\n".join(key+"="+value for key,value in base.docker_env_values((base.ROOT/"acceptance.env").read_text()).items())+"\n").encode()}
    for name,data in files.items():
        fd=os.open(state/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,"wb") as stream: stream.write(data)
        os.chown(state/name,1000,1000)
    try:
        base.capture(command(options.image,options.head,options.run_id,directory,state,options.readiness_sha256,options.readiness_harness_head,options.candidate_key,options.candidate_id,options.harness_head))
    finally:
        base.require(base.production_state()==production,"stage234_l_production_state_changed")
        base.require(hashlib.sha256((base.ROOT/"acceptance.env").read_bytes()).hexdigest()==env_hash,"stage234_l_existing_env_changed")
        base.require(manifest(options.harness_head,directory)==frozen,"stage234_l_harness_changed")
    print(json.dumps({"result":"I_SOURCE_PINNED_PREVIEW_ONLY_STARTED","checkpoint_directory":str(state),"container":"hm-stage234-i-"+options.run_id,"approval_origin":"http://localhost:4403","real_writes_permitted":False}))

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ["head","harness-head","image","run-id"]: parser.add_argument("--"+name,required=True)
    parser.add_argument("--context-basename",required=True)
    parser.add_argument("--check-only",action="store_true")
    for name in ["readiness-relative","readiness-sha256","readiness-harness-head","candidate-key","candidate-id"]:parser.add_argument("--"+name,required=True)
    try: execute(parser.parse_args())
    except Exception as error:
        code=str(error) if isinstance(error,RuntimeError) and re.fullmatch(r"stage234_[a-z0-9_]+",str(error)) else "stage234_l_supervisor_failure_redacted"
        print(json.dumps({"result":"BLOCKED","code":code,"real_writes":0}))
        raise SystemExit(1)



