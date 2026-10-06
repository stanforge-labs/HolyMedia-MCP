import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  WidthType,
} from "docx";

let schemaOrgPromise: Promise<unknown> | undefined;

export const MAX_AUDIT_PAGES = 30;
export const SAFE_REDIRECTS = 5;
const MAX_HTML_BYTES = 1_500_000;
const REQUEST_TIMEOUT_MS = 18_000;

export type AuditBriefInput = {
  url: string;
  companyName?: string;
  industry?: string;
  targetAudience?: string;
  primaryGoal?: string;
  mainProblem?: string;
  primaryAction?: string;
  market?: string;
  competitors?: string[];
};

export type AuditPage = {
  url: string;
  statusCode: number | null;
  title: string | null;
  description: string | null;
  canonicalUrl: string | null;
  headings: { h1: string[]; h2: string[]; h3: string[] };
  checks: Record<string, unknown>;
  links: string[];
  externalLinks: string[];
  indexable: boolean;
  html: string;
};

export type AuditFindingInput = {
  category: string;
  severity: "P0" | "P1" | "P2" | "P3";
  evidenceKind: "MEASURED" | "COMPUTED" | "AI_ASSESSMENT";
  title: string;
  finding: string;
  location?: string;
  selector?: string;
  evidence: string;
  impact: string;
  recommendation: string;
  ownerRole?: string;
  effort?: string;
};

export type AuditMetricInput = {
  category: string;
  metricKey: string;
  label: string;
  value: unknown;
  unit?: string;
  evidenceKind: "MEASURED" | "COMPUTED" | "AI_ASSESSMENT";
  source: string;
};

export type AuditComputation = {
  pages: AuditPage[];
  findings: AuditFindingInput[];
  metrics: AuditMetricInput[];
  scores: Array<{
    id: string;
    label: string;
    value: number;
    applicable: number;
    findingCount?: number;
    origin: string;
  }>;
  summary: Record<string, unknown>;
};

export class PublicUrlError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PublicUrlError";
  }
}

export async function normalizePublicUrl(raw: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new PublicUrlError("Укажите корректный публичный HTTP(S) URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new PublicUrlError(
      "Разрешены только публичные HTTP(S) URL без логина и пароля.",
    );
  if (url.port && !["80", "443"].includes(url.port))
    throw new PublicUrlError(
      "Для аудита разрешены только стандартные web-порты.",
    );
  if (isBlockedHostname(url.hostname))
    throw new PublicUrlError("Внутренние адреса недоступны для анализа.");
  await resolvePublicHost(url.hostname);
  url.hash = "";
  return url.toString();
}

function isBlockedHostname(hostname: string) {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    host === "metadata" ||
    host === "169.254.169.254"
  );
}

export async function resolvePublicHost(hostname: string) {
  if (isBlockedHostname(hostname))
    throw new PublicUrlError("Внутренний адрес запрещён.");
  const records = await lookup(hostname, { all: true, verbatim: true }).catch(
    () => {
      throw new PublicUrlError("Не удалось безопасно разрешить домен сайта.");
    },
  );
  if (!records.length || records.some((record) => isBlockedIp(record.address)))
    throw new PublicUrlError(
      "Домен указывает на закрытую или внутреннюю сеть.",
    );
  return records;
}

export function isBlockedIp(address: string) {
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isBlockedIp(normalized.slice(7));
  if (isIP(normalized) === 6) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8")
    );
  }
  const parts = normalized.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return true;
  const [a, b] = parts as [number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

type SafeResponse = {
  url: string;
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
};

export type SafeGetOptions = {
  /** HEAD uses the same DNS pinning / redirect guards for reachability checks. */
  headOnly?: boolean;
  accept?: string;
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  requireHttps?: boolean;
  ifNoneMatch?: string;
  userAgent?: string;
};

/** Read-only GET/HEAD with pinned DNS and revalidation on every redirect. */
export async function safeGet(
  rawUrl: string,
  options: SafeGetOptions = {},
): Promise<SafeResponse> {
  let current = await normalizePublicUrl(rawUrl);
  assertRequiredProtocol(current, options);
  const maxRedirects = Math.min(
    SAFE_REDIRECTS,
    Math.max(0, options.maxRedirects ?? SAFE_REDIRECTS),
  );
  const { ifNoneMatch, ...requestOptions } = options;
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const response = await safeGetOne(current, {
      ...requestOptions,
      // An origin-specific validator must not be forwarded to a redirect
      // target, especially when the redirect crosses origins.
      ...(redirects === 0 && ifNoneMatch !== undefined ? { ifNoneMatch } : {}),
    });
    if (![301, 302, 303, 307, 308].includes(response.statusCode))
      return response;
    const location = response.headers.location;
    if (!location || Array.isArray(location) || redirects === maxRedirects)
      throw new PublicUrlError("Сайт вернул слишком много перенаправлений.");
    current = await normalizePublicUrl(new URL(location, current).toString());
    assertRequiredProtocol(current, options);
  }
  throw new PublicUrlError("Не удалось получить публичную страницу.");
}

