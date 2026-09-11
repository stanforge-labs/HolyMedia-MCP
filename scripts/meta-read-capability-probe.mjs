// Read-only production diagnostic. Run inside the API container; never emits credentials.
import {
  createDatabase,
  closeDatabase,
} from "/workspace/packages/database/dist/index.js";
import { CredentialVaultService } from "/workspace/apps/api/dist/providers/credential-vault.service.js";
import { loadConfig } from "/workspace/packages/config/dist/index.js";
const [workspaceId, accountId, pageId, postId] = process.argv.slice(2);
if (
  !workspaceId ||
  !/^act_\d+$/.test(accountId ?? "") ||
  !/^\d+$/.test(pageId ?? "") ||
  !postId?.startsWith(pageId + "_")
)
  throw new Error("Explicit workspace/account/page/post required");
const db = createDatabase(process.env.DATABASE_URL);
try {
  const account = await db.client.providerAccount.findFirst({
    where: {
      workspaceId,
      externalAccountId: accountId,
      provider: "META_ADS",
      enabled: true,
      connection: { workspaceId, status: "CONNECTED" },
    },
    include: { connection: { include: { credential: true } } },
  });
  if (!account?.connection.credential)
    throw new Error("Authorized current account/credential unavailable");
  const credential = new CredentialVaultService().decrypt(
    account.connection.credential.encryptedPayload,
    account.connection.credential.encryptionVersion,
  );
  const version = loadConfig().providerMetaApiVersion;
  let pageToken;
  async function get(path, fields, token, context, extra = {}) {
    const url = new URL(`https://graph.facebook.com/${version}/${path}`);
    url.search = new URLSearchParams({ fields, ...extra }).toString();
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    });
    const body = await response.json();
    const message =
      typeof body.error?.message === "string"
        ? body.error.message
            .split(credential.accessToken)
            .join("[redacted]")
            .split(pageToken ?? "never-a-token")
            .join("[redacted]")
            .replace(/https?:\/\/\S+/g, "[url]")
            .slice(0, 500)
        : null;
    console.log(
      JSON.stringify({
        endpoint: path,
        version,
        effectiveVersion: response.headers.get("facebook-api-version"),
        tokenContext: context,
        fields,
        httpStatus: response.status,
        code: body.error?.code ?? null,
        subcode: body.error?.error_subcode ?? null,
        message,
        returnedFields: Object.keys(body).filter((k) => k !== "error"),
        count: Array.isArray(body.data) ? body.data.length : null,
        postId: body.id ?? null,
        purchaseRoasRows: Array.isArray(body.data)
          ? body.data.filter((r) => Object.hasOwn(r, "purchase_roas")).length
          : null,
        purchaseRoasSample:
          body.data?.find((r) => r.purchase_roas)?.purchase_roas ?? null,
      }),
    );
    return body;
  }
  const pages = await get(
    "me/accounts",
    "id,access_token",
    credential.accessToken,
    "user",
    { limit: "100" },
  );
  pageToken = pages.data?.find((p) => p.id === pageId)?.access_token;
  if (!pageToken)
    throw new Error("Page not returned in current credential assets");
  const base = "id,message,story,created_time,permalink_url";
  await get(`${pageId}/published_posts`, base + ",shares", pageToken, "page", {
    limit: "2",
  });
  await get(postId, base, pageToken, "page");
  for (const field of [
    "shares",
    "reactions.limit(0).summary(true)",
    "comments.limit(0).summary(true)",
  ])
    await get(postId, "id," + field, pageToken, "page");
  for (const level of ["account", "campaign", "adset", "ad"])
    await get(
      `${accountId}/insights`,
      "spend,purchase_roas",
      credential.accessToken,
      "user",
      {
        level,
        time_range: JSON.stringify({
          since: "2026-08-12",
          until: "2026-09-10",
        }),
        limit: "5",
      },
    );
} catch (error) {
  console.log(JSON.stringify({ diagnosticError: error.name }));
  process.exitCode = 1;
} finally {
  await closeDatabase(db);
}
