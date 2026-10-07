import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@holymedia/config";
import {
  GoogleAdsAdapter,
  googleAdsDefinition,
} from "../providers/adapters/google.ads.js";
import {
  GOOGLE_MUTATION_BATCH_LIMIT,
  googleMutationResults,
} from "../providers/google-ads-write.js";
import { McpPreviewService } from "./mcp-preview.service.js";
import { McpPublicWriteService } from "./mcp-public-write.service.js";
import { McpService } from "./mcp.service.js";
import { publicTools } from "./mcp-public-tools.js";
import type { ServiceTokenPrincipal } from "../service-tokens/service-token.service.js";
import type { HumanPrincipal } from "../auth/auth.types.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const customer = "1234567890";
const principal: ServiceTokenPrincipal = {
  kind: "service",
  tokenId: "token-a",
  serviceIdentityId: "identity-a",
  workspaceId: "workspace-a",
  accountIds: ["account-a"],
  scopes: ["adforge:mcp:read", "adforge:mcp:write"],
};
const human: HumanPrincipal = {
  kind: "human",
  userId: "user-a",
  sessionId: "session-a",
};
const identity = (id: string) => ({
  campaign_id: "1",
  ad_group_id: "10",
  criterion_id: id,
  resource_name: `customers/${customer}/adGroupCriteria/10~${id}`,
});
type Row = Record<string, unknown> & {
  id: string;
  confirmedAt: Date | null;
  consumedAt: Date | null;
  cancelledAt: Date | null;
  expiresAt: Date;
};

