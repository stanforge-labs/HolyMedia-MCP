import { createHash } from "node:crypto";
import { keywordInventoryQuery, keywordPlacement } from "./google-ads-keywords.js";
import { ProviderError } from "./provider.errors.js";
import type {
  GoogleNegativeConflictOptions,
  GoogleNegativeConflictPage,
  GoogleNegativeInput,
  GoogleNegativeLevel,
  GoogleNegativeOptions,
  GoogleNegativePage,
  GoogleNegativeKeyword,
  GoogleSharedNegativeList,
} from "./provider.types.js";

type Row = Record<string, unknown>;
type SearchPage = { results: Row[]; nextPageToken?: string };
type Search = (query: string, pageToken?: string) => Promise<SearchPage>;
type Phase = "campaign" | "ad_group" | "lists" | "members" | "attachments";
type Position = { phase: number; token?: string; index: number; negative: number };
type MatchType = "BROAD" | "PHRASE" | "EXACT";
type NormalizedNegative = { text: string; match_type: MatchType };

const PHASES: Phase[] = ["campaign", "ad_group", "lists", "members", "attachments"];
const LEVELS: GoogleNegativeLevel[] = ["campaign", "ad_group", "shared_list"];
const MAX_RELEVANT_PAGES = 100;
const MAX_RELEVANT_SETS = 1000;
const MAX_CONFLICT_SCAN_PAGES = 20;

const invalid = (message: string) => new ProviderError("invalid_request", message);
const record = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
const str = (value: unknown): string => value == null ? "" : String(value);
const count = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

function ids(values: string[] | undefined, required = false): string[] | undefined {
  if (values === undefined && !required) return undefined;
  if (!Array.isArray(values) || values.length < 1 || values.length > 200 ||
    values.some((value) => typeof value !== "string" || !/^\d{1,20}$/.test(value)))
    throw invalid("campaign_ids must contain 1–200 numeric IDs.");
  return [...new Set(values)].sort();
}

function limit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 500)
    throw invalid("limit must be between 1 and 500.");
  return value;
}

export function negativeOptions(options: GoogleNegativeOptions): GoogleNegativeOptions {
  const campaignIds = ids(options.campaignIds);
  const levels = options.levels === undefined ? LEVELS : options.levels;
  if (!Array.isArray(levels) || !levels.length ||
    levels.some((value) => !LEVELS.includes(value)))
    throw invalid("levels must contain campaign, ad_group, or shared_list.");
  if (options.cursor !== undefined &&
    (typeof options.cursor !== "string" || !options.cursor))
    throw invalid("Invalid Google negative cursor.");
  limit(options.limit);
  return {
    ...(campaignIds ? { campaignIds } : {}),
    levels: LEVELS.filter((value) => levels.includes(value)),
    limit: options.limit,
    ...(options.cursor ? { cursor: options.cursor } : {}),
  };
}

function phases(levels: GoogleNegativeLevel[]): Phase[] {
  return PHASES.filter((phase) => levels.includes(
    phase === "campaign" || phase === "ad_group" ? phase : "shared_list",
  ));
}

function fingerprint(accountId: string, scope: unknown): string {
  return createHash("sha256").update(JSON.stringify({ accountId, scope }))
    .digest("hex").slice(0, 24);
}

