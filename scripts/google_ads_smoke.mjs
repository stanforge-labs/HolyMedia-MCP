#!/usr/bin/env node
import { pathToFileURL } from "node:url";

// Stages 2–5: MCP read tools only. No mutate or validate_only path.
const PERIOD = { start_date: "2026-08-30", end_date: "2026-09-28" };
const TOKEN = process.env.GOOGLE_ADS_SMOKE_BEARER_TOKEN;
const ENDPOINT = process.env.GOOGLE_ADS_SMOKE_MCP_URL;

export function withinTwoPercent(actual, expected) {
  return (
    Number.isFinite(actual) &&
    Math.abs(actual - expected) <= Math.abs(expected) * 0.02
  );
}

export function moneyAmount(value) {
  const amount = Number(value?.amount);
  return Number.isFinite(amount) ? amount : NaN;
}

export function isReferenceExactKeyword(keyword) {
  const text = String(keyword?.text ?? "")
    .replace(/[\[\]"+]/g, "")
    .trim()
    .toLocaleLowerCase("und")
    .replace(/\s+/g, " ");
  return (
    text === "приват клиника" &&
    String(keyword?.match_type ?? "").toUpperCase() === "EXACT"
  );
}

export function check(name, expected, actual, pass) {
  console.log(
    `${name}\n  EXPECTED: ${expected}\n  ACTUAL: ${actual}\n  ${pass ? "PASS" : "FAIL"}`,
  );
  return pass;
}

export async function visitNegativePages(
  call,
  accountId,
  inspect,
  campaignIds,
) {
  let cursor;
  for (let page = 0; page < 1000; page++) {
    const data = await call("google_ads_list_negatives", {
      account_id: accountId,
      ...(campaignIds ? { campaign_ids: campaignIds } : {}),
      limit: 500,
      ...(cursor ? { cursor } : {}),
    });
    if (!data || !data.campaign || !data.ad_group || !data.shared_list)
      throw new Error("invalid negative page");
    inspect(data);
    cursor = data.next_cursor;
    if (!cursor) return;
  }
  throw new Error("negative pagination exceeded 1000 pages");
}

async function main() {
  if (process.env.GOOGLE_ADS_WRITE_MODE?.trim().toLowerCase() === "live") {
    console.error("SMOKE REFUSED: GOOGLE_ADS_WRITE_MODE=live");
    process.exitCode = 2;
    return;
  }
  if (!TOKEN || !ENDPOINT) {
    console.error(
      "SMOKE NOT RUN: NO LIVE GOOGLE ADS ACCESS (set GOOGLE_ADS_SMOKE_MCP_URL and GOOGLE_ADS_SMOKE_BEARER_TOKEN locally)",
    );
    process.exitCode = 2;
    return;
  }
  let url;
  try {
    url = new URL(ENDPOINT);
  } catch {
    console.error("SMOKE REFUSED: invalid MCP URL");
    process.exitCode = 2;
    return;
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  ) {
    console.error("SMOKE REFUSED: MCP URL must use HTTPS or local HTTP");
    process.exitCode = 2;
    return;
  }
  let nextId = 1;
  const call = async (name, args) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: nextId++,
        method: "tools/call",
        params: { name, arguments: { provider: "GOOGLE_ADS", ...args } },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
    const rpc = await response.json();
    if (rpc.error || rpc.result?.isError)
      throw new Error(`MCP tool ${name} failed`);
    const text = rpc.result?.content?.find(
      (item) => item.type === "text",
    )?.text;
    if (typeof text !== "string")
      throw new Error(`MCP tool ${name} did not return text`);
    return JSON.parse(text);
  };
  let passed = 0,
    failed = 0;
  const run = async (name, expected, inspect) => {
    try {
      const { actual, pass } = await inspect();
      if (check(name, expected, actual, pass)) passed++;
      else failed++;
    } catch (error) {
      check(
        name,
        expected,
        `read failed (${error instanceof Error ? error.message : "unknown"})`,
        false,
      );
      failed++;
    }
  };

  await run(
    "A. audit_account cost/conv",
    "campaign 22623539698: about 9.08 USD (±2%)",
    async () => {
      const data = await call("audit_account", {
        account_id: "9458996580",
        ...PERIOD,
      });
      const campaign = data.campaigns?.find(
        (item) => item.id === "22623539698",
      );
      const value = moneyAmount(campaign?.metrics?.costPerConversion);
      const currency = campaign?.metrics?.costPerConversion?.currency;
      return {
        actual: `${value} ${currency ?? "null"}`,
        pass: withinTwoPercent(value, 9.08) && currency === "USD",
      };
    },
  );

  await run(
    "B. get_flexible_insights campaign rows",
    "roughly 5–6 rows",
    async () => {
      const data = await call("get_flexible_insights", {
        account_id: "2732846994",
        level: "campaign",
        since: PERIOD.start_date,
        until: PERIOD.end_date,
        limit: 100,
      });
      const rows = data.items;
      return {
        actual: `${Array.isArray(rows) ? rows.length : "non-array"} rows`,
        pass:
          Array.isArray(rows) &&
          rows.length >= 5 &&
          rows.length <= 6 &&
          rows.every((row) => row.campaignId && row.currency),
      };
    },
  );

  await run(
    "C. list_campaigns ENABLED",
    "only ENABLED; roughly 10–15 campaigns",
    async () => {
      const items = [];
      let cursor;
      for (let page = 0; page < 20; page++) {
        const data = await call("list_campaigns", {
          account_id: "6196888360",
          status: "ENABLED",
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        if (!Array.isArray(data.items))
          throw new Error("invalid campaign page");
        items.push(...data.items);
        cursor = data.nextCursor;
        if (!cursor) break;
        if (page === 19) throw new Error("pagination exceeded 20 pages");
      }
      return {
        actual: `${items.length} campaigns; statuses=${[...new Set(items.map((item) => item.status))].join(",")}`,
        pass:
          items.length >= 10 &&
          items.length <= 15 &&
          items.every((item) => item.status === "ENABLED"),
      };
    },
  );

  await run(
    "D. campaign budget semantics",
    "15961195382: budget amount/period/shared and 30-day spend; budget need not equal spend",
    async () => {
      const data = await call("list_campaigns", {
        account_id: "2732846994",
        ...PERIOD,
        limit: 500,
      });
      const campaign = data.items?.find((item) => item.id === "15961195382");
      const budget = moneyAmount(campaign?.budget);
      const spend = moneyAmount(campaign?.metrics?.spend);
      const details = campaign?.budgetDetails;
      const actual = `budget=${budget} ${campaign?.budget?.currency ?? "null"}/${details?.period ?? "unknown"}; shared=${details?.explicitlyShared ?? "unknown"}; resource=${details?.resourceName ?? "unknown"}; spend=${spend} ${campaign?.metrics?.spend?.currency ?? "null"}`;
      return {
        actual,
        pass:
          Number.isFinite(budget) &&
          Number.isFinite(spend) &&
          Boolean(details?.period && details.resourceName) &&
          typeof details?.explicitlyShared === "boolean",
      };
    },
  );

  await run(
    "E. Google Ads keywords",
    "hm_oc_almaty_proktology_search: 68–72 keywords; total spend about 31,287 USD; [приват клиника] about 2,998 USD (money ±2%)",
    async () => {
      const campaigns = await call("list_campaigns", {
        account_id: "9458996580",
        limit: 500,
      });
      const campaign = campaigns.items?.find(
        (item) => item.name === "hm_oc_almaty_proktology_search",
      );
      if (!campaign?.id)
        throw new Error("target campaign not found in first 500 campaigns");
      const items = [];
      let cursor;
      for (let page = 0; page < 100; page++) {
        const result = await call("google_ads_list_keywords", {
          account_id: "9458996580",
          campaign_ids: [campaign.id],
          since: "2026-03-01",
          until: "2026-09-28",
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        if (!Array.isArray(result.items))
          throw new Error("invalid keyword page");
        items.push(...result.items);
        cursor = result.nextCursor;
        if (!cursor) break;
        if (page === 99)
          throw new Error("keyword pagination exceeded 100 pages");
      }
      const spend = items.reduce(
        (sum, item) => sum + Number(item.cost ?? 0),
        0,
      );
      const privateClinic = items.find(isReferenceExactKeyword);
      const keywordSpend = Number(privateClinic?.cost);
      return {
        actual: `${items.length} keywords; total=${spend} ${items[0]?.currency ?? "null"}; [приват клиника]=${keywordSpend}`,
        pass:
          items.length >= 68 &&
          items.length <= 72 &&
          items.every((item) => item.currency === "USD") &&
          withinTwoPercent(spend, 31287) &&
          withinTwoPercent(keywordSpend, 2998),
      };
    },
  );

  await run(
    "F. Google Ads search term attribution",
    "приват клиника алматы triggered by проктолог алматы (BROAD)",
    async () => {
      const data = await call("google_ads_search_terms", {
        account_id: "9458996580",
        since: "2026-03-01",
        until: "2026-09-28",
        contains: "приват клиника алматы",
        limit: 100,
        format: "json",
      });
      const matches =
        data.items?.filter(
          (item) => item.search_term === "приват клиника алматы",
        ) ?? [];
      const attributed = matches.find((item) =>
        item.triggered_keyword?.includes("проктолог алматы"),
      );
      return {
        actual: `${matches.length} rows; keyword=${attributed?.triggered_keyword ?? "unavailable"}; keyword match type=${attributed?.triggered_keyword_match_type ?? "unavailable"}; term match type=${attributed?.search_term_match_type ?? "unavailable"}`,
        pass: Boolean(
          attributed && attributed.triggered_keyword_match_type === "BROAD",
        ),
      };
    },
  );

  await run(
    "G. Google Ads visible search-term cost",
    "about 23,500 USD (±2%); Google Ads may withhold search terms; this value is not expected to equal total campaign spend",
    async () => {
      let cursor;
      let sum = 0;
      let count = 0;
      let currency;
      for (let page = 0; page < 1000; page++) {
        const data = await call("google_ads_search_terms", {
          account_id: "9458996580",
          since: "2026-03-01",
          until: "2026-09-28",
          limit: 500,
          format: "json",
          ...(cursor ? { cursor } : {}),
        });
        if (!Array.isArray(data.items))
          throw new Error("invalid search-term page");
        for (const item of data.items) {
          sum += Number(item.cost ?? 0);
          count++;
          currency = item.currency ?? currency;
        }
        cursor = data.next_cursor;
        if (!cursor) break;
        if (page === 999)
          throw new Error("search-term pagination exceeded 1000 pages");
      }
      return {
        actual: `${count} visible rows; ${sum} ${currency ?? "null"}. Google Ads may withhold search terms; this value is not expected to equal total campaign spend`,
        pass: withinTwoPercent(sum, 23500) && currency === "USD",
      };
    },
  );

  await run(
    "H. Stage 5 negative inventory in three On Clinic accounts",
    "existing negatives visible in 9458996580, 2732846994 and 6196888360",
    async () => {
      const counts = [];
      for (const accountId of ["9458996580", "2732846994", "6196888360"]) {
        let count = 0;
        await visitNegativePages(call, accountId, (data) => {
          count += (data.campaign.campaigns ?? []).reduce(
            (sum, item) => sum + (item.negatives?.length ?? 0),
            0,
          );
          count += (data.ad_group.campaigns ?? []).reduce(
            (sum, item) =>
              sum +
              (item.ad_groups ?? []).reduce(
                (inner, group) => inner + (group.negatives?.length ?? 0),
                0,
              ),
            0,
          );
          count += (data.shared_list.lists ?? []).reduce(
            (sum, item) => sum + (item.negatives?.length ?? 0),
            0,
          );
        });
        counts.push(`${accountId}=${count}`);
      }
      return {
        actual: counts.join(", "),
        pass: counts.every((entry) => Number(entry.split("=")[1]) > 0),
      };
    },
  );

  await run(
    "I. Stage 5 broad negative conflict control",
    "hm_oc_almaty_proktology_search: приват BROAD conflicts with actual [приват клиника] keyword",
    async () => {
      const campaigns = await call("list_campaigns", {
        account_id: "9458996580",
        limit: 500,
      });
      const campaign = campaigns.items?.find(
        (item) => item.name === "hm_oc_almaty_proktology_search",
      );
      if (!campaign?.id) throw new Error("control campaign not found");
      let cursor;
      let found;
      for (let page = 0; page < 1000; page++) {
        const data = await call("google_ads_check_negative_conflicts", {
          account_id: "9458996580",
          campaign_ids: [campaign.id],
          negatives: [{ text: "приват", match_type: "BROAD" }],
          limit: 500,
          ...(cursor ? { cursor } : {}),
        });
        found ??= data.conflicts?.find(
          (item) =>
            isReferenceExactKeyword(item.keyword) &&
            item.campaign?.id === campaign.id &&
            item.keyword?.status === "ENABLED" &&
            item.negative?.match_type === "BROAD",
        );
        cursor = data.next_cursor;
        if (!cursor) break;
        if (page === 999)
          throw new Error("conflict pagination exceeded 1000 pages");
      }
      return {
        actual: found
          ? `${found.keyword.text} / ${found.keyword.resource_name}`
          : "target keyword conflict not found",
        pass: Boolean(found?.keyword?.resource_name),
      };
    },
  );

  await run(
    "J. Stage 5 clinic appointment effective negative",
    "hm_oc_almaty_ginekologiya_search: clinic appointment is campaign negative or member of attached shared list",
    async () => {
      const campaigns = await call("list_campaigns", {
        account_id: "9458996580",
        limit: 500,
      });
      const campaign = campaigns.items?.find(
        (item) => item.name === "hm_oc_almaty_ginekologiya_search",
      );
      if (!campaign?.id) throw new Error("control campaign not found");
      let campaignNegative = false;
      const memberSets = new Set();
      const attachedSets = new Set();
      await visitNegativePages(
        call,
        "9458996580",
        (data) => {
          for (const item of data.campaign.campaigns ?? [])
            if (item.campaign_id === campaign.id)
              campaignNegative ||= (item.negatives ?? []).some(
                (negative) =>
                  negative.text?.trim().toLowerCase() === "clinic appointment",
              );
          for (const list of data.shared_list.lists ?? []) {
            if (
              (list.negatives ?? []).some(
                (negative) =>
                  negative.text?.trim().toLowerCase() === "clinic appointment",
              )
            )
              memberSets.add(list.resource_name);
            if (
              (list.attached_campaigns ?? []).some(
                (item) => item.campaign_id === campaign.id,
              )
            )
              attachedSets.add(list.resource_name);
          }
        },
        [campaign.id],
      );
      const shared = [...memberSets].some((name) => attachedSets.has(name));
      return {
        actual: `campaign=${campaignNegative}; attached_shared_list=${shared}`,
        pass: campaignNegative || shared,
      };
    },
  );

  console.log(`${passed} passed / ${failed} failed`);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  await main();