function fixture(initialStatus = "ENABLED", allowlist = customer) {
  for (const [k, v] of Object.entries({
    NODE_ENV: "test",
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
    GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: allowlist,
    V2_PREVIEW_ONLY: "false",
    V2_CONFIRMED_WRITE_ENABLED: "true",
    HOLYMEDIA_PUBLIC_BASE_URL: "https://mcp.holymedia.kz",
  }))
    vi.stubEnv(k, v);
  const config = loadConfig({
    ...process.env,
    PROVIDER_GOOGLE_CLIENT_ID: "fixture-client",
    PROVIDER_GOOGLE_CLIENT_SECRET: "fixture-secret",
    PROVIDER_GOOGLE_REDIRECT_URI: "https://example.test/oauth",
  });
  const adapter = new GoogleAdsAdapter(config);
  const context = {
    accountId: customer,
    loginCustomerId: "9999999999",
    credentials: {
      accessToken: "fixture-access",
      scopes: ["https://www.googleapis.com/auth/adwords"],
    },
  };
  const states = new Map(
    ["101", "102", "103"].map((id) => [
      id,
      {
        campaign: { id: "1", name: "TEST PPC", status: "PAUSED" },
        adGroup: { id: "10", name: "TEST group", status: "ENABLED" },
        adGroupCriterion: {
          criterionId: id,
          resourceName: identity(id).resource_name,
          negative: false,
          type: "KEYWORD",
          keyword: { text: `test ${id}`, matchType: "EXACT" },
          status: initialStatus,
        },
      },
    ]),
  );
  const requests: Array<{
    url: string;
    body: Record<string, unknown>;
    headers: Record<string, string>;
  }> = [];
  let providerWrites = 0,
    failIndex: number | null = null,
    validateFail = false,
    denyClaim = false,
    activeToken = true,
    staleBeforeCommit = false,
    rereadFails = false,
    dropFailedRow = false;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({
      url,
      body,
      headers: init?.headers as Record<string, string>,
    });
    if (url.endsWith("/googleAds:searchStream")) {
      if (rereadFails && providerWrites > 0)
        throw new Error("fixture read outage");
      const resources =
        String(body.query).match(/customers\/\d+\/adGroupCriteria\/\d+~\d+/g) ??
        [];
      return Response.json([
        {
          results: resources.flatMap((resource) => {
            const id = resource.split("~")[1]!,
              state = states.get(id);
            return state ? [structuredClone(state)] : [];
          }),
        },
      ]);
    }
    if (!url.endsWith("/adGroupCriteria:mutate"))
      throw new Error("Unexpected provider URL: fixture only");
    const operations = body.operations as Array<{
      update: { resourceName: string; status: string };
      updateMask: string;
    }>;
    const validation = body.validateOnly === true;
    const failed =
      validation && validateFail ? 0 : !validation ? failIndex : null;
    if (!validation) {
      providerWrites++;
      operations.forEach((op, index) => {
        const id = op.update.resourceName.split("~")[1]!;
        if (index !== failed)
          states.get(id)!.adGroupCriterion.status = op.update.status;
        else if (dropFailedRow) states.delete(id);
      });
    }
    return Response.json({
      ...(validation
        ? {}
        : {
            results: operations.map((x, i) =>
              i === failed ? {} : { resourceName: x.update.resourceName },
            ),
          }),
      ...(failed !== null
        ? {
            partialFailureError: {
              code: 3,
              details: [
                {
                  "@type":
                    "type.googleapis.com/google.ads.googleads.v24.errors.GoogleAdsFailure",
                  errors: [
                    {
                      errorCode: {
                        authorizationError: "USER_PERMISSION_DENIED",
                      },
                      message: "Bearer sensitive fixture ignored",
                      location: {
                        fieldPathElements: [
                          { fieldName: "operations", index: failed },
                          { fieldName: "update" },
                          { fieldName: "status" },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          }
        : {}),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  let row: Row | null = null;
  const match = (where: Record<string, unknown>) => {
    if (!row) return false;
    return Object.entries(where).every(([key, value]) => {
      if (key === "account") {
        const rule = value as Record<string, unknown>;
        return (
          rule.workspaceId === account.workspaceId &&
          rule.connectionId === account.connectionId &&
          rule.externalAccountId === account.externalAccountId &&
          rule.provider === account.provider &&
          rule.enabled === true
        );
      }
      if (key === "serviceToken") {
        const creator = (
          value as { serviceIdentity?: { createdById?: string } }
        ).serviceIdentity?.createdById;
        return !creator || creator === human.userId;
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const condition = value as Record<string, unknown>;
        if ("gt" in condition)
          return (
            row![key] instanceof Date &&
            (row![key] as Date) > (condition.gt as Date)
          );
        if ("not" in condition) return row![key] !== condition.not;
        if ("equals" in condition)
          return JSON.stringify(row![key]) === JSON.stringify(condition.equals);
        if ("in" in condition)
          return (condition.in as unknown[]).includes(row![key]);
      }
      return row![key] === value;
    });
  };
  const account = {
    id: "account-a",
    workspaceId: principal.workspaceId,
    provider: "GOOGLE_ADS",
    externalAccountId: customer,
    connectionId: "connection-a",
    displayName: "TEST Ads",
  };
  const claim = vi.fn(
    async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      if (denyClaim || !activeToken || !match(where)) return { count: 0 };
      Object.assign(row!, data);
      return { count: 1 };
    },
  );
  const database = {
    client: {
      providerAccount: { findFirst: vi.fn(async () => account) },
      serviceToken: {
        findFirst: vi.fn(async () =>
          activeToken
            ? {
                scopes: principal.scopes,
                accountIds: principal.accountIds,
                resourceAccessMode: "STATIC_ALLOWLIST",
                serviceIdentity: { createdById: human.userId },
              }
            : null,
        ),
      },
      mcpPreview: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          row = {
            ...structuredClone(data),
            id: "preview-a",
            confirmedAt: null,
            consumedAt: null,
            cancelledAt: null,
            expiresAt: data.expiresAt as Date,
          };
          return structuredClone(row);
        }),
        findFirst: vi.fn(
          async ({ where }: { where: Record<string, unknown> }) =>
            match(where)
              ? {
                  ...structuredClone(row!),
                  serviceToken: {
                    serviceIdentityId: principal.serviceIdentityId,
                  },
                }
              : null,
        ),
        updateMany: claim,
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(row!, data);
          return row;
        }),
      },
    },
  };
  const audit = {
    record: vi.fn<(input: unknown) => Promise<void>>(async () => undefined),
  };
  const providers = {
    readGoogleKeywordStates: vi.fn(
      async (
        _w: string,
        _c: string,
        _a: string,
        items: Parameters<GoogleAdsAdapter["readKeywordStates"]>[1],
      ) => {
        if (staleBeforeCommit) {
          states.get("101")!.adGroupCriterion.status = "PAUSED";
          staleBeforeCommit = false;
        }
        return adapter.readKeywordStates(context, items);
      },
    ),
    validateGoogleKeywordStatuses: vi.fn(
      async (
        _w: string,
        _c: string,
        _a: string,
        items: Parameters<GoogleAdsAdapter["validateKeywordStatuses"]>[1],
      ) => adapter.validateKeywordStatuses(context, items),
    ),
    commitGoogleKeywordStatuses: vi.fn(
      async (
        _w: string,
        _c: string,
        _a: string,
        items: Parameters<GoogleAdsAdapter["commitKeywordStatuses"]>[1],
      ) => adapter.commitKeywordStatuses(context, items),
    ),
  };
  const previews = new McpPreviewService(
    database as never,
    audit as never,
    providers as never,
  );
  const browser = new McpPublicWriteService(
    database as never,
    audit as never,
    providers as never,
    previews,
  );
  const mcp = new McpService(
    database as never,
    providers as never,
    {} as never,
    previews,
    {} as never,
    {} as never,
  );
  async function preview(
    status: "ENABLED" | "PAUSED" = "PAUSED",
    ids = ["101"],
  ) {
    const result = await mcp.call(
      principal,
      status === "PAUSED"
        ? "pause_entities_preview"
        : "update_entity_status_preview",
      {
        provider: "GOOGLE_ADS",
        account_id: customer,
        entity_type: "keyword",
        status,
        items: ids.map(identity),
      },
    );
    return result as {
      preview_token: string;
      approval_url: string;
      items: Array<Record<string, unknown>>;
      provider_validation: string;
      expires_at: string;
      status: string;
    };
  }
  async function approve(result: Awaited<ReturnType<typeof preview>>) {
    return browser.decideApproval(
      human,
      result.approval_url.split("#")[1]!,
      "approve",
    );
  }
  return {
    adapter,
    context,
    previews,
    browser,
    mcp,
    preview,
    approve,
    requests,
    states,
    audit,
    database,
    claim,
    providers,
    row: () => row!,
    writes: () => providerWrites,
    setFail: (index: number | null) => {
      failIndex = index;
    },
    setValidateFail: () => {
      validateFail = true;
    },
    denyClaim: () => {
      denyClaim = true;
    },
    revoke: () => {
      activeToken = false;
    },
    stale: () => {
      staleBeforeCommit = true;
    },
    failReread: () => {
      rereadFails = true;
    },
    dropFailedRow: () => {
      dropFailedRow = true;
    },
  };
}

describe("Google keyword status full generic lifecycle (mock provider only)", () => {
  it("C: 19 valid + 1 missing produces 20 review rows but only 19 immutable provider mutations", async () => {
    const f = fixture();
    for (let id = 104; id <= 119; id++) {
      const row = structuredClone(f.states.get("101")!);
      row.adGroupCriterion.criterionId = String(id);
      row.adGroupCriterion.resourceName = identity(String(id)).resource_name;
      f.states.set(String(id), row);
    }
    const p = await f.preview("PAUSED", [
      "999",
      ...Array.from({ length: 19 }, (_, i) => String(101 + i)),
    ]);
    expect(p).toMatchObject({
      status: "preview",
      operation_count: 19,
      requested_operation_count: 20,
      excluded_operation_count: 1,
    });
    expect(p.items).toHaveLength(20);
    expect(p.items[0]).toMatchObject({
      criterion_id: "999",
      before_status: null,
      eligible_for_commit: false,
      row_error: {
        source: "HOLYMEDIA",
        stage: "snapshot_read",
        code: "google_keyword_unavailable",
        google_code: null,
      },
    });
    expect(f.writes()).toBe(0);
    const view = await f.browser.approvalView(
      human,
      p.approval_url.split("#")[1]!,
    );
    const reviewRows = (view as { items: Array<Record<string, unknown>> })
      .items;
    expect(reviewRows).toHaveLength(20);
    expect(reviewRows[0]).toMatchObject({
      criterion_id: "999",
      eligible_for_commit: false,
    });
    await expect(
      f.previews.commit(principal, p.preview_token),
    ).rejects.toMatchObject({ code: "preview_not_confirmed" });
    await f.approve(p);
    const result = await f.previews.commit(principal, p.preview_token);
    expect(result).toMatchObject({
      status: "PARTIAL_FAILURE",
      operation_count: 19,
      partial_failure: true,
    });
    const resultRows = (result as { items: Array<Record<string, unknown>> })
      .items;
    expect(resultRows.filter((x) => x.success)).toHaveLength(19);
    expect(resultRows[0]).toMatchObject({
      success: false,
      result: "rejected",
      google_error: null,
      row_error: { source: "HOLYMEDIA", google_code: null },
    });
    const commit = f.requests.filter((x) => x.url.endsWith(":mutate")).at(-1)!;
    expect(commit.body.partialFailure).toBe(true);
    expect(commit.body.operations).toHaveLength(19);
    expect(JSON.stringify(commit.body)).not.toContain("~999");
    expect(f.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "mcp_google_keyword_row_rejected",
        metadata: expect.objectContaining({
          objectId: "999",
          errorSource: "HOLYMEDIA",
          googleErrorCode: null,
        }),
      }),
    );
    expect(f.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "mcp_google_commit_result",
        metadata: expect.objectContaining({ result: "PARTIAL_FAILURE" }),
      }),
    );
  });
  it("all missing is a non-committable result with no validation or write", async () => {
    const f = fixture(),
      p = await f.preview("PAUSED", ["998", "999"]);
    expect(p).toMatchObject({
      status: "validation_failed",
      operation_count: 0,
      excluded_operation_count: 2,
    });
    expect(p.preview_token).toBeUndefined();
    expect(f.requests.some((x) => x.url.endsWith(":mutate"))).toBe(false);
    expect(f.database.client.mcpPreview.create).not.toHaveBeenCalled();
  });
  it("malformed or foreign snapshot is never accepted as a mixed-batch mutation", async () => {
    for (const malformed of ["empty", "foreign"]) {
      const f = fixture();
      const row = {
        ...identity("101"),
        account_id: "5555555555",
        campaign_name: "TEST PPC",
        campaign_status: "PAUSED",
        ad_group_name: "TEST group",
        ad_group_status: "ENABLED",
        keyword: "test 101",
        match_type: "EXACT",
        status: "ENABLED" as const,
      };
      f.providers.readGoogleKeywordStates.mockResolvedValueOnce(
        malformed === "foreign" ? [row] : [],
      );
      await expect(f.preview("PAUSED", ["101", "999"])).rejects.toMatchObject({
        writeCode: "google_response_invalid",
      });
      expect(f.requests).toHaveLength(0);
      expect(f.writes()).toBe(0);
    }
  });
  it("mixed batch still rejects duplicate and foreign-account identities before Google access", async () => {
    for (const items of [
      [identity("101"), identity("101"), identity("999")],
      [
        identity("101"),
        {
          ...identity("999"),
          resource_name: "customers/5555555555/adGroupCriteria/10~999",
        },
      ],
    ]) {
      const f = fixture();
      await expect(
        f.mcp.call(principal, "pause_entities_preview", {
          provider: "GOOGLE_ADS",
          account_id: customer,
          entity_type: "keyword",
          items,
        }),
      ).rejects.toThrow();
      expect(f.requests).toHaveLength(0);
      expect(f.writes()).toBe(0);
    }
  });
  it("mixed batch rechecks both valid snapshot and formerly missing rows before commit", async () => {
    for (const changed of ["valid", "missing"]) {
      const f = fixture(),
        p = await f.preview("PAUSED", ["101", "999"]);
      await f.approve(p);
      if (changed === "valid") f.stale();
      else {
        const row = structuredClone(f.states.get("101")!);
        row.adGroupCriterion.criterionId = "999";
        row.adGroupCriterion.resourceName = identity("999").resource_name;
        f.states.set("999", row);
      }
      await expect(
        f.previews.commit(principal, p.preview_token),
      ).rejects.toMatchObject({ code: "google_preview_stale" });
      expect(f.writes()).toBe(0);
    }
  });
  it("rejection payload tampering cannot bypass approval/digest or add mutation targets", async () => {
    const f = fixture(),
      p = await f.preview("PAUSED", ["101", "999"]);
    (
      f.row().payload as {
        batch_rejections: Array<{ error: { message: string } }>;
      }
    ).batch_rejections[0]!.error.message = "tampered";
    await expect(f.approve(p)).rejects.toMatchObject({
      code: "confirmation_context_mismatch",
    });
    expect(f.writes()).toBe(0);
  });
  it("provider validation errors remain Google-sourced while valid rows can commit", async () => {
    const f = fixture();
    f.setValidateFail();
    const p = await f.preview("PAUSED", ["101", "102"]);
    expect(p.items[0]).toMatchObject({
      eligible_for_commit: false,
      row_error: {
        source: "GOOGLE_ADS",
        stage: "validate_only",
        google_code: "USER_PERMISSION_DENIED",
      },
    });
    await f.approve(p);
    const result = await f.previews.commit(principal, p.preview_token);
    expect(result).toMatchObject({
      status: "PARTIAL_FAILURE",
      items: [
        {
          criterion_id: "101",
          success: false,
          google_error: { google_code: "USER_PERMISSION_DENIED" },
        },
        { criterion_id: "102", success: true },
      ],
    });
    expect(f.writes()).toBe(1);
  });
  it("mixed batch does not turn permission/network errors into row skips", async () => {
    const f = fixture();
    f.providers.readGoogleKeywordStates.mockRejectedValueOnce(
      new Error("fixture transport outage"),
    );
    await expect(f.preview("PAUSED", ["101", "999"])).rejects.toThrow(
      "fixture transport outage",
    );
    expect(f.database.client.mcpPreview.create).not.toHaveBeenCalled();
    expect(f.writes()).toBe(0);
  });
  it("a durable rejected-row audit failure prevents the valid provider write too", async () => {
    const f = fixture(),
      p = await f.preview("PAUSED", ["101", "999"]);
    await f.approve(p);
    f.audit.record.mockImplementation(async (input) => {
      if (
        (input as { eventType: string }).eventType ===
        "mcp_google_keyword_row_rejected"
      )
        throw new Error("audit down");
    });
    await expect(f.previews.commit(principal, p.preview_token)).rejects.toThrow(
      "audit down",
    );
    expect(f.writes()).toBe(0);
  });
  it("concurrent commits execute the approved batch at most once", async () => {
    const f = fixture(),
      p = await f.preview();
    await f.approve(p);
    const results = await Promise.allSettled([
      f.previews.commit(principal, p.preview_token),
      f.previews.commit(principal, p.preview_token),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(f.writes()).toBe(1);
    expect(
      f.claim.mock.calls.find(
        ([arg]) => arg.data.commitStatus === "CLAIMED",
      )?.[0].where,
    ).toMatchObject({
      serviceToken: expect.objectContaining({
        serviceIdentityId: principal.serviceIdentityId,
        scopes: { array_contains: ["adforge:mcp:read", "adforge:mcp:write"] },
        AND: expect.any(Array),
      }),
      account: expect.objectContaining({
        workspaceId: principal.workspaceId,
        provider: "GOOGLE_ADS",
        enabled: true,
      }),
    });
  });
  it("preview, approval and commit remain closed when the new feature gate is OFF", async () => {
    const f = fixture();
    vi.stubEnv("PROVIDER_GOOGLE_ADS_WRITE_ENABLED", "false");
    const closed = new McpPreviewService(
      f.database as never,
      f.audit as never,
      f.providers as never,
    );
    await expect(
      closed.create(principal, {
        provider: "GOOGLE_ADS",
        accountId: customer,
        objectId: "keyword_batch",
        operation: "pause",
        payload: { entity_type: "keyword", items: [identity("101")] },
      }),
    ).rejects.toMatchObject({ writeCode: "google_write_disabled" });
    expect(f.requests).toHaveLength(0);
  });
  it("removed or rebound keyword at prewrite reread reports stale, not a mutation", async () => {
    const f = fixture(),
      p = await f.preview();
    await f.approve(p);
    f.states.delete("101");
    await expect(
      f.previews.commit(principal, p.preview_token),
    ).rejects.toMatchObject({ code: "google_preview_stale" });
    expect(f.writes()).toBe(0);
  });
  it("A/B/C: pause preview reads truth, validates only, stores a 30-minute preview without provider writes", async () => {
    const f = fixture(),
      p = await f.preview();
    expect(p.items[0]).toMatchObject({
      criterion_id: "101",
      keyword: "test 101",
      before_status: "ENABLED",
      after_status: "PAUSED",
      campaign_name: "TEST PPC",
      ad_group_name: "TEST group",
      google_validation: { success: true },
    });
    expect(f.writes()).toBe(0);
    expect(f.states.get("101")!.adGroupCriterion.status).toBe("ENABLED");
    const req = f.requests.find((x) => x.url.endsWith(":mutate"))!;
    expect(req.body).toMatchObject({
      validateOnly: true,
      partialFailure: true,
      operations: [
        {
          updateMask: "status",
          update: {
            resourceName: identity("101").resource_name,
            status: "PAUSED",
          },
        },
      ],
    });
    expect(req.headers["login-customer-id"]).toBe("9999999999");
    expect(Date.parse(p.expires_at) - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(f.row().previewTokenDigest).not.toBe(p.preview_token);
    expect(f.row().approvalTokenDigest).not.toBe(p.approval_url.split("#")[1]);
  });
  it("positive keyword read supports omitted ProtoJSON false while filtering out negative criteria", async () => {
    const f = fixture();
    delete (f.states.get("101")!.adGroupCriterion as Record<string, unknown>)
      .negative;
    const p = await f.preview();
    expect(p.provider_validation).toBe("passed");
    expect(f.requests[0]!.body.query).toContain(
      "ad_group_criterion.negative = FALSE",
    );
    expect(f.writes()).toBe(0);
  });
  it("resume completes browser approval → exact commit → reread → per-row audit", async () => {
    const f = fixture("PAUSED"),
      p = await f.preview("ENABLED");
    await f.approve(p);
    expect(f.writes()).toBe(0);
    const result = await f.mcp.call(principal, "commit_preview", {
      preview_token: p.preview_token,
    });
    expect(result).toMatchObject({
      status: "VERIFIED",
      items: [
        {
          success: true,
          old_status: "PAUSED",
          requested_status: "ENABLED",
          actual_status: "ENABLED",
        },
      ],
    });
    expect(f.writes()).toBe(1);
    const commit = f.requests.filter((x) => x.url.endsWith(":mutate"))[1]!;
    expect(commit.body).toMatchObject({
      validateOnly: false,
      partialFailure: true,
    });
    expect(f.requests.at(-1)!.url).toContain("searchStream");
    expect(f.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "mcp_google_keyword_status",
        metadata: expect.objectContaining({
          campaignId: "1",
          adGroupId: "10",
          objectId: "101",
          before: "PAUSED",
          after: "ENABLED",
          actual: "ENABLED",
          previewId: "preview-a",
          result: "success",
          serviceIdentityId: "identity-a",
        }),
      }),
    );
  });
  it("JSONB key reordering survives approval/commit; approval ignores an unbound display diff", async () => {
    const f = fixture(),
      p = await f.preview();
    function jsonb(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(jsonb);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value)
            .reverse()
            .map(([key, child]) => [key, jsonb(child)]),
        );
      return value;
    }
    f.row().beforeState = jsonb(f.row().beforeState);
    f.row().requestedState = jsonb(f.row().requestedState);
    f.row().payload = jsonb(f.row().payload);
    f.row().diff = {
      provider_validation: "passed",
      items: [{ keyword: "WRONG DISPLAY", after_status: "REMOVED" }],
    };
    const view = await f.browser.approvalView(
      human,
      p.approval_url.split("#")[1]!,
    );
    expect(view).toMatchObject({
      items: [
        {
          keyword: "test 101",
          before_status: "ENABLED",
          after_status: "PAUSED",
        },
      ],
    });
    expect(JSON.stringify(view)).not.toContain("WRONG DISPLAY");
    await f.approve(p);
    const result = await f.previews.commit(principal, p.preview_token);
    expect(result).toMatchObject({
      status: "VERIFIED",
      items: [{ actual_status: "PAUSED" }],
    });
    expect(f.writes()).toBe(1);
  });
  it("D: neither unauthenticated commit nor client confirm can replace browser approval", async () => {
    const f = fixture(),
      p = await f.preview();
    await expect(
      f.previews.commit(principal, p.preview_token),
    ).rejects.toMatchObject({ code: "preview_not_confirmed" });
    await expect(
      f.previews.confirm(principal, p.preview_token),
    ).rejects.toMatchObject({ code: "preview_not_confirmed" });
    expect(f.writes()).toBe(0);
    expect(f.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          result: "rejected",
          googleErrorCode: "preview_not_confirmed",
        }),
      }),
    );
  });
  it("E: expiry is rechecked at commit and browser approval", async () => {
    const f = fixture(),
      p = await f.preview();
    await f.approve(p);
    f.row().expiresAt = new Date(0);
    await expect(
      f.previews.commit(principal, p.preview_token),
    ).rejects.toMatchObject({ code: "preview_expired" });
    await expect(
      f.browser.approvalView(human, p.approval_url.split("#")[1]!),
    ).rejects.toMatchObject({ code: "preview_expired" });
    expect(f.writes()).toBe(0);
  });
  it("F/O: external snapshot change rejects before mutation with Russian stale code", async () => {
    const f = fixture(),
      p = await f.preview();
    await f.approve(p);
    f.stale();
    await expect(
      f.previews.commit(principal, p.preview_token),
    ).rejects.toMatchObject({
      code: "google_preview_stale",
      publicMessage:
        "Объект изменился после создания preview. Создайте новый preview.",
    });
    expect(f.writes()).toBe(0);
  });
  it("G: empty/nonmatching allowlist denies preview before Google access", async () => {
    for (const allowed of ["", "5555555555"]) {
      const f = fixture("ENABLED", allowed);
      await expect(f.preview()).rejects.toMatchObject({
        writeCode: "google_account_not_allowlisted",
      });
      expect(f.requests).toHaveLength(0);
    }
  });
  it("G: independently rechecks account allowlist at commit", async () => {
    const f = fixture(),
      p = await f.preview();
    await f.approve(p);
    vi.stubEnv("GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST", "");
    const tightened = new McpPreviewService(
      f.database as never,
      f.audit as never,
      f.providers as never,
    );
    await expect(
      tightened.commit(principal, p.preview_token),
    ).rejects.toMatchObject({ writeCode: "google_account_not_allowlisted" });
    expect(f.writes()).toBe(0);
  });
  it("H: 501 rejected without truncation or provider access", async () => {
    const f = fixture();
    await expect(
      f.preview(
        "PAUSED",
        Array.from({ length: 501 }, (_, i) => String(i + 1)),
      ),
    ).rejects.toMatchObject({
      writeCode: "google_batch_limit_exceeded",
      message: expect.stringContaining("Разделите batch"),
    });
    expect(f.requests).toHaveLength(0);
    expect(GOOGLE_MUTATION_BATCH_LIMIT).toBe(500);
  });
  it("I/J/K: partial failure preserves verified successes, original Google code and Russian message", async () => {
    const f = fixture(),
      p = await f.preview("PAUSED", ["101", "102"]);
    await f.approve(p);
    f.setFail(1);
    const result = await f.previews.commit(principal, p.preview_token);
    expect(result).toMatchObject({
      status: "PARTIAL_FAILURE",
      partial_failure: true,
      items: [
        { criterion_id: "101", success: true, actual_status: "PAUSED" },
        {
          criterion_id: "102",
          success: false,
          actual_status: "ENABLED",
          google_error: {
            google_error_code: "USER_PERMISSION_DENIED",
            message: expect.stringContaining("нет права"),
          },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("sensitive");
    await expect(
      f.previews.commit(principal, p.preview_token),
    ).rejects.toMatchObject({ code: "preview_already_consumed" });
    expect(f.writes()).toBe(1);
  });
  it("a removed failed row does not erase reread success of another row", async () => {
    const f = fixture(),
      p = await f.preview("PAUSED", ["101", "102"]);
    await f.approve(p);
    f.setFail(1);
    f.dropFailedRow();
    await expect(
      f.previews.commit(principal, p.preview_token),
    ).resolves.toMatchObject({
      status: "PARTIAL_FAILURE",
      items: [
        { criterion_id: "101", success: true },
        { criterion_id: "102", success: false, actual_status: null },
      ],
    });
  });
  it("Google validation failure is not a committable preview", async () => {
    const f = fixture();
    f.setValidateFail();
    const p = await f.preview();
    expect(p).toMatchObject({
      status: "validation_failed",
      provider_validation: "failed",
      items: [{ google_validation: { success: false } }],
    });
    expect(p.preview_token).toBeUndefined();
    expect(f.database.client.mcpPreview.create).not.toHaveBeenCalled();
    expect(f.writes()).toBe(0);
  });
  it("no-op rows are visible and excluded from mutate", async () => {
    const f = fixture();
    f.states.get("102")!.adGroupCriterion.status = "PAUSED";
    const p = await f.preview("PAUSED", ["101", "102"]);
    expect(p.items[1]!.warnings).toEqual(["no_op: статус уже установлен"]);
    await f.approve(p);
    await f.previews.commit(principal, p.preview_token);
    expect(
      f.requests.filter((x) => x.url.endsWith(":mutate"))[1]!.body
        .operations as unknown[],
    ).toHaveLength(1);
  });
  it("all no-op does not manufacture a validated preview", async () => {
    const f = fixture("PAUSED");
    await expect(f.preview()).rejects.toMatchObject({
      code: "preview_no_change",
    });
    expect(f.requests.some((x) => x.url.endsWith(":mutate"))).toBe(false);
  });
  it("rejects REMOVED, identity mismatch, duplicate IDs and extra fields", async () => {
    const f = fixture();
    for (const args of [
      { status: "REMOVED", items: [identity("101")] },
      {
        status: "PAUSED",
        items: [
          { ...identity("101"), resource_name: identity("102").resource_name },
        ],
      },
      { status: "PAUSED", items: [identity("101"), identity("101")] },
      { status: "PAUSED", items: [{ ...identity("101"), budget: 1 }] },
    ])
      await expect(
        f.mcp.call(principal, "update_entity_status_preview", {
          provider: "GOOGLE_ADS",
          account_id: customer,
          entity_type: "keyword",
          ...args,
        }),
      ).rejects.toThrow();
    expect(f.writes()).toBe(0);
  });
  it("blocks replacement commit fields and foreign key/browser identities", async () => {
    const f = fixture(),
      p = await f.preview();
    await expect(
      f.mcp.call(principal, "commit_preview", {
        preview_token: p.preview_token,
        status: "ENABLED",
      }),
    ).rejects.toThrow();
    await expect(
      f.previews.commit({ ...principal, tokenId: "other" }, p.preview_token),
    ).rejects.toMatchObject({ code: "preview_not_found" });
    await expect(
      f.browser.approvalView(
        { ...human, userId: "other" },
        p.approval_url.split("#")[1]!,
      ),
    ).rejects.toMatchObject({ code: "approval_not_found" });
    expect(f.writes()).toBe(0);
  });
  it("cancelled, revoked and CAS-lost previews cannot mutate", async () => {
    const f = fixture(),
      p = await f.preview();
    await f.browser.decideApproval(
      human,
      p.approval_url.split("#")[1]!,
      "cancel",
    );
    await expect(
      f.previews.commit(principal, p.preview_token),
    ).rejects.toMatchObject({ code: "preview_cancelled" });
    const g = fixture(),
      q = await g.preview();
    await g.approve(q);
    g.revoke();
    await expect(
      g.previews.commit(principal, q.preview_token),
    ).rejects.toMatchObject({ code: "confirmation_context_mismatch" });
    const h = fixture(),
      r = await h.preview();
    await h.approve(r);
    h.denyClaim();
    await expect(
      h.previews.commit(principal, r.preview_token),
    ).rejects.toMatchObject({ code: "preview_already_consumed" });
    expect(h.writes()).toBe(0);
  });
  it("HTTP acceptance alone never means verified success", async () => {
    const f = fixture(),
      p = await f.preview();
    await f.approve(p);
    f.failReread();
    await expect(
      f.previews.commit(principal, p.preview_token),
    ).resolves.toMatchObject({
      status: "UNCERTAIN_OUTCOME",
      items: [{ success: false, actual_status: null }],
    });
  });
  it("reread mismatch is a Russian row failure even when mutate reports success", async () => {
    const f = fixture(),
      p = await f.preview();
    await f.approve(p);
    f.providers.commitGoogleKeywordStatuses.mockResolvedValueOnce([
      { success: true, error: null },
    ]);
    await expect(
      f.previews.commit(principal, p.preview_token),
    ).resolves.toMatchObject({
      status: "NOT_VERIFIED",
      items: [
        {
          success: false,
          actual_status: "ENABLED",
          google_error: {
            google_error_code: "VERIFICATION_MISMATCH",
            message: expect.stringContaining("не подтвердило"),
          },
        },
      ],
    });
  });
  it("real Google HTTP error decoding preserves API access restriction code without provider messages", async () => {
    const f = fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: 403,
              status: "PERMISSION_DENIED",
              details: [
                {
                  "@type":
                    "type.googleapis.com/google.ads.googleads.v24.errors.GoogleAdsFailure",
                  errors: [
                    {
                      errorCode: {
                        authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED",
                      },
                      message: "Authorization=fixture-sensitive-do-not-echo",
                    },
                  ],
                },
              ],
            },
          },
          { status: 403 },
        ),
      ),
    );
    const error = await f.adapter
      .validateKeywordStatuses(f.context, [
        { ...identity("101"), status: "PAUSED" },
      ])
      .catch((error) => error);
    expect(error).toMatchObject({
      writeCode: "google_ads_mutation_failed",
      failures: [
        {
          google_error_code: "DEVELOPER_TOKEN_NOT_APPROVED",
          message: expect.stringContaining("Проверьте уровень доступа"),
        },
      ],
    });
    expect(JSON.stringify(error)).not.toContain(
      "fixture-sensitive-do-not-echo",
    );
    expect(f.writes()).toBe(0);
  });
  it("empty Google allowlist is read-only and a failed durable attempt audit prevents mutation", async () => {
    const closed = fixture("ENABLED", "");
    await expect(closed.preview()).rejects.toMatchObject({
      writeCode: "google_account_not_allowlisted",
    });
    expect(closed.requests).toHaveLength(0);
    const f = fixture(),
      p = await f.preview();
    await f.approve(p);
    f.audit.record.mockImplementation(async (input) => {
      if (
        (input as { eventType?: string }).eventType ===
        "mcp_google_keyword_status"
      )
        throw new Error("fixture audit unavailable");
    });
    await expect(
      f.previews.commit(principal, p.preview_token),
    ).rejects.toThrow();
    expect(f.writes()).toBe(0);
    expect(f.row().consumedAt).not.toBeNull();
  });
  it("new write gate defaults OFF and public tools stay read-only", () => {
    expect(loadConfig({ NODE_ENV: "test" }).providerGoogleAdsWriteEnabled).toBe(
      false,
    );
    expect(
      loadConfig({ NODE_ENV: "test" }).googleAdsWriteAccountAllowlist,
    ).toEqual([]);
    expect(googleAdsDefinition(true).write).toBe(false);
    expect(googleAdsDefinition(false, true).write).toBe(false);
    expect(googleAdsDefinition(true, true).write).toBe(true);
    const f = fixture();
    const names = publicTools(f.mcp.tools(), false).map((x) => x.name);
    expect(names).not.toContain("pause_entities_preview");
    expect(names).not.toContain("update_entity_status_preview");
    expect(names).not.toContain("commit_preview");
  });
  it("schemas and annotations are explicit and keep Google endpoint closed", () => {
    const f = fixture(),
      tools = f.mcp.tools();
    for (const name of [
      "pause_entities_preview",
      "update_entity_status_preview",
    ]) {
      const tool = tools.find((x) => x.name === name)!;
      expect(tool.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      });
      const google = (
        tool.inputSchema.oneOf as Array<Record<string, unknown>>
      )[0]!;
      expect(google.additionalProperties).toBe(false);
      expect(google.required).toEqual(
        expect.arrayContaining([
          "provider",
          "account_id",
          "entity_type",
          "items",
        ]),
      );
      expect(JSON.stringify(google)).toContain('"maxItems":500');
    }
    expect(
      tools.find((x) => x.name === "commit_preview")!.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
  });
  it("malformed/global partial errors fail closed instead of assigning false successes", () => {
    const result = googleMutationResults(
      {
        partialFailureError: {
          code: 3,
          details: [
            { errors: [{ errorCode: { requestError: "INVALID_ARGUMENT" } }] },
          ],
        },
      },
      [{ ...identity("101"), status: "PAUSED" }],
      true,
    );
    expect(result[0]!.success).toBe(false);
  });
});