function decode(cursor: string | undefined, fp: string, phaseCount: number): Position {
  if (cursor === undefined) return { phase: 0, index: 0, negative: 0 };
  try {
    if (cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw Error();
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Row;
    if (value.v !== 1 || value.f !== fp || !Number.isInteger(value.p) ||
      Number(value.p) < 0 || Number(value.p) >= phaseCount ||
      !Number.isInteger(value.i) || Number(value.i) < 0 || Number(value.i) > 10000 ||
      !Number.isInteger(value.n) || Number(value.n) < 0 || Number(value.n) > 100 ||
      (value.t !== undefined && (typeof value.t !== "string" || value.t.length > 2048)))
      throw Error();
    return {
      phase: Number(value.p), index: Number(value.i), negative: Number(value.n),
      ...(value.t ? { token: String(value.t) } : {}),
    };
  } catch {
    throw invalid("Invalid Google negative cursor.");
  }
}

function encode(position: Position, fp: string): string {
  return Buffer.from(JSON.stringify({
    v: 1, f: fp, p: position.phase, i: position.index, n: position.negative,
    ...(position.token ? { t: position.token } : {}),
  })).toString("base64url");
}

function campaignFilter(campaignIds: string[] | undefined): string {
  return campaignIds?.length ? ` AND campaign.id IN (${campaignIds.join(", ")})` : "";
}

function sharedFilter(relevantSets: string[] | undefined): string {
  return relevantSets ? ` AND shared_set.resource_name IN (${relevantSets.map((name) => `'${name}'`).join(", ")})` : "";
}

export function negativeQuery(
  phase: Phase,
  campaignIds?: string[],
  relevantSets?: string[],
): string {
  switch (phase) {
    case "campaign":
      return "SELECT campaign.id, campaign.name, campaign_criterion.resource_name, campaign_criterion.criterion_id, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type, campaign_criterion.status FROM campaign_criterion WHERE campaign_criterion.type = 'KEYWORD' AND campaign_criterion.negative = TRUE AND campaign_criterion.status != 'REMOVED'" + campaignFilter(campaignIds) + " ORDER BY campaign.id, campaign_criterion.criterion_id";
    case "ad_group":
      return "SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.resource_name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status FROM ad_group_criterion WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = TRUE AND ad_group_criterion.status != 'REMOVED'" + campaignFilter(campaignIds) + " ORDER BY campaign.id, ad_group.id, ad_group_criterion.criterion_id";
    case "lists":
      return "SELECT shared_set.id, shared_set.name, shared_set.resource_name, shared_set.status, shared_set.member_count FROM shared_set WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status = 'ENABLED'" + sharedFilter(relevantSets) + " ORDER BY shared_set.id";
    case "members":
      return "SELECT shared_set.id, shared_set.name, shared_set.resource_name, shared_set.status, shared_set.member_count, shared_criterion.criterion_id, shared_criterion.resource_name, shared_criterion.keyword.text, shared_criterion.keyword.match_type FROM shared_criterion WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status = 'ENABLED' AND shared_criterion.type = 'KEYWORD'" + sharedFilter(relevantSets) + " ORDER BY shared_set.id, shared_criterion.criterion_id";
    case "attachments":
      return "SELECT shared_set.id, shared_set.name, shared_set.resource_name, shared_set.status, shared_set.member_count, campaign.id, campaign.name, campaign_shared_set.resource_name, campaign_shared_set.status FROM campaign_shared_set WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status = 'ENABLED' AND campaign_shared_set.status = 'ENABLED'" + campaignFilter(campaignIds) + " ORDER BY shared_set.id, campaign.id";
  }
}

async function relevantSharedSets(campaignIds: string[], search: Search): Promise<string[]> {
  const names = new Set<string>();
  let token: string | undefined;
  for (let page = 0; page < MAX_RELEVANT_PAGES; page++) {
    const result = await search(negativeQuery("attachments", campaignIds), token);
    for (const row of result.results) {
      const name = str(record(row.sharedSet).resourceName);
      if (!/^customers\/\d{10}\/sharedSets\/\d+$/.test(name))
        throw new ProviderError("provider_response_invalid", "Invalid shared set resource name.");
      names.add(name);
      if (names.size > MAX_RELEVANT_SETS)
        throw invalid("More than 1000 relevant shared lists; narrow campaign_ids.");
    }
    if (!result.nextPageToken) return [...names].sort();
    token = result.nextPageToken;
  }
  throw invalid("Relevant shared-list scan exceeded 100 provider pages; narrow campaign_ids.");
}

function negative(row: Row, field: "campaignCriterion" | "adGroupCriterion" | "sharedCriterion"): GoogleNegativeKeyword {
  const criterion = record(row[field]);
  const keyword = record(criterion.keyword);
  return {
    resource_name: str(criterion.resourceName),
    criterion_id: str(criterion.criterionId),
    text: str(keyword.text),
    match_type: str(keyword.matchType),
    ...(field !== "sharedCriterion" ? { status: str(criterion.status) } : {}),
  };
}

function pageResult(accountId: string, phase: Phase, rows: Row[], next: string | null): GoogleNegativePage {
  const campaign = new Map<string, GoogleNegativePage["campaign"]["campaigns"][number]>();
  const adGroup = new Map<string, GoogleNegativePage["ad_group"]["campaigns"][number]>();
  const lists = new Map<string, GoogleSharedNegativeList>();
  for (const row of rows) {
    const c = record(row.campaign);
    const campaignId = str(c.id);
    if (phase === "campaign") {
      const entry = campaign.get(campaignId) ?? {
        campaign_id: campaignId, campaign_name: str(c.name), negatives: [],
      };
      entry.negatives.push(negative(row, "campaignCriterion"));
      campaign.set(campaignId, entry);
    } else if (phase === "ad_group") {
      const entry = adGroup.get(campaignId) ?? {
        campaign_id: campaignId, campaign_name: str(c.name), ad_groups: [],
      };
      const group = record(row.adGroup);
      const groupId = str(group.id);
      let placement = entry.ad_groups.find((item) => item.ad_group_id === groupId);
      if (!placement) {
        placement = { ad_group_id: groupId, ad_group_name: str(group.name), negatives: [] };
        entry.ad_groups.push(placement);
      }
      placement.negatives.push(negative(row, "adGroupCriterion"));
      adGroup.set(campaignId, entry);
    } else {
      const set = record(row.sharedSet);
      const id = str(set.id);
      const entry = lists.get(str(set.resourceName)) ?? {
        shared_set_id: id, name: str(set.name), resource_name: str(set.resourceName),
        status: str(set.status), member_count: count(set.memberCount),
        fragment_kind: phase === "lists" ? "metadata" : phase === "members" ? "members" : "attachments",
        negatives: [], attached_campaigns: [],
      };
      if (phase === "members") entry.negatives.push(negative(row, "sharedCriterion"));
      if (phase === "attachments") {
        const association = record(row.campaignSharedSet);
        entry.attached_campaigns.push({
          campaign_id: campaignId, campaign_name: str(c.name),
          resource_name: str(association.resourceName), status: str(association.status),
        });
      }
      lists.set(entry.resource_name, entry);
    }
  }
  return {
    account_id: accountId,
    page_section: phase === "campaign" || phase === "ad_group" ? phase : "shared_list",
    campaign: { campaigns: [...campaign.values()] },
    ad_group: { campaigns: [...adGroup.values()] },
    shared_list: { lists: [...lists.values()] },
    next_cursor: next,
  };
}

export async function listGoogleNegatives(
  accountId: string,
  rawOptions: GoogleNegativeOptions,
  search: Search,
): Promise<GoogleNegativePage> {
  const options = negativeOptions(rawOptions);
  const sequence = phases(options.levels!);
  const fp = fingerprint(accountId, {
    campaignIds: options.campaignIds ?? [], levels: options.levels,
  });
  let position = decode(options.cursor, fp, sequence.length);
  let relevantSets: string[] | undefined;
  for (; position.phase < sequence.length; position = { phase: position.phase + 1, index: 0, negative: 0 }) {
    const phase = sequence[position.phase]!;
    if (options.campaignIds && relevantSets === undefined &&
      ["lists", "members"].includes(phase))
      relevantSets = await relevantSharedSets(options.campaignIds, search);
    if (relevantSets?.length === 0 && ["lists", "members"].includes(phase)) continue;
    const page = await search(negativeQuery(phase, options.campaignIds, relevantSets), position.token);
    if (position.index > page.results.length || position.negative !== 0)
      throw invalid("Invalid Google negative cursor.");
    const rows = page.results.slice(position.index, position.index + options.limit);
    const end = position.index + rows.length;
    let next: string | null = null;
    if (end < page.results.length)
      next = encode({ ...position, index: end }, fp);
    else if (page.nextPageToken)
      next = encode({ phase: position.phase, token: page.nextPageToken, index: 0, negative: 0 }, fp);
    else if (position.phase + 1 < sequence.length)
      next = encode({ phase: position.phase + 1, index: 0, negative: 0 }, fp);
    if (rows.length) return pageResult(accountId, phase, rows, next);
    if (page.nextPageToken)
      return pageResult(accountId, phase, [], next);
  }
  const last = sequence.at(-1)!;
  return pageResult(accountId, last, [], null);
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("und");
}

function unwrap(value: string): { text: string; match_type?: MatchType } {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]"))
    return { text: trimmed.slice(1, -1), match_type: "EXACT" };
  if (trimmed.startsWith('"') && trimmed.endsWith('"'))
    return { text: trimmed.slice(1, -1), match_type: "PHRASE" };
  return { text: trimmed };
}

