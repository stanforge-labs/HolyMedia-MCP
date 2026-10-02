import { createHash, randomBytes, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";
import {
  createDatabase,
  closeDatabase,
} from "../packages/database/dist/index.js";
import { PasswordService } from "../apps/api/dist/auth/password.service.js";

export function assertDisposableDatabase(url) {
  const value = new URL(url);
  if (
    process.env.NODE_ENV !== "test" ||
    value.protocol !== "postgresql:" ||
    value.hostname !== "127.0.0.1" ||
    value.port !== "5432" ||
    value.pathname !== "/public_mcp_devmode" ||
    value.username !== "holymedia" ||
    value.password !== "ci-only-public-mcp" ||
    process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED !== "false" ||
    process.env.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED !== "false"
  )
    throw new Error("Disposable acceptance database guard rejected target.");
}

async function main() {
  const {
    DATABASE_URL,
    PUBLIC_MCP_ACCEPTANCE_EMAIL,
    PUBLIC_MCP_ACCEPTANCE_PASSWORD,
    HOLYMEDIA_PUBLIC_BASE_URL,
    RUNNER_TEMP,
  } = process.env;
  if (
    !DATABASE_URL ||
    !PUBLIC_MCP_ACCEPTANCE_EMAIL ||
    !PUBLIC_MCP_ACCEPTANCE_PASSWORD ||
    !HOLYMEDIA_PUBLIC_BASE_URL ||
    !RUNNER_TEMP
  )
    throw new Error("Acceptance seed environment is incomplete.");
  assertDisposableDatabase(DATABASE_URL);
  const origin = new URL(HOLYMEDIA_PUBLIC_BASE_URL);
  if (origin.protocol !== "https:" || origin.hostname === "mcp.holymedia.kz")
    throw new Error("Acceptance origin is not a disposable HTTPS tunnel.");

  const database = createDatabase(DATABASE_URL);
  try {
    const passwordHash = await new PasswordService().hash(
      PUBLIC_MCP_ACCEPTANCE_PASSWORD,
    );
    const fixtureClientId = `public-mcp-ci-${randomUUID()}`;
    const rawToken = `hm_oauth_${randomBytes(32).toString("base64url")}`;
    await database.client.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: PUBLIC_MCP_ACCEPTANCE_EMAIL.trim().toLowerCase(),
          name: "Public MCP acceptance",
          passwordHash,
          status: "active",
          emailVerifiedAt: new Date(),
        },
      });
      const workspace = await tx.workspace.create({
        data: {
          name: "Public MCP acceptance",
          slug: `public-mcp-ci-${randomUUID().slice(0, 8)}`,
          accessStatus: "ACTIVE",
          memberships: { create: { userId: user.id, role: "OWNER" } },
          entitlements: {
            create: { featureKey: "mcp", value: true, source: "acceptance_ci" },
          },
        },
      });
      const client = await tx.oAuthPublicClient.create({
        data: {
          clientId: fixtureClientId,
          clientName: "Disposable preflight only",
          redirectUris: ["https://client.example.test/callback"],
          scope: "adforge:mcp:read",
          registrationSource: "acceptance_ci",
        },
      });
      await tx.oAuthAccessToken.create({
        data: {
          tokenDigest: createHash("sha256").update(rawToken).digest("hex"),
          tokenPrefix: "hm_oauth_",
          clientId: client.id,
          workspaceId: workspace.id,
          userId: user.id,
          scope: "adforge:mcp:read",
          resource: `${origin.origin}/mcp/public`,
          refreshFamilyId: randomUUID(),
          expiresAt: new Date(Date.now() + 15 * 60_000),
        },
      });
    });
    const handle = await open(
      join(RUNNER_TEMP, "public-mcp-preflight-token.json"),
      "wx",
      0o600,
    );
    try {
      await handle.writeFile(
        JSON.stringify({ token: rawToken, clientId: fixtureClientId }),
      );
    } finally {
      await handle.close();
    }
    console.log("ACCEPTANCE SEED OK");
  } finally {
    await closeDatabase(database);
  }
}

if (process.argv[1]?.endsWith("public_mcp_devmode_seed.mjs")) {
  main().catch((error) => {
    console.error(
      `ACCEPTANCE SEED FAILED: ${error instanceof Error ? error.constructor.name : "unknown"}`,
    );
    process.exitCode = 1;
  });
}