async function safeGetOne(
  urlText: string,
  options: SafeGetOptions,
): Promise<SafeResponse> {
  const url = new URL(urlText);
  const addresses = await resolvePublicHost(url.hostname);
  const chosen = addresses[0];
  if (!chosen) throw new PublicUrlError("Не удалось разрешить домен сайта.");
  const transport = url.protocol === "https:" ? https : http;
  const maxBytes = options.maxBytes ?? MAX_HTML_BYTES;
  return new Promise<SafeResponse>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    const request = transport.request(
      url,
      {
        method: options.headOnly ? "HEAD" : "GET",
        timeout: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
        headers: {
          accept:
            options.accept ??
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1",
          "user-agent":
            options.userAgent ??
            "HolyMediaSiteAudit/3.0 (+https://mcp.holymedia.kz)",
          ...(options.ifNoneMatch
            ? { "if-none-match": options.ifNoneMatch }
            : {}),
        },
        lookup: (_host, lookupOptions, callback) => {
          // Node 24 can request DNS records with `all: true`. Return the same
          // pre-validated records in that form, rather than allowing Node to
          // resolve the host again and bypass the DNS-rebinding guard.
          if (lookupOptions.all) return callback(null, addresses);
          return callback(null, chosen.address, chosen.family);
        },
      },
      (response) => {
        const remote = response.socket.remoteAddress;
        if (!remote || isBlockedIp(remote)) {
          response.resume();
          fail(
            new PublicUrlError("Соединение с внутренним адресом запрещено."),
          );
          return;
        }
        const parts: Buffer[] = [];
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) {
            response.destroy();
            fail(
              new PublicUrlError(
                "Ответ сайта превышает допустимый размер анализа.",
              ),
            );
            return;
          }
          parts.push(chunk);
        });
        response.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({
            url: url.toString(),
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(parts),
          });
        });
      },
    );
    request.once("timeout", () =>
      request.destroy(new PublicUrlError("Сайт не ответил вовремя.")),
    );
    request.once("error", (error) =>
      fail(
        error instanceof PublicUrlError
          ? error
          : new PublicUrlError(describeRequestError(error)),
      ),
    );
    request.end();
  });
}

function assertRequiredProtocol(url: string, options: SafeGetOptions) {
  if (options.requireHttps && new URL(url).protocol !== "https:") {
    throw new PublicUrlError("Для этого внешнего ресурса требуется HTTPS.");
  }
}

function describeRequestError(error: NodeJS.ErrnoException) {
  if (/CERT_|TLS/i.test(error.code ?? ""))
    return "Не удалось установить защищённое TLS-соединение с сайтом.";
  if (error.code === "ENOTFOUND")
    return "Домен сайта не удалось разрешить в публичный IP-адрес.";
  if (error.code === "ECONNREFUSED")
    return "Сайт отклонил соединение аудитора.";
  if (["ECONNRESET", "EHOSTUNREACH", "ETIMEDOUT"].includes(error.code ?? ""))
    return "Сайт временно не ответил на безопасную проверку.";
  return "Не удалось безопасно получить страницу сайта.";
}

export async function crawlPublicSite(
  startUrl: string,
  onProgress?: (data: {
    found: number;
    checked: number;
  }) => Promise<void> | void,
  maxPages = MAX_AUDIT_PAGES,
): Promise<{
  pages: AuditPage[];
  pagesFound: number;
  sampled: boolean;
  robotsBlocked: boolean;
  failures: Array<{ url: string; reason: string }>;
}> {
  const home = await normalizePublicUrl(startUrl);
  const root = new URL(home);
  const robots = await fetchRobots(root).catch(() => ({
    allowed: true,
    sitemaps: [] as string[],
    crawlDelayMs: 300,
  }));
  if (!robots.allowed)
    return {
      pages: [],
      pagesFound: 0,
      sampled: false,
      robotsBlocked: true,
      failures: [],
    };
  const seed = new Set<string>([home]);
  for (const sitemapUrl of robots.sitemaps) {
    for (const item of await readSitemap(sitemapUrl).catch(() => [])) {
      if (sameOrigin(home, item)) seed.add(item);
    }
  }
  const pages: AuditPage[] = [];
  const failures: Array<{ url: string; reason: string }> = [];
  const queue = [...seed];
  const seen = new Set(queue);
  while (queue.length && pages.length < maxPages) {
    const url = queue.shift();
    if (!url) continue;
    const page = await fetchAuditPageWithRetry(url).catch((error) => {
      const reason =
        error instanceof Error ? error.message : "Неизвестная ошибка загрузки.";
      failures.push({ url, reason });
      return null;
    });
    if (page) {
      pages.push(page);
      for (const link of page.links) {
        if (
          sameOrigin(home, link) &&
          !seen.has(link) &&
          seen.size < maxPages * 4
        ) {
          seen.add(link);
          queue.push(link);
        }
      }
    }
    await onProgress?.({ found: seen.size, checked: pages.length });
    if (queue.length && robots.crawlDelayMs > 0)
      await delay(robots.crawlDelayMs);
  }
  return {
    pages,
    pagesFound: seen.size,
    sampled: queue.length > 0 || seen.size > pages.length,
    robotsBlocked: false,
    failures: failures.slice(0, 10),
  };
}

async function fetchAuditPageWithRetry(url: string): Promise<AuditPage> {
  try {
    return await fetchAuditPage(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/временно не ответил|вовремя/i.test(message)) throw error;
    // One delayed retry is reserved for a genuine transport timeout. It never
    // retries access controls, CAPTCHA pages, authentication, or robots rules.
    await delay(750);
    return fetchAuditPage(url);
  }
}