export function normalizeNegativeInputs(values: GoogleNegativeInput[]): NormalizedNegative[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 100)
    throw invalid("negatives must contain 1–100 entries.");
  const result = new Map<string, NormalizedNegative>();
  for (const value of values) {
    if (!value || typeof value !== "object" || typeof value.text !== "string")
      throw invalid("Each negative needs non-empty text and a valid match_type.");
    const parsed = unwrap(value.text);
    const matchType = value.match_type ?? parsed.match_type ?? "BROAD";
    if (!["BROAD", "PHRASE", "EXACT"].includes(matchType) ||
      (parsed.match_type && value.match_type && parsed.match_type !== value.match_type))
      throw invalid("Invalid negative match_type or mismatched Google syntax.");
    const text = normalizeText(parsed.text);
    if (!text || text.length > 200)
      throw invalid("Negative text must be non-empty and at most 200 characters.");
    const key = `${matchType}:${text}`;
    if (!result.has(key)) result.set(key, { text, match_type: matchType });
  }
  return [...result.values()];
}

export function negativeMatch(negative: NormalizedNegative, keywordText: string): boolean {
  const keyword = normalizeText(unwrap(keywordText).text);
  if (negative.match_type === "EXACT") return keyword === negative.text;
  const terms = negative.text.split(" ");
  const words = keyword.split(" ");
  if (negative.match_type === "BROAD") {
    const available = new Map<string, number>();
    for (const word of words) available.set(word, (available.get(word) ?? 0) + 1);
    return terms.every((term) => {
      const remaining = available.get(term) ?? 0;
      if (!remaining) return false;
      available.set(term, remaining - 1);
      return true;
    });
  }
  return words.some((_, start) =>
    terms.every((term, offset) => words[start + offset] === term));
}

