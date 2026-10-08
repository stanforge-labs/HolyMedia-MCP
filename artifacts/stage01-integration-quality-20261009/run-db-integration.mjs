import {execFileSync,spawn,spawnSync} from "node:child_process";import {writeFileSync} from "node:fs";import net from "node:net";import path from "node:path";import {fileURLToPath,pathToFileURL} from "node:url";
const base=path.dirname(fileURLToPath(import.meta.url)),root=process.cwd();
const remote="/home/ubuntu/holymedia-google-acceptance-harness/qa-stage01-20261009.py";
let tunnel,stage="config";const report={source_HEAD:"f67043207cf7e896cc09f0f0a9d358a9bd2aeb1b",scope:"independent disposable PG18/Redis; fake providers only",provider_calls:0,provider_writes:0,production_changed:false,main_changed:false,steps:[],result:"BLOCKED"};
try{
 const settings=JSON.parse(execFileSync("ssh",["ubuntu@77.240.38.131","sudo python3 "+remote+" client-env"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
 // Dedicated QA Redis DB3 avoids persisted rate counters from earlier attempts.
 // Never clear/relax a production limiter, shared Redis or acceptance Redis.
 settings.REDIS_URL += "/3";
 report.disposable_redis_database=3;
 const d=new URL(settings.DATABASE_URL),r=new URL(settings.REDIS_URL);
 if(d.hostname!=="127.0.0.1"||d.port!=="55419"||d.pathname!=="/public_mcp_upgrade"||d.username!=="holymedia"||r.hostname!=="127.0.0.1"||r.port!=="56380"||settings.PROVIDER_GOOGLE_ADS_WRITE_ENABLED!=="false"||settings.GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST!=="")throw Error("QA_config_scope_invalid");
 const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(PROVIDER_|GOOGLE_|META_|YANDEX_|TIKTOK_|DATABASE_URL|REDIS_URL|SESSION_HASH_SECRET|V2_|PUBLIC_MCP_)/.test(k))),...settings,NODE_ENV:"test",LOG_LEVEL:"error"};
 const values=Object.values(settings).filter(v=>v.length>16);values.push(d.password,r.password,settings.PROVIDER_CREDENTIAL_ENCRYPTION_KEYS.split(":")[1]);
 const redact=s=>values.reduce((a,v)=>a.split(v).join("[REDACTED]"),String(s??""));
 stage="tunnel";tunnel=spawn("ssh",["-N","-o","ExitOnForwardFailure=yes","-L","55419:127.0.0.1:55419","-L","56380:127.0.0.1:56380","ubuntu@77.240.38.131"],{stdio:"ignore",windowsHide:true});
 const ping=port=>new Promise(resolve=>{const s=net.connect({host:"127.0.0.1",port});s.setTimeout(1000);s.on("connect",()=>{s.destroy();resolve(true);});s.on("error",()=>resolve(false));s.on("timeout",()=>{s.destroy();resolve(false);});});
 let ready=false;for(let i=0;i<30;i++){if(tunnel.exitCode!==null)throw Error("QA_tunnel_failed");if(await ping(55419)&&await ping(56380)){ready=true;break;}await new Promise(r=>setTimeout(r,1000));}if(!ready)throw Error("QA_tunnel_not_ready");
 const run=(name,args,cwd=root)=>{
  stage=name;
  const result=spawnSync("pnpm",args,{cwd,env,encoding:"utf8",shell:true,windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});
  const text=redact((result.stdout??"")+"\n"+(result.stderr??""));
  writeFileSync(path.join(base,name+".txt"),text);
  report.steps.push({name,exit_code:result.status,tests:text.match(/Tests\s+[^\n]+/g)?.slice(-1)??null,skips:/\d+ skipped/.test(text)});
  console.log(JSON.stringify(report.steps.at(-1)));
  if(result.status!==0)throw Error("QA_step_failed");
 };
 run("migrate",["--dir","packages/database","run","prisma:deploy"]);
 run("migrate-status",["--dir","packages/database","run","prisma:status"]);
 env.NODE_OPTIONS="--import="+pathToFileURL(path.join(base,"no-provider-network.mjs")).href;
 run("database-integration",["exec","vitest","run","src/identity.integration.test.ts"],path.join(root,"packages/database"));
 run("api-integration",["exec","vitest","run","src/identity.integration.test.ts","src/analytics/product-analytics.integration.test.ts","src/providers/provider.integration.test.ts","src/service-tokens/service-token.integration.test.ts","src/infrastructure/redis.integration.test.ts","src/mcp/mcp-confirmation.integration.test.ts","src/mcp/oauth-authorization.integration.test.ts","src/mcp/mcp-public-write.pg18.integration.test.ts"],path.join(root,"apps/api"));
 run("worker-integration",["exec","vitest","run","src/retry.integration.test.ts","src/provider-discovery.integration.test.ts"],path.join(root,"apps/worker"));
 report.result="PASS";
}catch(e){report.failure_stage=stage;report.code=/^[A-Za-z0-9_]+$/.test(e.message)?e.message:"QA_runner_failed";process.exitCode=1;}
finally{if(tunnel)tunnel.kill();report.timestamp=new Date().toISOString();writeFileSync(path.join(base,"integration-tests.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