async function fetchRobots(root: URL) {
  const response = await safeGet(new URL("/robots.txt", root).toString(), {
    accept: "text/plain",
    maxBytes: 300_000,
  });
  if (response.statusCode >= 400)
    return { allowed: true, sitemaps: [] as string[], crawlDelayMs: 300 };
  const text = response.body.toString("utf8");
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  let applies = false;
  let allowed = true;
  let crawlDelayMs = 300;
  const sitemaps: string[] = [];
  for (const line of lines) {
    const [key, ...valueParts] = line.split(":");
    const value = valueParts.join(":").trim();
    if (!key || !value) continue;
    if (key.toLowerCase() === "user-agent")
      applies = value === "*" || /holymedia/i.test(value);
    if (key.toLowerCase() === "disallow" && applies && value === "/")
      allowed = false;
    if (key.toLowerCase() === "crawl-delay" && applies) {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0)
        crawlDelayMs = Math.min(
          5_000,
          Math.max(250, Math.round(seconds * 1_000)),
        );
    }
    if (key.toLowerCase() === "sitemap")
      sitemaps.push(new URL(value, root).toString());
  }
  if (!sitemaps.length) sitemaps.push(new URL("/sitemap.xml", root).toString());
  return { allowed, sitemaps, crawlDelayMs };
}

async function readSitemap(url: string, depth = 0): Promise<string[]> {
  const response = await safeGet(url, {
    accept: "application/xml,text/xml;q=0.9,*/*;q=0.1",
    maxBytes: 1_000_000,
  });
  if (response.statusCode >= 400) return [];
  const xml = response.body.toString("utf8");
  const locations = [...xml.matchAll(/<loc[^>]*>\s*([^<\s]+)\s*<\/loc>/gi)]
    .map((match) => match[1] ?? "")
    .filter(Boolean);
  if (/<sitemapindex\b/i.test(xml) && depth < 2) {
    const children = await Promise.all(
      locations.slice(0, 12).map((item) =>
        normalizePublicUrl(item)
          .then((safe) => readSitemap(safe, depth + 1))
          .catch(() => []),
      ),
    );
    return children.flat().slice(0, MAX_AUDIT_PAGES * 3);
  }
  return Promise.all(
    locations
      .slice(0, MAX_AUDIT_PAGES * 3)
      .map((item) => normalizePublicUrl(item).catch(() => "")),
  ).then((items) => items.filter(Boolean));
}

async function fetchAuditPage(url: string): Promise<AuditPage> {
  const response = await safeGet(url);
  if (response.statusCode >= 400)
    throw new PublicUrlError(
      `Сайт вернул HTTP ${response.statusCode}${
        response.statusCode === 401 || response.statusCode === 403
          ? "; публичная страница недоступна без авторизации или заблокировала проверку."
          : "."
      }`,
    );
  const contentType = String(response.headers["content-type"] ?? "");
  if (!contentType.includes("text/html"))
    throw new PublicUrlError("URL не вернул HTML.");
  const html = response.body.toString("utf8");
  return parseAuditPage(response.url, response.statusCode, html);
}

