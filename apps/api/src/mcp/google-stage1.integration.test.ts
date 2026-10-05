import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@holymedia/config";
import { GoogleAdsAdapter } from "../providers/adapters/google.ads.js";
import {
  canonical,
  currencyMicros,
  parseStage1Intent,
  type Stage1Plan,
  type Stage1MutationResult,
} from "../providers/google-ads-stage1.js";
import { McpPreviewService } from "./mcp-preview.service.js";
import { McpService } from "./mcp.service.js";
import {
  GOOGLE_STAGE1_TOOLS,
  stage1ToolSchema,
} from "./mcp-google-stage1-schema.js";
import { publicTools } from "./mcp-public-tools.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const customer = "1234567890",
  prefix = `customers/${customer}`;
const principal = {
  kind: "service" as const,
  tokenId: "token-a",
  serviceIdentityId: "identity-a",
  workspaceId: "workspace-a",
  accountIds: ["account-a"],
  scopes: ["adforge:mcp:read", "adforge:mcp:write"],
};
const human = {
  kind: "human" as const,
  userId: "user-a",
  sessionId: "session-a",
};
const placement = { campaign_id: "1", ad_group_id: "10" };
const keyword = (id = "101") => ({ ...placement, criterion_id: id });
type MockRow = Record<string, unknown>;
function object(value: unknown): MockRow {
  return value && typeof value === "object" ? (value as MockRow) : {};
}
function fixture() {
  for (const [key, value] of Object.entries({
    NODE_ENV: "test",
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
    GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: customer,
    V2_PREVIEW_ONLY: "false",
    V2_CONFIRMED_WRITE_ENABLED: "true",
    HOLYMEDIA_PUBLIC_BASE_URL: "https://mcp.holymedia.kz",
  }))
    vi.stubEnv(key, value);
  const config = loadConfig({
    ...process.env,
    PROVIDER_GOOGLE_CLIENT_ID: "fixture-client",
    PROVIDER_GOOGLE_CLIENT_SECRET: "fixture-secret",
    PROVIDER_GOOGLE_REDIRECT_URI: "https://example.test/oauth",
  });
  const adapter = new GoogleAdsAdapter(config),
    context = {
      accountId: customer,
      loginCustomerId: "9999999999",
      credentials: {
        accessToken: "fixture-access",
        scopes: ["https://www.googleapis.com/auth/adwords"],
      },
    };
  const campaign = {
      id: "1",
      resourceName: `${prefix}/campaigns/1`,
      name: "TEST PPC",
      status: "PAUSED",
    },
    group = {
      id: "10",
      resourceName: `${prefix}/adGroups/10`,
      name: "TEST group",
      status: "ENABLED",
    };
  const resources = new Map<string, MockRow>();
  resources.set(campaign.resourceName, { campaign });
  resources.set(group.resourceName, { campaign, adGroup: group });
  resources.set(`${prefix}/customers/${customer}`, {
    customer: { id: customer, resourceName: prefix, currencyCode: "KZT" },
  });
  for (let i = 101; i <= 120; i++)
    resources.set(`${prefix}/adGroupCriteria/10~${i}`, {
      campaign,
      adGroup: group,
      adGroupCriterion: {
        resourceName: `${prefix}/adGroupCriteria/10~${i}`,
        criterionId: String(i),
        type: "KEYWORD",
        keyword: { text: `тест ${i}`, matchType: "EXACT" },
        negative: false,
        status: "ENABLED",
        finalUrls: ["https://example.test/old"],
        cpcBidMicros: "150000000",
      },
    });
  let sequence = 1000,
    writes = 0,
    failIndex: number | null = null,
    validationFailure = false,
    activeToken = true,
    outage = false;
  const requests: { url: string; body: MockRow; headers: MockRow }[] = [];
  const entityKeys: Record<string, string> = {
    adGroupCriteria: "adGroupCriterion",
    campaignCriteria: "campaignCriterion",
    sharedSets: "sharedSet",
    sharedCriteria: "sharedCriterion",
    campaignSharedSets: "campaignSharedSet",
  };
  const tables: Record<string, string> = {
    ad_group_criterion: "adGroupCriterion",
    campaign_criterion: "campaignCriterion",
    shared_set: "sharedSet",
    shared_criterion: "sharedCriterion",
    campaign_shared_set: "campaignSharedSet",
    campaign: "campaign",
    ad_group: "adGroup",
    customer: "customer",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as MockRow;
      requests.push({ url, body, headers: init?.headers as MockRow });
      if (url.endsWith("/googleAds:searchStream")) {
        if (outage && writes) throw new Error("Fixture outage");
        const query = String(body.query),
          table = query.match(/ FROM (\w+)/)?.[1] ?? "unknown",
          key = tables[table]!;
        let rows = [...resources.values()].filter((row) => row[key]);
        // A GAQL FROM campaign/ad_group returns one resource, not one row per child.
        if (table === "campaign")
          rows = rows.filter(
            (row) =>
              !row.adGroup && !row.campaignCriterion && !row.campaignSharedSet,
          );
        if (table === "ad_group")
          rows = rows.filter((row) => !row.adGroupCriterion);
        const exactResources = [
          ...query.matchAll(/(?:resource_name) = '([^']+)'/g),
        ].map((x) => x[1]);
        const inResources = query.includes("resource_name IN")
          ? [...query.matchAll(/'([^']+)'/g)].map((x) => x[1])
          : [];
        if (exactResources.length)
          rows = rows.filter((row) =>
            exactResources.includes(String(object(row[key]).resourceName)),
          );
        if (inResources.length)
          rows = rows.filter((row) =>
            inResources.includes(String(object(row[key]).resourceName)),
          );
        for (const [field, objKey] of [
          ["campaign", "campaign"],
          ["ad_group", "adGroup"],
          ["shared_set", "sharedSet"],
        ]) {
          const id = query.match(new RegExp(`${field}\\.id = (\\d+)`))?.[1];
          if (id)
            rows = rows.filter((row) => String(object(row[objKey!]).id) === id);
        }
        if (/\.type = KEYWORD/.test(query))
          rows = rows.filter((row) => object(row[key]).type === "KEYWORD");
        const negative = query.match(/\.negative = (TRUE|FALSE)/)?.[1];
        if (negative)
          rows = rows.filter(
            (row) =>
              Boolean(object(row[key]).negative) === (negative === "TRUE"),
          );
        const status = query.match(/\.status = (ENABLED|PAUSED|REMOVED)/)?.[1];
        if (status)
          rows = rows.filter((row) => object(row[key]).status === status);
        const sharedSet = query.match(/\.shared_set = '([^']+)'/)?.[1];
        if (sharedSet)
          rows = rows.filter((row) => object(row[key]).sharedSet === sharedSet);
        return Response.json([{ results: structuredClone(rows) }]);
      }
      const kind = url.match(/\/(\w+):mutate$/)?.[1] ?? "unknown",
        key = entityKeys[kind];
      if (!key) throw new Error("Unexpected fixture URL");
      const operations = body.operations as MockRow[],
        validation = body.validateOnly === true,
        failed = validation ? (validationFailure ? 0 : null) : failIndex;
      if (!validation) writes++;
      const results = operations.map((operation, index) => {
        if (index === failed) return {};
        let resource = String(
          operation.remove ?? object(operation.update).resourceName ?? "",
        );
        if (operation.create) {
          const create = structuredClone(object(operation.create)),
            id = String(++sequence);
          const parent = String(
            create.adGroup ?? create.sharedSet ?? create.campaign ?? "",
          )
            .split("/")
            .pop();
          resource = `${prefix}/${kind}/${["adGroupCriteria", "campaignCriteria", "sharedCriteria"].includes(kind) ? `${parent}~${id}` : kind === "campaignSharedSets" ? `${String(create.campaign).split("/").pop()}~${String(create.sharedSet).split("/").pop()}` : id}`;
          if (!validation) {
            const row: MockRow = {
              [key]: {
                ...create,
                resourceName: resource,
                ...(kind === "sharedSets"
                  ? { id }
                  : kind === "adGroupCriteria" ||
                      kind === "sharedCriteria" ||
                      kind === "campaignCriteria"
                    ? { criterionId: id, type: "KEYWORD" }
                    : {}),
                ...(kind === "sharedSets" ||
                kind === "campaignSharedSets" ||
                kind === "adGroupCriteria" ||
                kind === "campaignCriteria"
                  ? { status: create.status ?? "ENABLED" }
                  : {}),
              },
            };
            if (create.campaign || create.adGroup) row.campaign = campaign;
            if (create.adGroup) row.adGroup = group;
            resources.set(resource, row);
          }
        } else if (!validation && operation.update)
          Object.assign(
            object(resources.get(resource)?.[key]),
            operation.update,
          );
        else if (!validation && operation.remove) {
          if (kind === "sharedCriteria") resources.delete(resource);
          else object(resources.get(resource)?.[key]).status = "REMOVED";
        }
        return { resourceName: resource };
      });
      return Response.json({
        ...(validation ? {} : { results }),
        ...(failed !== null
          ? {
              partialFailureError: {
                code: 3,
                details: [
                  {
                    errors: [
                      {
                        errorCode: { criterionError: "RESOURCE_NOT_FOUND" },
                        message: "Bearer secret fixture ignored",
                        location: {
                          fieldPathElements: [
                            { fieldName: "operations", index: failed },
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
    }),
  );
  const account = {
    id: "account-a",
    workspaceId: principal.workspaceId,
    provider: "GOOGLE_ADS",
    externalAccountId: customer,
    connectionId: "connection-a",
    displayName: "TEST Ads",
  };
  const previewsRows: MockRow[] = [],
    events: MockRow[] = [];
  function whereMatch(row: MockRow, where: MockRow): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value instanceof Date)
        return row[key] instanceof Date && Number(row[key]) === Number(value);
      if (key === "AND")
        return (value as MockRow[]).every((rule) => whereMatch(row, rule));
      if (key === "OR")
        return (value as MockRow[]).some((rule) => whereMatch(row, rule));
      if (key === "metadata") {
        const condition = object(value);
        const actual = (condition.path as string[]).reduce(
          (next, k) => object(next)[k],
          row.metadata as unknown,
        );
        return actual === condition.equals;
      }
      if (key === "serviceToken")
        return (
          activeToken &&
          (!object(object(value).serviceIdentity).createdById ||
            object(object(value).serviceIdentity).createdById === human.userId)
        );
      if (key === "account")
        return whereMatch(
          account,
          Object.fromEntries(
            Object.entries(object(value)).filter(
              ([k]) => !["enabled", "connection"].includes(k),
            ),
          ),
        );
      const condition = object(value);
      if ("in" in condition)
        return (condition.in as unknown[]).includes(row[key]);
      if ("gt" in condition)
        return row[key] instanceof Date && row[key] > (condition.gt as Date);
      if ("lt" in condition)
        return row[key] instanceof Date
          ? row[key] < (condition.lt as Date)
          : String(row[key]) < String(condition.lt);
      if ("gte" in condition && (row[key] as Date) < (condition.gte as Date))
        return false;
      if ("lte" in condition && (row[key] as Date) > (condition.lte as Date))
        return false;
      if ("gte" in condition || "lte" in condition) return true;
      if ("not" in condition)
        return condition.not === null
          ? row[key] !== null && row[key] !== undefined
          : row[key] !== null && row[key] !== undefined;
      if ("equals" in condition)
        return canonical(row[key]) === canonical(condition.equals);
      return row[key] === value;
    });
  }
  const audit = {
    record: vi.fn(async (input: MockRow) => {
      events.push({
        ...structuredClone(input),
        id: `event-${events.length}`,
        createdAt: new Date(),
      });
    }),
  };
  const db = {
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
      auditEvent: {
        findFirst: vi.fn(
          async ({ where }: { where: MockRow }) =>
            events.find((row) => whereMatch(row, where)) ?? null,
        ),
      },
      mcpPreview: {
        create: vi.fn(async ({ data }: { data: MockRow }) => {
          const row = {
            ...structuredClone(data),
            id: `preview-${previewsRows.length}`,
            confirmedAt: null,
            consumedAt: null,
            cancelledAt: null,
            createdAt: new Date(),
          };
          previewsRows.push(row);
          return structuredClone(row);
        }),
        findFirst: vi.fn(async ({ where }: { where: MockRow }) => {
          const row = previewsRows.find((row) => whereMatch(row, where));
          return row
            ? {
                ...structuredClone(row),
                serviceToken: {
                  serviceIdentityId: principal.serviceIdentityId,
                },
              }
            : null;
        }),
        findMany: vi.fn(
          async ({ where, take }: { where: MockRow; take: number }) =>
            previewsRows
              .filter((row) => whereMatch(row, where))
              .sort(
                (a, b) =>
                  Number(b.commitAttemptedAt) - Number(a.commitAttemptedAt) ||
                  String(b.id).localeCompare(String(a.id)),
              )
              .slice(0, take)
              .map((row) => ({
                ...structuredClone(row),
                serviceToken: {
                  serviceIdentityId: principal.serviceIdentityId,
                },
              })),
        ),
        updateMany: vi.fn(
          async ({ where, data }: { where: MockRow; data: MockRow }) => {
            const row = previewsRows.find((row) => whereMatch(row, where));
            if (!row || !activeToken) return { count: 0 };
            Object.assign(row, structuredClone(data));
            return { count: 1 };
          },
        ),
        update: vi.fn(
          async ({ where, data }: { where: MockRow; data: MockRow }) => {
            const row = previewsRows.find((x) => x.id === where.id)!;
            Object.assign(row, structuredClone(data));
            return row;
          },
        ),
      },
    },
  };
  const providers = {
    googleStage1: vi.fn(
      async (
        _w: string,
        _c: string,
        _a: string,
        action: string,
        input: unknown,
        results?: Stage1MutationResult[],
      ) =>
        action === "build"
          ? adapter.buildStage1(context, input)
          : action === "read"
            ? adapter.readStage1(context, input as Stage1Plan)
            : action === "verify"
              ? adapter.verifyStage1(context, input as Stage1Plan, results!)
              : adapter.mutateStage1(
                  context,
                  input as Stage1Plan,
                  action === "validate",
                ),
    ),
    readGoogleKeywordStates: vi.fn(
      async (
        _w: string,
        _c: string,
        _a: string,
        items: Parameters<GoogleAdsAdapter["readKeywordStates"]>[1],
      ) => adapter.readKeywordStates(context, items),
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
    db as never,
    audit as never,
    providers as never,
  );
  const mcp = new McpService(
    db as never,
    providers as never,
    {} as never,
    previews,
    {} as never,
    {} as never,
  );
  const call = (name: string, args: MockRow) =>
    mcp.call(principal, name, {
      provider: "GOOGLE_ADS",
      account_id: customer,
      ...args,
    }) as Promise<MockRow>;
  const approve = async (preview: MockRow) =>
    previews.decideGoogleApproval(
      human,
      String(preview.approval_url).split("#")[1]!,
      "approve",
    );
  const commit = async (preview: MockRow) => {
    await approve(preview);
    return mcp.call(principal, "commit_preview", {
      preview_token: preview.preview_token,
    }) as Promise<MockRow>;
  };
  return {
    adapter,
    context,
    resources,
    requests,
    call,
    approve,
    commit,
    previews,
    previewsRows,
    events,
    db,
    audit,
    mcp,
    writes: () => writes,
    fail: (index: number | null) => {
      failIndex = index;
    },
    validationFail: () => {
      validationFailure = true;
    },
    revoke: () => {
      activeToken = false;
    },
    outage: () => {
      outage = true;
    },
  };
}
describe("Google Stage 1 existing controlled-write lifecycle (mock HTTP only)", () => {
  it("A: pause preview validates without mutation and shows before/after", async () => {
    const f = fixture(),
      p = await f.call("pause_entities_preview", {
        entity_type: "keyword",
        items: [keyword()],
      });
    expect(f.writes()).toBe(0);
    expect((p.items as MockRow[])[0]).toMatchObject({
      before_status: "ENABLED",
      after_status: "PAUSED",
    });
    expect(
      f.requests
        .filter((x) => x.url.endsWith(":mutate"))
        .every((x) => x.body.validateOnly === true),
    ).toBe(true);
  });
  it("B: pause/resume produces two stable journal entries; status rollback is a new preview", async () => {
    const f = fixture(),
      pause = await f.call("pause_entities_preview", {
        entity_type: "keyword",
        items: [keyword()],
      });
    const first = await f.commit(pause);
    const inverse = (await f.mcp.call(principal, "preview_rollback_commit", {
      commit_id: first.commit_id,
    })) as MockRow;
    expect(f.writes()).toBe(1);
    expect(inverse.preview_token).not.toBe(pause.preview_token);
    await f.commit(inverse);
    const journal = await f.call("list_change_journal", {});
    expect(journal.items as MockRow[]).toHaveLength(2);
    expect(
      new Set((journal.items as MockRow[]).map((x) => x.commit_id)).size,
    ).toBe(2);
    expect(
      object(
        f.resources.get(`${prefix}/adGroupCriteria/10~101`)?.adGroupCriterion,
      ).status,
    ).toBe("ENABLED");
  });
  it("C: 20 validated keyword commits retain 19 successes and original invalid-resource failure", async () => {
    const f = fixture(),
      p = await f.call("pause_entities_preview", {
        entity_type: "keyword",
        items: Array.from({ length: 20 }, (_, i) => keyword(String(101 + i))),
      });
    f.fail(7);
    const result = await f.commit(p),
      rows = result.items as MockRow[];
    expect(rows.filter((x) => x.success)).toHaveLength(19);
    expect(rows[7]).toMatchObject({
      success: false,
      google_error: { google_error_code: "RESOURCE_NOT_FOUND" },
    });
    expect(
      f.requests.find((x) => x.body.validateOnly === false)?.body
        .partialFailure,
    ).toBe(true);
    expect(String(object(rows[7]!.google_error).message)).toMatch(/[А-Яа-я]/);
    expect(JSON.stringify(result)).not.toContain("Bearer");
  });
  it("keyword create converts currency, detects negative conflict and rereads assigned resource", async () => {
    const f = fixture();
    f.resources.set(`${prefix}/campaignCriteria/1~900`, {
      campaign: object(f.resources.get(`${prefix}/campaigns/1`)?.campaign),
      campaignCriterion: {
        resourceName: `${prefix}/campaignCriteria/1~900`,
        criterionId: "900",
        type: "KEYWORD",
        negative: true,
        status: "ENABLED",
        keyword: { text: "ТЕСТ", matchType: "BROAD" },
      },
    });
    const p = await f.call("create_keyword_from_brief", {
      entity_type: "keyword",
      items: [
        {
          ...placement,
          text: "  тест   новый ",
          match_type: "PHRASE",
          cpc_bid: { amount: "150", currency: "KZT" },
          final_url: "https://example.test/new",
        },
      ],
    });
    expect(f.writes()).toBe(0);
    expect((p.items as MockRow[])[0]!.warnings).not.toEqual([]);
    const result = await f.commit(p);
    expect(result.status).toBe("VERIFIED");
    expect(JSON.stringify(result)).toContain("150000000");
    expect(f.requests.at(-1)!.url).toContain("searchStream");
  });
  it("D: search term to campaign negative uses conflict logic and validates/commits/rereads", async () => {
    const f = fixture(),
      p = await f.call("google_ads_search_term_to_negative_preview", {
        target_level: "campaign",
        items: [
          { campaign_id: "1", search_term: "ТЕСТ 101", match_type: "EXACT" },
        ],
      });
    expect((p.items as MockRow[])[0]!.conflicts).toMatchObject([
      { affected_keyword: "тест 101", reason_code: "EXACT_NORMALIZED_TEXT" },
    ]);
    const result = await f.commit(p);
    expect(result.status).toBe("VERIFIED");
    expect(
      [...f.resources.values()].some(
        (x) => object(x.campaignCriterion).negative === true,
      ),
    ).toBe(true);
  });
  it("E: shared list create, 3 members, attach/detach each use separate verified commit", async () => {
    const f = fixture(),
      created = await f.commit(
        await f.call("google_ads_create_shared_negative_list_preview", {
          items: [{ shared_list_name: "TEST negatives" }],
        }),
      );
    expect(created.status).toBe("VERIFIED");
    const shared_set_id = String(
      [...f.resources.values()].find((x) => x.sharedSet)?.sharedSet &&
        object([...f.resources.values()].find((x) => x.sharedSet)!.sharedSet)
          .id,
    );
    const members = await f.commit(
      await f.call("google_ads_shared_negative_members_preview", {
        operation: "add",
        items: ["one", "two", "three"].map((text) => ({
          shared_set_id,
          text,
          match_type: "EXACT",
        })),
      }),
    );
    expect(members.status).toBe("VERIFIED");
    expect(
      [...f.resources.values()].filter((x) => x.sharedCriterion),
    ).toHaveLength(3);
    expect(
      (
        await f.commit(
          await f.call("google_ads_shared_negative_campaigns_preview", {
            operation: "attach",
            items: [{ shared_set_id, campaign_id: "1" }],
          }),
        )
      ).status,
    ).toBe("VERIFIED");
    expect(
      (
        await f.commit(
          await f.call("google_ads_shared_negative_campaigns_preview", {
            operation: "detach",
            items: [{ shared_set_id, campaign_id: "1" }],
          }),
        )
      ).status,
    ).toBe("VERIFIED");
    const member = object(
      [...f.resources.values()].find((x) => x.sharedCriterion)!.sharedCriterion,
    );
    expect(
      (
        await f.commit(
          await f.call("google_ads_shared_negative_members_preview", {
            operation: "remove",
            items: [{ shared_set_id, criterion_id: member.criterionId }],
          }),
        )
      ).status,
    ).toBe("VERIFIED");
    expect(
      [...f.resources.values()].filter((x) => x.sharedCriterion),
    ).toHaveLength(2);
  });
  it("F: match type replacement previews two effects and commits old paused/new enabled", async () => {
    const f = fixture(),
      p = await f.call("google_ads_change_keyword_match_type_preview", {
        items: [{ ...keyword(), match_type: "PHRASE" }],
      });
    expect(p.operation_count).toBe(2);
    expect((p.items as MockRow[])[0]!.after).toHaveProperty(
      "old_status",
      "PAUSED",
    );
    const result = await f.commit(p);
    expect(result.status).toBe("VERIFIED");
    expect(
      object(
        f.resources.get(`${prefix}/adGroupCriteria/10~101`)?.adGroupCriterion,
      ).status,
    ).toBe("PAUSED");
    expect(
      [...f.resources.values()].some(
        (x) =>
          object(x.adGroupCriterion).status === "ENABLED" &&
          object(object(x.adGroupCriterion).keyword).matchType === "PHRASE",
      ),
    ).toBe(true);
  });
  it("match type create-only failure is DEGRADED with safe remediation, never full success", async () => {
    const f = fixture(),
      p = await f.call("google_ads_change_keyword_match_type_preview", {
        items: [{ ...keyword(), match_type: "PHRASE" }],
      });
    f.fail(1);
    const result = await f.commit(p);
    expect(result.status).toBe("PARTIAL_FAILURE");
    expect((result.items as MockRow[])[0]).toMatchObject({
      success: false,
      result: "DEGRADED",
      remediation: expect.stringContaining("Не повторяйте commit"),
    });
  });
  it("final URL set/reset and rollback restore recorded URL without caller-supplied values", async () => {
    const f = fixture(),
      result = await f.commit(
        await f.call("preview_update_object", {
          entity_type: "keyword",
          field: "final_url",
          items: [{ ...keyword(), final_url: null }],
        }),
      );
    expect(result.status).toBe("VERIFIED");
    const inverse = (await f.mcp.call(principal, "preview_rollback_commit", {
      commit_id: result.commit_id,
    })) as MockRow;
    await f.commit(inverse);
    expect(
      object(
        f.resources.get(`${prefix}/adGroupCriteria/10~101`)?.adGroupCriterion,
      ).finalUrls,
    ).toEqual(["https://example.test/old"]);
    await expect(
      f.mcp.call(principal, "preview_rollback_commit", {
        commit_id: result.commit_id,
        final_url: "https://evil.test",
      }),
    ).rejects.toThrow();
  });
  it("M: permanent remove requires browser approval, warns irreversible and cannot rollback", async () => {
    const f = fixture(),
      p = await f.call("preview_delete_or_archive_object", {
        entity_type: "keyword",
        items: [keyword()],
      });
    expect((p.items as MockRow[])[0]!.warnings).toEqual([
      expect.stringContaining("нельзя восстановить"),
    ]);
    await expect(
      f.previews.commit(principal, String(p.preview_token)),
    ).rejects.toMatchObject({ code: "preview_not_confirmed" });
    expect(f.writes()).toBe(0);
    const result = await f.commit(p);
    expect(result.status).toBe("VERIFIED");
    await expect(
      f.previews.previewRollbackCommit(principal, String(result.commit_id)),
    ).rejects.toMatchObject({ writeCode: "rollback_unsupported" });
  });
  it("O: changed snapshot rejects commit and URL rollback; no provider mutation", async () => {
    const f = fixture(),
      p = await f.call("preview_update_object", {
        entity_type: "keyword",
        field: "final_url",
        items: [{ ...keyword(), final_url: "https://example.test/new" }],
      });
    await f.approve(p);
    object(
      f.resources.get(`${prefix}/adGroupCriteria/10~101`)?.adGroupCriterion,
    ).status = "PAUSED";
    await expect(
      f.previews.commit(principal, String(p.preview_token)),
    ).rejects.toMatchObject({ code: "google_preview_stale" });
    expect(f.writes()).toBe(0);
  });
  it("P: allowlist/gate/scope reject Stage1 before any provider access", async () => {
    const f = fixture();
    vi.stubEnv("GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST", "");
    const service = new McpPreviewService(
      f.db as never,
      f.audit as never,
      {} as never,
    );
    await expect(
      service.createGoogleStage1(principal, customer, {
        action: "keyword_add",
        items: [{ ...placement, text: "new", match_type: "EXACT" }],
      }),
    ).rejects.toMatchObject({ writeCode: "google_account_not_allowlisted" });
    expect(f.requests).toHaveLength(0);
    vi.stubEnv("PROVIDER_GOOGLE_ADS_WRITE_ENABLED", "false");
    await expect(
      new McpPreviewService(
        f.db as never,
        f.audit as never,
        {} as never,
      ).createGoogleStage1(principal, customer, {
        action: "keyword_remove",
        items: [keyword()],
      }),
    ).rejects.toMatchObject({ writeCode: "google_write_disabled" });
    await expect(
      f.previews.createGoogleStage1(
        { ...principal, scopes: ["adforge:mcp:read"] },
        customer,
        { action: "keyword_remove", items: [keyword()] },
      ),
    ).rejects.toThrow();
  });
  it("expired/replaced/revoked preview cannot commit", async () => {
    const f = fixture(),
      p = await f.call("preview_delete_or_archive_object", {
        entity_type: "keyword",
        items: [keyword()],
      });
    await f.approve(p);
    f.previewsRows[0]!.expiresAt = new Date(0);
    await expect(
      f.previews.commit(principal, String(p.preview_token)),
    ).rejects.toMatchObject({ code: "preview_expired" });
    f.previewsRows[0]!.expiresAt = new Date(Date.now() + 100000);
    await expect(
      f.mcp.call(principal, "commit_preview", {
        preview_token: p.preview_token,
        items: [],
      }),
    ).rejects.toThrow();
    object(f.previewsRows[0]!.requestedState).account_id = "0000000000";
    await expect(
      f.previews.commit(principal, String(p.preview_token)),
    ).rejects.toMatchObject({ code: "confirmation_context_mismatch" });
    expect(f.writes()).toBe(0);
  });
  it("Google validation failure yields no preview; reread outage never reports success", async () => {
    const f = fixture();
    f.validationFail();
    const p = await f.call("create_keyword_from_brief", {
      entity_type: "keyword",
      items: [{ ...placement, text: "new", match_type: "EXACT" }],
    });
    expect(p.status).toBe("validation_failed");
    expect(p.preview_token).toBeUndefined();
    expect(f.previewsRows).toHaveLength(0);
    const second = fixture(),
      pending = await second.call("preview_update_object", {
        entity_type: "keyword",
        field: "final_url",
        items: [{ ...keyword(), final_url: null }],
      });
    second.outage();
    expect((await second.commit(pending)).status).toBe("NOT_VERIFIED");
  });
  it("campaign/ad group negatives add/remove and search-term keyword reuse", async () => {
    const f = fixture();
    for (const level of ["campaign", "ad_group"]) {
      const added = await f.commit(
        await f.call("google_ads_negatives_preview", {
          level,
          operation: "add",
          items: [
            {
              campaign_id: "1",
              ...(level === "ad_group" ? { ad_group_id: "10" } : {}),
              text: "blocked",
              match_type: "PHRASE",
            },
          ],
        }),
      );
      expect(added.status).toBe("VERIFIED");
      const row = [...f.resources.values()].find((x) =>
        level === "campaign"
          ? object(x.campaignCriterion).negative === true
          : object(x.adGroupCriterion).negative === true,
      )!;
      const criterion_id = object(
        row[level === "campaign" ? "campaignCriterion" : "adGroupCriterion"],
      ).criterionId;
      expect(
        (
          await f.commit(
            await f.call("google_ads_negatives_preview", {
              level,
              operation: "remove",
              items: [
                {
                  campaign_id: "1",
                  ...(level === "ad_group" ? { ad_group_id: "10" } : {}),
                  criterion_id,
                },
              ],
            }),
          )
        ).status,
      ).toBe("VERIFIED");
    }
    expect(
      (
        await f.commit(
          await f.call("google_ads_search_term_to_keyword_preview", {
            items: [
              { ...placement, search_term: "new term", match_type: "BROAD" },
            ],
          }),
        )
      ).status,
    ).toBe("VERIFIED");
  });
  it("500-operation cap rejects composite 251 before provider; duplicates, URLs and currency rejected", async () => {
    const f = fixture();
    await expect(
      f.call("google_ads_change_keyword_match_type_preview", {
        items: Array.from({ length: 251 }, (_, i) => ({
          ...keyword(String(i + 1)),
          match_type: "PHRASE",
        })),
      }),
    ).rejects.toMatchObject({ writeCode: "google_batch_limit_exceeded" });
    expect(f.requests).toHaveLength(0);
    expect(
      parseStage1Intent({
        action: "keyword_match",
        items: Array.from({ length: 250 }, (_, i) => ({
          ...keyword(String(i + 1)),
          match_type: "PHRASE",
        })),
      }).items,
    ).toHaveLength(250);
    expect(() => currencyMicros("0.5", "USD", "USD")).not.toThrow();
    expect(currencyMicros("150", "KZT", "KZT")).toBe("150000000");
    expect(() => currencyMicros("1", "USD", "KZT")).toThrow();
    await expect(
      f.call("preview_update_object", {
        entity_type: "keyword",
        field: "final_url",
        items: [{ ...keyword(), final_url: "javascript:alert(1)" }],
      }),
    ).rejects.toThrow();
    await expect(
      f.call("create_keyword_from_brief", {
        entity_type: "keyword",
        items: [{ ...placement, text: "ТЕСТ 101", match_type: "EXACT" }],
      }),
    ).rejects.toMatchObject({ writeCode: "google_keyword_duplicate" });
  });
  it("partial URL rollback excludes failed rows and restores the full recorded URL array", async () => {
    const f = fixture();
    object(
      f.resources.get(`${prefix}/adGroupCriteria/10~101`)?.adGroupCriterion,
    ).finalUrls = ["https://example.test/old", "https://example.test/mirror"];
    const p = await f.call("preview_update_object", {
      entity_type: "keyword",
      field: "final_url",
      items: [keyword("101"), keyword("102")].map((row) => ({
        ...row,
        final_url: null,
      })),
    });
    f.fail(1);
    const result = await f.commit(p);
    expect(result.status).toBe("PARTIAL_FAILURE");
    f.fail(null);
    const inverse = (await f.previews.previewRollbackCommit(
      principal,
      String(result.commit_id),
    )) as MockRow;
    expect(inverse.operation_count).toBe(1);
    await f.commit(inverse);
    expect(
      object(
        f.resources.get(`${prefix}/adGroupCriteria/10~101`)?.adGroupCriterion,
      ).finalUrls,
    ).toEqual(["https://example.test/old", "https://example.test/mirror"]);
    expect(
      object(
        f.resources.get(`${prefix}/adGroupCriteria/10~102`)?.adGroupCriterion,
      ).finalUrls,
    ).toEqual(["https://example.test/old"]);
  });
  it("journal is read-scope/account bounded and paginates same-time commits without duplication", async () => {
    const f = fixture();
    for (const id of ["101", "102", "103"])
      await f.commit(
        await f.call("pause_entities_preview", {
          entity_type: "keyword",
          items: [keyword(id)],
        }),
      );
    for (const row of f.previewsRows)
      row.commitAttemptedAt = new Date("2026-10-06T00:00:00Z");
    const readPrincipal = { ...principal, scopes: ["adforge:mcp:read"] };
    const first = (await f.mcp.call(readPrincipal, "list_change_journal", {
      provider: "GOOGLE_ADS",
      account_id: customer,
      limit: 1,
    })) as MockRow;
    const second = (await f.mcp.call(readPrincipal, "list_change_journal", {
      provider: "GOOGLE_ADS",
      account_id: customer,
      limit: 1,
      cursor: first.next_cursor,
    })) as MockRow;
    expect((first.items as MockRow[])[0]!.commit_id).not.toBe(
      (second.items as MockRow[])[0]!.commit_id,
    );
    expect(
      f.db.client.mcpPreview.findMany.mock.calls.at(-1)?.[0].where,
    ).toMatchObject({
      workspaceId: principal.workspaceId,
      accountId: "account-a",
      provider: "GOOGLE_ADS",
    });
    await expect(
      f.mcp.call(readPrincipal, "list_change_journal", {
        provider: "GOOGLE_ADS",
        account_id: customer,
        from: "bad",
      }),
    ).rejects.toThrow();
  });
  it("rollback refuses changed post-write state; claim revocation and audit outage prevent mutation", async () => {
    const f = fixture(),
      result = await f.commit(
        await f.call("preview_update_object", {
          entity_type: "keyword",
          field: "final_url",
          items: [{ ...keyword(), final_url: null }],
        }),
      );
    object(
      f.resources.get(`${prefix}/adGroupCriteria/10~101`)?.adGroupCriterion,
    ).status = "PAUSED";
    await expect(
      f.previews.previewRollbackCommit(principal, String(result.commit_id)),
    ).rejects.toMatchObject({ code: "google_preview_stale" });
    const pending = await f.call("preview_delete_or_archive_object", {
      entity_type: "keyword",
      items: [keyword()],
    });
    await f.approve(pending);
    f.revoke();
    await expect(
      f.previews.commit(principal, String(pending.preview_token)),
    ).rejects.toThrow();
    expect(f.writes()).toBe(1);
    const second = fixture(),
      preview = await second.call("preview_delete_or_archive_object", {
        entity_type: "keyword",
        items: [keyword()],
      });
    await second.approve(preview);
    second.audit.record.mockImplementation(async (input) => {
      if (input.eventType === "mcp_google_stage1_operation")
        throw new Error("fixture audit unavailable");
    });
    await expect(
      second.previews.commit(principal, String(preview.preview_token)),
    ).rejects.toThrow();
    expect(second.writes()).toBe(0);
    expect(second.previewsRows[0]!.consumedAt).not.toBeNull();
  });
  it("all Stage1 tools have structured schema/annotations, no default Public Google write exposure", () => {
    const f = fixture();
    for (const name of GOOGLE_STAGE1_TOOLS) {
      const schema = stage1ToolSchema(name)!;
      expect(schema.additionalProperties).toBe(false);
      expect(Object.keys(schema.properties as object).length).toBeGreaterThan(
        0,
      );
      expect(
        f.mcp.tools().find((x) => x.name === name)?.annotations?.readOnlyHint,
      ).toBe(name === "list_change_journal");
    }
    expect(
      publicTools(f.mcp.tools()).some((x) =>
        GOOGLE_STAGE1_TOOLS.includes(x.name),
      ),
    ).toBe(false);
  });
});
