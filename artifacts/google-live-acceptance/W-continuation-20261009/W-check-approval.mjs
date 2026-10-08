import {approvalProof} from './W-approval-proof.mjs';
const {loadConfig}=await import('/workspace/packages/config/dist/index.js'),{createDatabase,closeDatabase}=await import('/workspace/packages/database/dist/index.js');
const config=loadConfig(),db=createDatabase(config.databaseUrl);
try {const proof=await approvalProof(db,config);console.log(JSON.stringify({result:'W_APPROVAL_VALID',...proof.safe,provider_calls:0}));}
catch(e){console.log(JSON.stringify({result:'BLOCKED',code:/^[A-Za-z0-9_]+$/.test(e.message)?e.message:'W_approval_internal_error',provider_calls:0}));process.exitCode=1;}
finally{await closeDatabase(db);}