const REASONS: Record<MatchType, { code: string; message: string }> = {
  BROAD: { code: "BROAD_ALL_TERMS_PRESENT", message: "Все слова broad negative присутствуют в keyword" },
  PHRASE: { code: "PHRASE_CONTIGUOUS_ORDER", message: "Слова phrase negative идут подряд в том же порядке" },
  EXACT: { code: "EXACT_NORMALIZED_TEXT", message: "Нормализованный текст negative и keyword совпадает" },
};

export async function checkGoogleNegativeConflicts(
  accountId: string,
  rawOptions: GoogleNegativeConflictOptions,
  search: Search,
): Promise<GoogleNegativeConflictPage> {
  const campaignIds = ids(rawOptions.campaignIds, true)!;
  const negatives = normalizeNegativeInputs(rawOptions.negatives);
  limit(rawOptions.limit);
  const fp = fingerprint(accountId, { campaignIds, negatives });
  let position = decode(rawOptions.cursor, fp, 1);
  const query = keywordInventoryQuery({
    campaignIds, statuses: ["ENABLED"], limit: rawOptions.limit,
    range: { startDate: "2000-01-01", endDate: "2000-01-01" },
  });
  const conflicts: GoogleNegativeConflictPage["conflicts"] = [];
  for (let scanned = 0; scanned < MAX_CONFLICT_SCAN_PAGES; scanned++) {
    const page = await search(query, position.token);
    if (position.index > page.results.length || position.negative >= negatives.length)
      throw invalid("Invalid Google negative cursor.");
    for (let i = position.index; i < page.results.length; i++) {
      const placement = keywordPlacement(page.results[i]!);
      // The GAQL filter is the source of truth; this guard also rejects malformed fixtures/responses.
      if (placement.status !== "ENABLED" ||
        record(page.results[i]!.adGroupCriterion).negative === true ||
        !campaignIds.includes(placement.campaign_id)) continue;
      for (let n = i === position.index ? position.negative : 0; n < negatives.length; n++) {
        const negative = negatives[n]!;
        if (!negativeMatch(negative, placement.text)) continue;
        if (conflicts.length === rawOptions.limit) {
          return { account_id: accountId, conflicts, normalized_negatives: negatives,
            next_cursor: encode({ phase: 0, ...(position.token ? { token: position.token } : {}), index: i, negative: n }, fp) };
        }
        conflicts.push({
          negative,
          keyword: {
            resource_name: placement.resource_name, criterion_id: placement.criterion_id,
            text: placement.text, match_type: placement.match_type, status: placement.status,
          },
          campaign: { id: placement.campaign_id, name: placement.campaign_name },
          ad_group: { id: placement.ad_group_id, name: placement.ad_group_name },
          reason: REASONS[negative.match_type],
        });
      }
    }
    if (!page.nextPageToken)
      return { account_id: accountId, conflicts, normalized_negatives: negatives, next_cursor: null };
    position = { phase: 0, token: page.nextPageToken, index: 0, negative: 0 };
  }
  return { account_id: accountId, conflicts, normalized_negatives: negatives,
    next_cursor: encode(position, fp) };
}
