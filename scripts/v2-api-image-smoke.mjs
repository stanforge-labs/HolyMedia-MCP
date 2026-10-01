import { createHash, randomBytes } from "node:crypto";
import {
  createDatabase,
  closeDatabase,
} from "/workspace/packages/database/dist/index.js";

const database = createDatabase(process.env.DATABASE_URL);
const db = database.client;
const slug = `api-image-smoke-${randomBytes(8).toString("hex")}`;
let workspaceId;

async function mcp(token, id, method) {
  const response = await fetch("http://127.0.0.1:4000/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method }),
  });
  if (response.status !== 200)
    throw new Error(`${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (body.id !== id || body.error)
    throw new Error(`${method}: invalid response`);
  return body.result;
}

try {
  const workspace = await db.workspace.create({
    data: { name: "Disposable API image smoke", slug, accessStatus: "ACTIVE" },
  });
  workspaceId = workspace.id;
  const identity = await db.serviceIdentity.create({
    data: { workspaceId, name: "disposable-api-image-smoke" },
  });
  const token = `hmst_${randomBytes(32).toString("base64url")}`;
  await db.serviceToken.create({
    data: {
      serviceIdentityId: identity.id,
      tokenDigest: createHash("sha256").update(token).digest("hex"),
      tokenPrefix: token.slice(0, 13),
      name: "disposable-api-image-smoke",
      scopes: ["adforge:mcp:read"],
      accountIds: [],
      expiresAt: new Date(Date.now() + 300_000),
    },
  });

  const initialized = await mcp(token, 1, "initialize");
  if (initialized?.protocolVersion !== "2025-03-26") {
    throw new Error("MCP initialize protocol mismatch");
  }
  const listing = await mcp(token, 2, "tools/list");
  const names = new Set(listing?.tools?.map((tool) => tool.name));
  const expected = [
    "google_ads_list_keywords",
    "google_ads_search_terms",
    "google_ads_list_negatives",
    "google_ads_check_negative_conflicts",
  ];
  for (const name of expected) {
    if (!names.has(name)) throw new Error(`Missing Google Ads tool: ${name}`);
  }
  console.log(
    `MCP initialize/tools/list PASS; Google Ads READ tools: ${expected.join(", ")}`,
  );
} finally {
  if (workspaceId) await db.workspace.delete({ where: { id: workspaceId } });
  await closeDatabase(database);
}
