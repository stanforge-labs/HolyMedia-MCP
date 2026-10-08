"""Independent DB/Redis quality stack; no provider credentials."""
import json,os,secrets,subprocess,sys
from pathlib import Path
ROOT=Path('/opt/holymedia-google-stage2-qa-20261009')
PROJECT='holymedia-google-stage2-qa-20261009'
UPLOAD=Path('/home/ubuntu/holymedia-google-acceptance-harness')
def prod():
 p=subprocess.run(['python3',str(UPLOAD/'provision.py'),'verify'],capture_output=True,text=True)
 if p.returncode:raise RuntimeError('QA_production_baseline_changed')
def compose(*args):
 return subprocess.run(['docker','compose','-p',PROJECT,'--env-file',str(ROOT/'qa.env'),'-f',str(ROOT/'compose.yml'),*args],capture_output=True,text=True,check=True)
try:
 if os.geteuid()!=0 or len(sys.argv)!=2 or sys.argv[1] not in ('up','client-env','check','down'):raise RuntimeError('QA_arguments_invalid')
 mode=sys.argv[1];prod()
 if mode=='up':
  if ROOT.exists():raise RuntimeError('QA_directory_already_exists')
  ROOT.mkdir(mode=0o700)
  data={'db_password':secrets.token_hex(24),'redis_password':secrets.token_hex(24),'session_secret':secrets.token_hex(32),'encryption_key':secrets.token_urlsafe(32)}
  (ROOT/'secrets.json').write_text(json.dumps(data));os.chmod(ROOT/'secrets.json',0o600)
  (ROOT/'qa.env').write_text('QA_DB_PASSWORD='+data['db_password']+'\nQA_REDIS_PASSWORD='+data['redis_password']+'\n');os.chmod(ROOT/'qa.env',0o600)
  (ROOT/'compose.yml').write_text("""services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_USER: holymedia
      POSTGRES_PASSWORD: ${QA_DB_PASSWORD}
      POSTGRES_DB: public_mcp_upgrade
    ports: ["127.0.0.1:55420:5432"]
    volumes: ["qa_pg:/var/lib/postgresql"]
    mem_limit: 256m
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U holymedia -d public_mcp_upgrade"]
      interval: 2s
      timeout: 2s
      retries: 25
  redis:
    image: redis:7.4
    command: ["redis-server", "--requirepass", "${QA_REDIS_PASSWORD}", "--appendonly", "no"]
    ports: ["127.0.0.1:56381:6379"]
    volumes: ["qa_redis:/data"]
    mem_limit: 128m
    healthcheck:
      test: ["CMD-SHELL", "REDISCLI_AUTH=$${QA_REDIS_PASSWORD} redis-cli ping"]
      interval: 2s
      timeout: 2s
      retries: 25
    environment:
      QA_REDIS_PASSWORD: ${QA_REDIS_PASSWORD}
volumes:
  qa_pg:
  qa_redis:
""")
  compose('up','-d','--wait','--wait-timeout','90');prod();print('QA_ISOLATED_HEALTHY')
 elif mode=='client-env':
  d=json.loads((ROOT/'secrets.json').read_text());db='postgresql://holymedia:'+d['db_password']+'@127.0.0.1:55420/public_mcp_upgrade'
  print(json.dumps({'DATABASE_URL':db,'REDIS_URL':'redis://:'+d['redis_password']+'@127.0.0.1:56381','SESSION_HASH_SECRET':d['session_secret'],'PROVIDER_CREDENTIAL_ENCRYPTION_KEYS':'1:'+d['encryption_key'],'PROVIDER_CREDENTIAL_CURRENT_KEY_VERSION':'1','V2_INTEGRATION_TESTS':'true','V2_PG18_TEST_DATABASE_URL':db,'V2_PG18_REHEARSAL':'true','PROVIDER_GOOGLE_ADS_WRITE_ENABLED':'false','GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST':'','PUBLIC_MCP_WRITE_SCOPE_ENABLED':'false','PUBLIC_MCP_CONTROLLED_WRITE_ENABLED':'false'}))
 elif mode=='check':
  compose('ps');prod();print('QA_HEALTHY_PRODUCTION_UNCHANGED')
 else:
  if ROOT.resolve()!=Path('/opt/holymedia-google-stage2-qa-20261009'):raise RuntimeError('QA_cleanup_scope_invalid')
  compose('down','--volumes');prod();print('QA_DISPOSABLE_CONTAINERS_VOLUMES_REMOVED')
except Exception as e:
 print(str(e) if isinstance(e,RuntimeError) else 'QA_operation_failed');raise SystemExit(1)
