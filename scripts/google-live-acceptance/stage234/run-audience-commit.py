"""Exactly one future authorized I commit. Separate new state; original preview untouched."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
spec=importlib.util.spec_from_file_location("i_preview",Path(__file__).with_name("run-audience-preview.py"))
preview=importlib.util.module_from_spec(spec);spec.loader.exec_module(preview)
base=preview.base
SOURCE="55d9df3553ff1ad01586978b6e4ecc07913969c5"
IMAGE="ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:2d7cd20cb25c268f74abd16f324d7b92ce5d804989a8de9b3fa062a0ca138d35"
def parent_name(opts):
    base.validate_options(opts.head,opts.image,opts.preview_run_id)
    return "stage234-i-"+opts.preview_run_id

def protected(path,directory=False):
    base.require(not path.is_symlink(),"stage234_i_commit_symlink_invalid")
    stat=path.stat()
    base.require((path.is_dir() if directory else path.is_file()) and stat.st_mode&0o077==0 and stat.st_uid==1000,"stage234_i_commit_permissions_invalid")
    if not directory:base.require(stat.st_size<=1024*1024,"stage234_i_commit_file_size_invalid")

def validate_options(opts):
    base.validate_options(opts.head,opts.image,opts.run_id)
    base.require(opts.head==SOURCE and opts.image==IMAGE and re.fullmatch(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}",opts.authorize_exact_preview or "") and re.fullmatch(r"[a-f0-9]{40}",opts.harness_head or ""),"stage234_i_commit_exact_authority_invalid")

def gateway_state(opts):
    PARENT=parent_name(opts)
    obj=json.loads(base.capture(["docker","inspect","hm-"+PARENT]))[0]
    labels=obj.get("Config",{}).get("Labels") or {}
    ports=obj.get("NetworkSettings",{}).get("Ports",{}).get("4001/tcp") or []
    base.require(labels.get("com.docker.compose.project")==base.PROJECT and labels.get("org.holymedia.acceptance-purpose")=="I-preview" and obj.get("State",{}).get("Running") is True and ports==[{"HostIp":"127.0.0.1","HostPort":"4403"}],"stage234_i_commit_original_gateway_invalid")
    return [obj["Id"],obj["Image"],obj["State"]["StartedAt"],obj["RestartCount"]]

def assert_origin(envelope,evidence,manifest,directory,opts,now=None):
    base.require(set(envelope)=={"version","purpose","ciphertext","encryptionVersion","public"} and envelope.get("purpose")=="STAGE234_ACCEPTANCE_CONTEXT" and envelope.get("version")==1 and isinstance(envelope.get("ciphertext"),str) and envelope["ciphertext"].startswith("hm1."),"stage234_i_commit_encrypted_context_invalid")
    p=(envelope.get("public") or {}).get("preview") or {}
    base.require(p.get("preview_id")==opts.authorize_exact_preview==evidence.get("preview_id") and p.get("provider")=="GOOGLE_ADS" and p.get("account_id")=="8590146099" and p.get("operation_count")==2 and p.get("provider_validation")=="passed","stage234_i_commit_parent_preview_invalid")
    expiry=datetime.fromisoformat(p["expires_at"].replace("Z","+00:00"))
    base.require(expiry.tzinfo is not None and expiry>(now or datetime.now(timezone.utc)),"stage234_i_commit_expired")
    base.require(evidence.get("acceptance_test")=="I_PREVIEW_ONLY" and evidence.get("source_head")==SOURCE and evidence.get("image_digest")==IMAGE.split("@")[1] and evidence.get("persisted_preview_immutable") is True and evidence.get("before_after_unchanged") is True and evidence.get("committed") is False and evidence.get("real_provider_write_call_count")==0 and evidence.get("provider_validation")=="passed","stage234_i_commit_evidence_invalid")
    base.require(re.fullmatch(r"[a-f0-9]{40}",opts.preview_harness_head or "") and evidence.get("harness_head")==opts.preview_harness_head and manifest==preview.manifest(opts.preview_harness_head,directory),"stage234_i_commit_original_harness_hash_mismatch")

def command(opts,directory,state):
    args=["docker","run","--rm","--init","--name","hm-stage234-i-commit-"+opts.run_id,"--network",base.NETWORK,"--label","com.docker.compose.project="+base.PROJECT,"--memory","768m","--cpus","1","--env-file",str(state/"runtime.env"),"-v",str(directory)+":/stage234:ro","-v",str(state)+":/acceptance-state/"+state.name,"--entrypoint","node"]
    env={"STAGE234_SOURCE_HEAD":SOURCE,"STAGE234_IMAGE_DIGEST":IMAGE.split("@")[1],"STAGE234_HARNESS_HEAD":opts.harness_head,"STAGE234_RUN_DIR":"/acceptance-state/"+state.name,"STAGE234_EXPECTED_I_PREVIEW":opts.authorize_exact_preview,"STAGE234_EXPLICIT_COMMIT_AUTHORIZED":"true","STAGE234_GUARD_PRELOAD":"0","STAGE234_L_GUARD_PRELOAD":"0","STAGE234_I_GUARD_PRELOAD":"0","STAGE234_I_COMMIT_GUARD_PRELOAD":"0","STAGE234_L_COMMIT_GUARD_PRELOAD":"0","STAGE234_COMMIT_GUARD_PRELOAD":"0","STAGE234_APPROVAL_GATEWAY":"false","STAGE234_KEEP_API_ALIVE":"false","PROVIDER_GOOGLE_ADS_WRITE_ENABLED":"true","PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED":"false","PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED":"true","PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED":"false","GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST":"8590146099","PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID":"4378327049","PROVIDER_GOOGLE_API_VERSION":"v24","V2_PREVIEW_ONLY":"false","V2_CONFIRMED_WRITE_ENABLED":"true","PUBLIC_MCP_WRITE_SCOPE_ENABLED":"false","PUBLIC_MCP_CONTROLLED_WRITE_ENABLED":"false","API_PORT":"4000","LOG_LEVEL":"error","NODE_OPTIONS":"--max-old-space-size=192","STAGE234_I_DB_PREFLIGHT_ONLY":str(opts.db_precheck).lower()}
    for k,v in env.items():args+=["-e",k+"="+v]
    return args+[IMAGE,"/stage234/audience-commit-runner.mjs"]

def safe_report(value):
    keys={"result","code","failure_stage","preview_id","commit_id","confirmed_at","expires_at","session_valid","audit_valid","immutable_digest","provider_reads","validate_only","real_writes"}
    return {k:v for k,v in value.items() if k in keys}

def execute(opts):
    validate_options(opts)
    parent_name(opts)
    base.require(hasattr(os,"geteuid") and os.geteuid()==0,"stage234_i_commit_sudo_required")
    directory=Path(__file__).resolve().parent
    original=base.ROOT/"state"/parent_name(opts)
    protected(original,True)
    names=["protected-preview-context.json","evidence.json","runtime.env","i-harness-source.json","prepared-i-plan.json"]
    hashes={}
    for name in names:
        protected(original/name);hashes[name]=hashlib.sha256((original/name).read_bytes()).hexdigest()
    assert_origin(json.loads((original/names[0]).read_text()),json.loads((original/names[1]).read_text()),json.loads((original/names[3]).read_text()),directory,opts)
    production=base.production_state();gateway=gateway_state(opts);env_hash=base.inspect_ready(SOURCE,IMAGE)
    if not opts.db_precheck:
        fd=os.open(original/"i-commit-supervisor-launch.claim",os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,"w") as f:json.dump({"preview_id":opts.authorize_exact_preview,"run_id":opts.run_id,"source_head":SOURCE,"harness_head":opts.harness_head},f)
        os.chown(original/"i-commit-supervisor-launch.claim",1000,1000)
    state=base.ROOT/"state"/("stage234-i-commit-"+opts.run_id)
    state.mkdir(mode=0o700);os.chown(state,1000,1000)
    files={name:(original/name).read_bytes() for name in names}
    files["i-commit-harness-source.json"]=json.dumps({"head":opts.harness_head,"files":{name:hashlib.sha256((directory/name).read_bytes()).hexdigest() for name in ["audience-commit-guard.mjs","audience-commit-runner.mjs","run-audience-commit.py","timestamp.mjs","context-vault.mjs","wait-local-ready.mjs","startup-diagnostics.mjs"]}}).encode()
    for name,data in files.items():
        fd=os.open(state/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,"wb") as f:f.write(data)
        os.chown(state/name,1000,1000)
    output=None
    try:output=subprocess.run(command(opts,directory,state),capture_output=True,text=True,timeout=300)
    finally:
        base.require(base.production_state()==production and gateway_state(opts)==gateway,"stage234_i_commit_original_services_changed")
        base.require(hashlib.sha256((base.ROOT/"acceptance.env").read_bytes()).hexdigest()==env_hash and all(hashlib.sha256((original/name).read_bytes()).hexdigest()==value for name,value in hashes.items()),"stage234_i_commit_original_files_changed")
    lines=[line for line in output.stdout.splitlines() if line.startswith("{")]
    base.require(len(lines)==1,"stage234_i_commit_safe_report_missing")
    print(json.dumps(safe_report(json.loads(lines[0]))))
    if output.returncode:raise SystemExit(1)
if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    for name in ["head","harness-head","preview-harness-head","image","run-id","preview-run-id","authorize-exact-preview"]:p.add_argument("--"+name,required=True)
    p.add_argument("--db-precheck",action="store_true",help="DB approval/immutable ownership only, no vault refresh/provider calls/API.")
    try:execute(p.parse_args())
    except Exception as error:
        code=str(error) if isinstance(error,RuntimeError) and re.fullmatch(r"stage234_[a-z0-9_]+",str(error)) else "stage234_i_commit_supervisor_redacted"
        print(json.dumps({"result":"BLOCKED","code":code,"real_writes":None}))
        raise SystemExit(1)