export function parseAuditPage(
  url: string,
  statusCode: number,
  html: string,
): AuditPage {
  const text = (value: string) =>
    decodeHtml(value.replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
  const tags = (tag: string) =>
    [
      ...html.matchAll(
        new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"),
      ),
    ]
      .map((match) => text(match[1] ?? ""))
      .filter(Boolean);
  const title = tags("title")[0] ?? null;
  const meta = (name: string, attribute?: string) =>
    matchMeta(html, name, attribute);
  const canonicalRaw = matchLink(html, "canonical");
  const canonicalUrl = canonicalRaw ? absoluteUrl(url, canonicalRaw) : null;
  const links = extractLinks(html, url);
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((item) => item[0]);
  const headings = { h1: tags("h1"), h2: tags("h2"), h3: tags("h3") };
  const robots = meta("robots")?.toLowerCase() ?? "";
  const imagesWithoutAlt = images.filter(
    (tag) => !/\balt\s*=\s*["'][^"']*["']/i.test(tag),
  ).length;
  const hLevels = [...html.matchAll(/<h([1-6])\b/gi)].map((match) =>
    Number(match[1]),
  );
  return {
    url,
    statusCode,
    title,
    description: meta("description"),
    canonicalUrl,
    headings,
    links: links.filter((link) => sameOrigin(url, link)),
    externalLinks: links.filter((link) => !sameOrigin(url, link)),
    indexable: !/(^|,)\s*noindex\b/.test(robots),
    checks: {
      https: url.startsWith("https://"),
      viewport: Boolean(meta("viewport")),
      canonical: Boolean(canonicalRaw),
      robots: meta("robots"),
      ogTitle: Boolean(meta("og:title", "property")),
      ogDescription: Boolean(meta("og:description", "property")),
      ogImage: Boolean(meta("og:image", "property")),
      twitterCard: Boolean(meta("twitter:card")),
      jsonLd: /application\/ld\+json/i.test(html),
      images: images.length,
      imagesWithoutAlt,
      forms: (html.match(/<form\b/gi) ?? []).length,
      hLevels,
      h1Count: headings.h1.length,
      emptyAnchors: [...html.matchAll(/<a\b[^>]*href\s*=\s*["']\s*["']/gi)]
        .length,
    },
    html,
  };
}

/** Validates discovered JSON-LD against Schema.org and Google Rich Results rules. */
export async function validateStructuredData(html: string) {
  if (!/application\/ld\+json/i.test(html))
    return {
      found: false,
      available: true,
      issues: [] as Array<{ message: string; severity: string }>,
    };
  try {
    const [{ default: WebAutoExtractor }, { default: Validator }] =
      await Promise.all([
        import("@marbec/web-auto-extractor") as Promise<{
          default: new (options: Record<string, unknown>) => {
            parse(value: string): unknown;
          };
        }>,
        import("@adobe/structured-data-validator") as Promise<{
          default: new (schema: unknown) => {
            validate(
              value: unknown,
            ): Promise<Array<{ issueMessage?: string; severity?: string }>>;
          };
        }>,
      ]);
    schemaOrgPromise ??= safeGet(
      "https://schema.org/version/latest/schemaorg-all-https.jsonld",
      { accept: "application/ld+json,application/json", maxBytes: 8_000_000 },
    ).then((response) => JSON.parse(response.body.toString("utf8")));
    const schema = await schemaOrgPromise;
    const data = new WebAutoExtractor({
      addLocation: true,
      embedSource: ["rdfa", "microdata"],
    }).parse(html);
    const issues = await new Validator(schema).validate(data);
    return {
      found: true,
      available: true,
      issues: issues
        .map((issue) => ({
          message: issue.issueMessage || "Structured data validation issue",
          severity: issue.severity || "WARNING",
        }))
        .slice(0, 20),
    };
  } catch {
    return {
      found: true,
      available: false,
      issues: [] as Array<{ message: string; severity: string }>,
    };
  }
}

export function computeAudit(
  brief: AuditBriefInput,
  pages: AuditPage[],
  options: {
    robotsBlocked?: boolean;
    brokenLinks?: string[];
    browser?: Record<string, unknown>;
    performance?: Record<string, unknown>;
  } = {},
): AuditComputation {
  const findings: AuditFindingInput[] = [];
  const metrics: AuditMetricInput[] = [];
  const add = (item: AuditFindingInput) => findings.push(item);
  const homepage = pages[0];
  if (options.robotsBlocked)
    add(
      finding(
        "technical",
        "P1",
        "robots.txt запрещает аудит",
        "Сайт запретил автоматическому агенту доступ к страницам.",
        brief.url,
        "robots.txt содержит Disallow: /.",
        "Нельзя честно сформировать отчёт без доступа к публичным страницам.",
        "Разрешите безопасному аудитору чтение публичных страниц или проведите аудит вручную.",
        "Разработчику",
      ),
    );
  if (!pages.length) {
    add(
      finding(
        "technical",
        "P0",
        "Страницы сайта недоступны для анализа",
        "Не удалось получить ни одной публичной HTML-страницы.",
        brief.url,
        "Ответ не получен, HTML отсутствует.",
        "Технические и UX-выводы были бы выдуманными.",
        "Проверьте публичную доступность сайта, DNS и защиту от ботов.",
        "Разработчику",
      ),
    );
  }
  for (const page of pages) {
    const where = page.url;
    if ((page.statusCode ?? 0) >= 400)
      add(
        finding(
          "technical",
          "P1",
          "Страница возвращает ошибку",
          `Страница отвечает кодом ${page.statusCode}.`,
          where,
          `HTTP ${page.statusCode}.`,
          "Посетители и поисковые системы не получают содержимое страницы.",
          "Восстановите страницу или настройте корректное перенаправление.",
          "Разработчику",
        ),
      );
    if (!page.title)
      add(
        finding(
          "seo",
          "P1",
          "Не задан title страницы",
          "У страницы нет понятного заголовка для вкладки и поиска.",
          where,
          "Тег <title> отсутствует.",
          "Поисковой системе и пользователю сложнее понять тему страницы.",
          "Добавьте уникальный title с названием услуги и пользой.",
          "SEO",
          "15 минут",
        ),
      );
    if (!page.description)
      add(
        finding(
          "seo",
          "P2",
          "Не задано описание страницы",
          "Meta description отсутствует.",
          where,
          "Тег meta description отсутствует.",
          "Сниппет в поиске будет сформирован менее управляемо.",
          "Добавьте уникальное описание страницы; длина — ориентир, а не фактор ранжирования.",
          "SEO",
          "15 минут",
        ),
      );
    if ((page.checks.h1Count as number) !== 1)
      add(
        finding(
          "seo",
          "P1",
          "Нарушена структура H1",
          `На странице найдено H1: ${String(page.checks.h1Count)}.`,
          where,
          `H1 count = ${String(page.checks.h1Count)}.`,
          "Главная тема страницы считывается неоднозначно.",
          "Оставьте один H1, который прямо описывает страницу и задачу клиента.",
          "SEO",
          "15 минут",
        ),
      );
    if (!page.canonicalUrl)
      add(
        finding(
          "seo",
          "P2",
          "Canonical не настроен",
          "У страницы нет канонического URL.",
          where,
          "rel=canonical отсутствует.",
          "Поиску сложнее выбрать основной адрес при дублях или UTM-параметрах.",
          "Укажите self-referencing canonical для индексируемой страницы.",
          "Разработчику",
        ),
      );
    if ((page.checks.imagesWithoutAlt as number) > 0)
      add(
        finding(
          "accessibility",
          "P2",
          "У изображений нет текстовой альтернативы",
          `Без alt найдено изображений: ${page.checks.imagesWithoutAlt}.`,
          where,
          `img without alt = ${page.checks.imagesWithoutAlt}.`,
          "Смысловые изображения недоступны части посетителей и хуже понятны поиску.",
          "Добавьте осмысленные alt для смысловых изображений; декоративные пометьте пустым alt.",
          "Контент",
          "1–2 часа",
        ),
      );
    if (!page.checks.viewport)
      add(
        finding(
          "ux",
          "P1",
          "Не задан mobile viewport",
          "Мобильный браузер может масштабировать страницу некорректно.",
          where,
          "meta viewport отсутствует.",
          "Это ухудшает читаемость и конверсию с телефона.",
          'Добавьте стандартный meta name="viewport" content="width=device-width, initial-scale=1".',
          "Разработчику",
          "15 минут",
        ),
      );
    if (!page.indexable)
      add(
        finding(
          "seo",
          "P1",
          "Страница закрыта от индексации",
          "В robots meta указан noindex.",
          where,
          `robots = ${String(page.checks.robots ?? "noindex")}.`,
          "Страница не сможет участвовать в органической выдаче.",
          "Уберите noindex, если это не намеренная служебная или закрытая страница.",
          "SEO",
        ),
      );
    if (!page.checks.jsonLd)
      add(
        finding(
          "structured-data",
          "P3",
          "Структурированные данные не найдены",
          "JSON-LD Schema.org не обнаружен.",
          where,
          'script[type="application/ld+json"] отсутствует.',
          "Поиску доступно меньше явных данных о компании и странице.",
          "Добавьте только релевантную Schema.org-разметку и проверьте её валидатором.",
          "SEO",
        ),
      );
    if (
      !page.checks.ogTitle ||
      !page.checks.ogDescription ||
      !page.checks.ogImage
    )
      add(
        finding(
          "seo",
          "P3",
          "Open Graph заполнен не полностью",
          "Для предпросмотра в социальных сетях не хватает OG-полей.",
          where,
          `og:title: ${page.checks.ogTitle ? "есть" : "нет"}; og:description: ${page.checks.ogDescription ? "есть" : "нет"}; og:image: ${page.checks.ogImage ? "есть" : "нет"}.`,
          "Ссылка на сайт может выглядеть менее убедительно в мессенджерах и соцсетях.",
          "Заполните og:title, og:description, og:image и og:url на важных страницах.",
          "Маркетолог",
        ),
      );
    if ((page.checks.emptyAnchors as number) > 0)
      add(
        finding(
          "links",
          "P2",
          "Найдены пустые ссылки",
          "Ссылка не содержит полезного адреса.",
          where,
          `Пустых href: ${page.checks.emptyAnchors}.`,
          "Клавиатурная навигация и пользовательский путь становятся непредсказуемыми.",
          "Замените пустую ссылку на кнопку или укажите корректный URL.",
          "Разработчику",
        ),
      );
    const visibleText = decodeHtml(
      page.html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, ""),
    )
      .replace(/\s+/g, " ")
      .trim();
    if (visibleText.length < 250)
      add(
        finding(
          "content",
          "P2",
          "На странице мало содержательного текста",
          "Страница выглядит слишком короткой для объяснения предложения и доверия.",
          where,
          `В доступном HTML около ${visibleText.length} символов текста.`,
          "Пользователю и поиску может не хватить контекста о продукте, выгодах и следующем шаге.",
          "Добавьте конкретные выгоды, ответы на вопросы, доказательства и понятный CTA.",
          "Маркетолог",
        ),
      );
  }
  for (const [label, field] of [
    ["title", "title"],
    ["meta description", "description"],
  ] as const) {
    const groups = new Map<string, AuditPage[]>();
    for (const page of pages) {
      const value = page[field]?.trim();
      if (value) groups.set(value, [...(groups.get(value) ?? []), page]);
    }
    for (const [value, group] of groups)
      if (group.length > 1)
        add(
          finding(
            "seo",
            "P2",
            `Повторяется ${label}`,
            `Одинаковое значение найдено на ${group.length} страницах.`,
            group.map((page) => page.url).join("\n"),
            `${label}: «${value.slice(0, 180)}».`,
            "Поиску сложнее различать назначение страниц.",
            `Сделайте ${label} уникальным для каждой индексируемой страницы.`,
            "SEO",
          ),
        );
  }
  if (
    homepage &&
    !/\b(о компании|контакт|отзыв|кейс|лицензи|сертификат|политик|реквизит)/i.test(
      homepage.html,
    )
  )
    add(
      finding(
        "trust",
        "P2",
        "На главной не видно базовых сигналов доверия",
        "В доступном HTML главной не обнаружены привычные доказательства надёжности.",
        homepage.url,
        "Не найдены явные упоминания контактов, компании, кейсов, отзывов, лицензий или политики.",
        "Для B2B и услуг посетителю сложнее оценить, кому он оставляет заявку.",
        "Добавьте проверяемые контакты, сведения о компании и релевантные доказательства: кейсы, отзывы, экспертизу или лицензии.",
        "Маркетолог",
      ),
    );
  const hero = homepage ? heroAssessment(homepage, brief) : null;
  if (hero) findings.push(...hero.findings);
  for (const broken of options.brokenLinks ?? [])
    add(
      finding(
        "links",
        "P1",
        "Битая ссылка",
        "Ссылка ведёт на недоступный ресурс.",
        homepage?.url ?? brief.url,
        broken,
        "Переход по ссылке вернул ошибку или не удался.",
        "Ломает путь пользователя и расходует crawl budget.",
        "Исправьте ссылку, восстановите страницу или поставьте корректный redirect.",
        "Разработчику",
      ),
    );
  const categories = [
    scoreCategory("seo", "SEO", pages, findings, 14),
    scoreCategory("technical", "Техническое состояние", pages, findings, 8),
    scoreCategory("accessibility", "Доступность", pages, findings, 6),
    scoreCategory("ux", "UX и конверсия", pages, findings, 6),
    scoreCategory("content", "Контент", pages, findings, 5),
    scoreCategory("trust", "Доверие", pages, findings, 4),
  ];
  if (options.performance && typeof options.performance.score === "number")
    categories.push({
      id: "performance",
      label: "Скорость",
      value: Math.round(Number(options.performance.score) * 100),
      applicable: 1,
      findingCount: 0,
      origin: "Lighthouse laboratory measurement",
    });
  metrics.push(
    ...categories.map((score) => ({
      category: score.id,
      metricKey: `score_${score.id}`,
      label: score.label,
      value: score.value,
      unit: "/100",
      evidenceKind: "COMPUTED" as const,
      source: score.origin,
    })),
  );
  metrics.push({
    category: "coverage",
    metricKey: "pages_checked",
    label: "Проверено страниц",
    value: pages.length,
    unit: "pages",
    evidenceKind: "MEASURED",
    source: "safe crawl",
  });
  return {
    pages,
    findings: dedupeFindings(findings),
    metrics,
    scores: categories,
    summary: {
      executiveSummary: pages.length
        ? `Проверено страниц: ${pages.length}. В первую очередь устраните проблемы с высоким приоритетом и проверьте первый экран под задачу «${brief.primaryAction || brief.primaryGoal || "основное действие"}».`
        : "Отчёт не сформирован: публичные страницы недоступны для безопасного чтения.",
      audience: audienceSummary(brief, homepage),
      topPriorities: dedupeFindings(findings)
        .filter((item) => item.severity === "P0" || item.severity === "P1")
        .slice(0, 5),
      methodology:
        "Баллы строятся только из применимых deterministic checks и лабораторных измерений. UX-оценки явно помечаются отдельно.",
      fieldData: "Недостаточно полевых данных: CrUX не подключён.",
      gsc: "Search Console не подключена — поисковые данные не учитывались.",
    },
  };
}

function scoreCategory(
  id: string,
  label: string,
  pages: AuditPage[],
  findings: AuditFindingInput[],
  applicable: number,
) {
  const relevant = findings.filter((item) => item.category === id);
  const deduction = relevant.reduce(
    (total, item) => total + { P0: 45, P1: 25, P2: 12, P3: 5 }[item.severity],
    0,
  );
  const value = Math.max(
    0,
    Math.min(100, 100 - Math.round(deduction / Math.max(1, pages.length))),
  );
  return {
    id,
    label,
    value,
    applicable,
    findingCount: relevant.length,
    origin: "weighted deterministic checks",
  };
}

function heroAssessment(page: AuditPage, brief: AuditBriefInput) {
  const findings: AuditFindingInput[] = [];
  const h1 = page.headings.h1[0] ?? "";
  const firstText = decodeHtml(
    page.html.replace(/<script[\s\S]*?<\/script>/gi, "").slice(0, 8000),
  ).replace(/\s+/g, " ");
  const cta =
    /\b(оставить заявку|получить|заказать|купить|записаться|связаться|начать|консультац)/i.test(
      firstText,
    );
  if (!h1)
    findings.push(
      finding(
        "ux",
        "P1",
        "Первый экран не объясняет предложение",
        "На первом экране не найден H1.",
        page.url,
        "H1 отсутствует.",
        "Посетителю трудно понять, что именно предлагает компания в первые секунды.",
        `Сформулируйте H1 через услугу и пользу для ${brief.targetAudience || "основного клиента"}.`,
        "Маркетолог",
        "1–2 часа",
      ),
    );
  if (!cta)
    findings.push(
      finding(
        "ux",
        "P1",
        "На первом экране не видно основного действия",
        "В верхней части HTML не найдено явного CTA.",
        page.url,
        "Кнопка или ссылка с конверсионным действием не обнаружена.",
        "Пользователь может уйти, не понимая следующего шага.",
        `Добавьте заметный CTA «${brief.primaryAction || "Получить консультацию"}» рядом с главным предложением.`,
        "Дизайнер",
        "1–2 часа",
      ),
    );
  if (brief.primaryGoal && h1 && !includesMeaning(h1, brief.primaryGoal))
    findings.push(
      finding(
        "content",
        "P2",
        "Hero не связан с задачей бизнеса",
        "Формулировка H1 не отражает выбранную главную цель.",
        page.url,
        `H1: «${h1}»; цель: «${brief.primaryGoal}».`,
        "Сообщение сайта может не поддерживать ожидаемое действие.",
        `Проверьте H1 и подзаголовок: они должны вести к цели «${brief.primaryGoal}».`,
        "Маркетолог",
      ),
    );
  return { findings };
}

function audienceSummary(brief: AuditBriefInput, home?: AuditPage) {
  const audience =
    brief.targetAudience?.trim() || "Аудитория не описана в brief.";
  const offer = home?.headings.h1[0] || home?.title || "Оффер не найден.";
  return {
    primaryUser: audience,
    looksFor: brief.primaryGoal || "Понятный следующий шаг",
    concerns: brief.mainProblem || "Не указано в brief",
    shouldConvince: brief.primaryAction || "Понятное целевое действие",
    currentOffer: offer,
  };
}

function finding(
  category: string,
  severity: AuditFindingInput["severity"],
  title: string,
  findingText: string,
  location: string,
  evidence: string,
  impact: string,
  recommendation: string,
  ownerRole?: string,
  effort?: string,
): AuditFindingInput {
  return {
    category,
    severity,
    evidenceKind: "COMPUTED",
    title,
    finding: findingText,
    location,
    evidence,
    impact,
    recommendation,
    ...(ownerRole ? { ownerRole } : {}),
    ...(effort ? { effort } : {}),
  };
}

function dedupeFindings(items: AuditFindingInput[]) {
  const keys = new Set<string>();
  return items.filter((item) => {
    const key = `${item.title}:${item.location ?? ""}`;
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

function includesMeaning(text: string, value: string) {
  const significant = value
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 3);
  return significant.some((word) => text.toLowerCase().includes(word));
}

function extractLinks(html: string, base: string) {
  return [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#][^"']*)["']/gi)]
    .map((match) => absoluteUrl(base, match[1] ?? ""))
    .filter((item): item is string => Boolean(item));
}

function absoluteUrl(base: string, value: string) {
  try {
    const url = new URL(value, base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function sameOrigin(first: string, second: string) {
  try {
    return new URL(first).origin === new URL(second).origin;
  } catch {
    return false;
  }
}

function matchMeta(html: string, name: string, attribute = "name") {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direct = new RegExp(
    `<meta[^>]+${attribute}=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
    "i",
  ).exec(html)?.[1];
  const reverse = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+${attribute}=["']${escaped}["']`,
    "i",
  ).exec(html)?.[1];
  return direct ?? reverse ?? null;
}

function matchLink(html: string, rel: string) {
  return (
    new RegExp(
      `<link[^>]+rel=["']${rel}["'][^>]+href=["']([^"']+)["']`,
      "i",
    ).exec(html)?.[1] ??
    new RegExp(
      `<link[^>]+href=["']([^"']+)["'][^>]+rel=["']${rel}["']`,
      "i",
    ).exec(html)?.[1] ??
    null
  );
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function performanceReportNotes(metrics?: AuditMetricInput[]) {
  const desktopPerformance = metrics?.find(
    (metric) => metric.metricKey === "desktop_measurement_state",
  );
  const mobilePerformance = metrics?.find(
    (metric) => metric.metricKey === "mobile_lighthouse_performance",
  );
  return {
    desktop:
      desktopPerformance?.value === "measurement_failed"
        ? "Desktop performance — измерение недоступно. Страница загрузилась, но браузер проверки не зафиксировал визуальную отрисовку."
        : desktopPerformance?.value === "partial"
          ? "Desktop performance — доступна только часть измерений."
          : null,
    mobile:
      typeof mobilePerformance?.value === "number"
        ? `Mobile performance — ${Math.round(mobilePerformance.value)} / 100 по лабораторному измерению Lighthouse.`
        : null,
  };
}

export async function buildAuditDocx(input: {
  url: string;
  createdAt: Date;
  brief: AuditBriefInput;
  scores: AuditComputation["scores"];
  metrics?: AuditMetricInput[];
  findings: AuditFindingInput[];
  summary: Record<string, unknown>;
  screenshot?: Buffer;
}): Promise<Buffer> {
  const headline = String(
    input.summary.executiveSummary ?? "Результаты аудита сайта.",
  );
  const rows = input.scores.map(
    (score) =>
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph(score.label)] }),
          new TableCell({
            children: [
              new Paragraph({
                text: `${score.value} / 100`,
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
          new TableCell({
            children: [
              new Paragraph(
                score.id === "performance"
                  ? "Лабораторное измерение Lighthouse"
                  : `${score.applicable} контрольных областей; ${score.findingCount ?? 0} проблем повлияли на оценку`,
              ),
            ],
          }),
        ],
      }),
  );
  const priority = input.findings
    .filter((item) => item.severity === "P0" || item.severity === "P1")
    .slice(0, 8);
  const performanceNotes = performanceReportNotes(input.metrics);
  const children = [
    new Paragraph({ text: "HOLYMEDIA MCP", heading: HeadingLevel.TITLE }),
    new Paragraph({ text: "AI-аудит сайта", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: input.url }),
    new Paragraph({
      text: `Дата: ${input.createdAt.toLocaleDateString("ru-RU")}`,
    }),
    new Paragraph({ text: "Краткий вывод", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: headline }),
    new Paragraph({ text: "Brief", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      text: `Компания: ${input.brief.companyName || "не указана"}\nСфера: ${input.brief.industry || "не указана"}\nЦель: ${input.brief.primaryGoal || "не указана"}\nЦелевое действие: ${input.brief.primaryAction || "не указано"}`,
    }),
    new Paragraph({
      text: "Оценки и методика",
      heading: HeadingLevel.HEADING_1,
    }),
    new Paragraph({
      text: "Каждая оценка построена из измеренных или детерминированно вычисленных проверок; экспертные AI-оценки маркируются отдельно.",
    }),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      rows: [
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph("Категория")] }),
            new TableCell({ children: [new Paragraph("Балл")] }),
            new TableCell({ children: [new Paragraph("Происхождение")] }),
          ],
        }),
        ...rows,
      ],
    }),
    ...(performanceNotes.mobile || performanceNotes.desktop
      ? [
          new Paragraph({
            text: "Performance measurements",
            heading: HeadingLevel.HEADING_2,
          }),
          ...(performanceNotes.mobile
            ? [new Paragraph({ text: performanceNotes.mobile })]
            : []),
          ...(performanceNotes.desktop
            ? [new Paragraph({ text: performanceNotes.desktop })]
            : []),
        ]
      : []),
    new Paragraph({
      text: "Что исправить в первую очередь",
      heading: HeadingLevel.HEADING_1,
    }),
    ...priority.flatMap((item) => [
      new Paragraph({
        text: `${item.severity} · ${item.title}`,
        heading: HeadingLevel.HEADING_2,
      }),
      new Paragraph({
        text: `Что найдено: ${item.finding}\nГде: ${item.location || "—"}\nEvidence: ${item.evidence}\nПочему это проблема: ${item.impact}\nЧто сделать: ${item.recommendation}\nИсполнитель: ${item.ownerRole || "—"} · Сложность: ${item.effort || "требует оценки"}`,
      }),
    ]),
  ];
  if (input.screenshot)
    children.splice(
      8,
      0,
      new Paragraph({ text: "Первый экран", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({
        children: [
          new ImageRun({
            data: input.screenshot,
            type: "png",
            transformation: { width: 600, height: 375 },
            altText: {
              title: "Первый экран сайта",
              description: "Скриншот первого экрана сайта",
              name: "site-first-screen",
            },
          }),
        ],
      }),
    );
  children.push(
    new Paragraph({
      text: "Визуальный анализ",
      heading: HeadingLevel.HEADING_1,
    }),
    new Paragraph({
      text: "Первый экран оценивается по доступным DOM-элементам и скриншоту. Субъективные выводы отдельно помечаются как экспертная AI-оценка; измеренные технические факты не смешиваются с ними.",
    }),
  );
  const sections = [
    ["Техническое SEO", ["seo", "technical"]],
    ["Скорость", ["performance"]],
    ["UX и конверсия", ["ux"]],
    ["Контент", ["content"]],
    ["Доверие и E-E-A-T", ["trust"]],
    ["Доступность", ["accessibility"]],
    ["Ссылки", ["links"]],
    ["Структурированные данные", ["structured-data"]],
  ] as const;
  for (const [label, categories] of sections) {
    const entries = input.findings.filter((item) =>
      (categories as readonly string[]).includes(item.category),
    );
    children.push(
      new Paragraph({ text: label, heading: HeadingLevel.HEADING_1 }),
    );
    if (!entries.length) {
      children.push(
        new Paragraph({
          text: "На доступных страницах не найдено проблем этой категории, которые можно подтвердить текущими проверками.",
        }),
      );
      continue;
    }
    children.push(
      ...entries.slice(0, 15).flatMap((item) => [
        new Paragraph({
          text: `${item.severity} · ${item.title}`,
          heading: HeadingLevel.HEADING_2,
        }),
        new Paragraph({
          text: `Где: ${item.location || "страница сайта"}\nEvidence: ${item.evidence}\nПочему важно: ${item.impact}\nРекомендация: ${item.recommendation}\nОснование: ${evidenceLabel(item.evidenceKind)}.`,
        }),
      ]),
    );
  }
  children.push(
    new Paragraph({ text: "Конкуренты", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: competitorText(input.summary.competitors) }),
    new Paragraph({
      text: "Google Search Console",
      heading: HeadingLevel.HEADING_1,
    }),
    new Paragraph({
      text: String(
        input.summary.gsc ??
          "Search Console не подключена — поисковые данные не учитывались.",
      ),
    }),
    new Paragraph({ text: "Roadmap", heading: HeadingLevel.HEADING_1 }),
    ...priority.map(
      (item, index) =>
        new Paragraph({
          text: `${index + 1}. ${item.title} — ${item.ownerRole || "команде"}${item.effort ? `, ${item.effort}` : ""}.`,
          numbering: { reference: "default-numbering", level: 0 },
        }),
    ),
    new Paragraph({
      text: "Техническое приложение",
      heading: HeadingLevel.HEADING_1,
    }),
    new Paragraph({
      text: "Аудитор работал read-only: не отправлял формы, не выполнял вход и не изменял сайт. Рекомендации основаны на доступных публичных страницах и могут требовать ручной проверки перед внедрением.",
    }),
  );
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

function evidenceLabel(kind: AuditFindingInput["evidenceKind"]) {
  return kind === "MEASURED"
    ? "измерено инструментом"
    : kind === "AI_ASSESSMENT"
      ? "экспертная AI-оценка"
      : "вычислено по правилам";
}
function competitorText(value: unknown) {
  if (!Array.isArray(value) || !value.length)
    return "Конкуренты не были указаны в brief.";
  return value
    .map((item) => {
      const row =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};
      return `${String(row.url ?? "Конкурент")}: ${String(row.status ?? "не проверен")}.`;
    })
    .join(" ");
}
