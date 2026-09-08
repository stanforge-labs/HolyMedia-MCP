"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  businessMemberTitleLabel,
  FULL_ACCESS_LIFETIME_GRANT,
  tariffPresentation,
} from "@holymedia/contracts";
import { BrandLockup } from "../../components/brand-lockup";
import { SiteFooter } from "../../components/site-footer";
import {
  LanguageSwitcher,
  useLanguage,
} from "../../components/language-switcher";
import { FeedbackBlock } from "../../components/feedback-block";
import { TariffCatalog } from "../../components/tariff-catalog";
import { SubscriptionInfo } from "../../components/subscription-info";
import { ProjectSelect } from "../../components/project-select";
import { SiteAuditV3 } from "../../components/site-audit-v3";
import {
  dashboardRoute,
  dashboardSectionFromLegacyQuery,
  dashboardSectionFromPath,
  type DashboardSection,
} from "../../components/dashboard-routes";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const MCP_URL = "https://mcp.holymedia.kz/mcp";
// Product pause only: audit services, history and private artifacts remain intact.
const SITE_AUDIT_PRODUCT_ENABLED = false;

type Workspace = {
  id: string;
  name: string;
  slug: string;
  role: string;
  accessStatus: "PENDING" | "ACTIVE" | "SUSPENDED";
};
type Provider = {
  id: string;
  displayName: string;
  status: string;
  oauth: boolean;
};
type ProviderAccount = {
  id: string;
  externalAccountId: string;
  displayName: string;
  accountName?: string | null;
  currency?: string | null;
  timezone?: string | null;
  enabled: boolean;
  status: string | null;
};
type Connection = {
  id: string;
  provider: string;
  displayName: string | null;
  status: string;
  accounts: ProviderAccount[];
};
type ServiceToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  accountIds: string[];
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
};
type Profile = { name: string; email: string };
type BillingSubscription = {
  status?: string;
  startsAt?: string | null;
  currentPeriodEnd?: string | null;
  trialEndsAt?: string | null;
  metadata?: Record<string, unknown> | null;
  plan?: { key?: string; name?: string } | null;
};
type Section = DashboardSection;
type Client = "codex" | "claude" | "chatgpt";
type ReportFormat = "docx" | "pptx";
type ReportableAccount = { account: ProviderAccount; connection: Connection };
type ReportMetric = {
  amount?: string;
  currency?: string;
} | null;
type ReportPreview = {
  period: { startDate: string; endDate: string };
  account: {
    provider: string;
    externalAccountId: string;
    name: string;
    currency: string | null;
  };
  metrics: {
    spend: ReportMetric;
    impressions: number | null;
    clicks: number | null;
    ctr: number | null;
    conversions: number | null;
    costPerConversion: ReportMetric;
  };
  campaigns: Array<{
    id: string;
    name: string;
    status: string | null;
    metrics?: {
      spend?: ReportMetric;
      clicks?: number | null;
      conversions?: number | null;
    };
  }>;
  insights: string[];
  provenance: {
    summary: { sourceApi: string; realData: boolean; dataStatus: string };
  };
};
type AnalysisMode = "quick" | "full";
type AnalysisBrief = {
  siteType: string;
  goal: string;
  audience: string;
  region: string;
  competitor: string;
  concern: string;
};
type AnalysisItem = {
  priority?: string;
  title?: string;
  problem?: string;
  evidence?: string;
  recommendation?: string;
};
type SiteAnalysis = {
  id: string;
  url: string;
  result: {
    status?: number;
    title?: string | null;
    description?: string | null;
    h1Count?: number;
    h2Count?: number;
    linkCount?: number;
    imageCount?: number;
    formCount?: number;
    scores?: Array<{
      id: string;
      label: string;
      value: number;
      description: string;
    }>;
    overview?: { verdict?: string; mainRisk?: string; quickWin?: string };
    topIssues?: AnalysisItem[];
    quickWins?: Array<{ title?: string }>;
    hero?: { h1?: string; subtitle?: string; cta?: string };
    structure?: string[];
    oneDayPlan?: Array<{ step?: number; title?: string }>;
    questions?: string[];
    evidence?: { limitations?: string };
    checks?: {
      https?: boolean;
      hasTitle?: boolean;
      hasDescription?: boolean;
      hasSingleH1?: boolean;
    };
  };
  created_at: string;
};
type ConfirmAction = {
  title: string;
  description: string;
  confirmLabel: string;
  run: () => Promise<void>;
};

type TokenLifecycle = {
  label: string;
  tone: "active" | "revoked" | "expired";
  createdLabel: string;
  expiryLabel: string;
};

const PROVIDER_COPY: Record<
  string,
  { name: string; description: string; short: string }
> = {
  GOOGLE_ADS: {
    name: "Google Ads",
    short: "G",
    description: "Кампании, расходы, клики и конверсии.",
  },
  META_ADS: {
    name: "Meta Ads",
    short: "M",
    description: "Facebook, Instagram, кампании и результаты.",
  },
  YANDEX_DIRECT: {
    name: "Яндекс Директ",
    short: "Я",
    description: "Клиенты и рекламные кабинеты Директа.",
  },
  TIKTOK_ADS: {
    name: "TikTok Ads",
    short: "T",
    description: "Доступные рекламные аккаунты TikTok.",
  },
  GOOGLE_SEARCH_CONSOLE: {
    name: "Google Search Console",
    short: "S",
    description: "Данные поиска и страницы сайта.",
  },
  GOOGLE_ANALYTICS: {
    name: "Google Analytics",
    short: "GA",
    description:
      "Анализируйте трафик сайта, источники, страницы, события и ключевые действия через AI.",
  },
};

async function csrf(): Promise<string> {
  const response = await fetch(`${API}/api/v1/auth/csrf`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Не удалось подтвердить сессию.");
  return ((await response.json()) as { csrfToken: string }).csrfToken;
}

function dateRange(days: number) {
  const end = new Date(Date.now() - 86_400_000);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function reportErrorMessage(status: number, phase: "preview" | "download") {
  const action =
    phase === "preview" ? "получить данные отчёта" : "собрать отчёт";
  const messages: Record<number, string> = {
    400: "Для отчёта выберите подключённый кабинет Meta Ads или Google Ads.",
    401: "Сессия закончилась. Войдите ещё раз.",
    403: "Отчёты недоступны для этого кабинета или тарифа.",
    404: "Кабинет больше недоступен. Обновите подключения и выберите его заново.",
    409: "Платформа требует повторного входа. Переподключите её в разделе «Подключения».",
    429: "Слишком много запросов. Повторите попытку через минуту.",
    503: "Рекламная платформа временно не ответила. Повторите попытку позже.",
  };
  return messages[status] ?? `Не удалось ${action}. Попробуйте ещё раз.`;
}

function formatReportNumber(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "Нет данных"
    : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(
        value,
      );
}

function formatReportMoney(value: ReportMetric): string {
  if (!value?.amount) return "Нет данных";
  return `${formatReportNumber(Number(value.amount))} ${value.currency ?? ""}`.trim();
}

function providerCopy(provider: string) {
  return (
    PROVIDER_COPY[provider] ?? {
      name: provider,
      short: provider.charAt(0),
      description: "Рекламная платформа.",
    }
  );
}

function oauthFailureMessage(provider: string | null, reason: string | null) {
  const name = providerCopy(provider ?? "").name;
  if (reason === "insufficient_permissions") {
    if (provider === "META_ADS")
      return "Meta не выдала нужные разрешения. Проверьте права приложения и доступ пользователя.";
    if (provider === "TIKTOK_ADS")
      return "TikTok не выдал запрошенные разрешения. Проверьте одобрение приложения и права пользователя.";
    return `${name} не выдала запрошенные разрешения. Проверьте настройки приложения и права пользователя.`;
  }
  if (reason === "authorization_denied")
    return `Авторизация ${name} отменена. Разрешите доступ и попробуйте ещё раз.`;
  if (reason === "provider_not_configured")
    return `${name} пока не настроена на сервере. Обратитесь к оператору.`;
  if (reason === "invalid_callback")
    return `${name} вернула неполный ответ авторизации. Запустите подключение заново.`;
  if (reason === "authentication_failed")
    return `${name} не подтвердила авторизацию. Проверьте аккаунт и повторите вход.`;
  return `Подключение ${name} не завершено. Проверьте настройки приложения и попробуйте ещё раз.`;
}

async function responseErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string };
      message?: string;
    };
    return payload.error?.message || payload.message || fallback;
  } catch {
    return fallback;
  }
}

function connectionStatus(status: string) {
  if (status === "CONNECTED") return { label: "Подключено", tone: "ok" };
  if (status === "DEGRADED") return { label: "Нужно проверить", tone: "warn" };
  if (status === "REAUTH_REQUIRED")
    return { label: "Нужно войти снова", tone: "warn" };
  if (status === "ERROR") return { label: "Ошибка подключения", tone: "err" };
  return { label: "Не подключено", tone: "info" };
}

function isInactiveProviderAccount(status: string | null) {
  return ["DISABLED", "INACTIVE", "CLOSED", "SUSPENDED", "ARCHIVED"].includes(
    (status ?? "").toUpperCase(),
  );
}

function reportAccountStatus(status: string | null) {
  switch ((status ?? "").trim().toUpperCase()) {
    case "ACTIVE":
    case "ENABLED":
    case "OPEN":
    case "LIVE":
      return { label: "Активен", tone: "active", inactive: false };
    case "CANCELED":
    case "CANCELLED":
    case "INACTIVE":
    case "DISABLED":
    case "CLOSED":
    case "SUSPENDED":
    case "ARCHIVED":
      return { label: "Не используется", tone: "inactive", inactive: true };
    case "PAUSED":
      return { label: "Приостановлен", tone: "neutral", inactive: false };
    case "PENDING":
      return { label: "Ожидает запуска", tone: "neutral", inactive: false };
    default:
      return { label: "Статус неизвестен", tone: "neutral", inactive: false };
  }
}

function tokenDisplayName(token: ServiceToken, language: "ru" | "en") {
  const name = token.name.trim();
  if (!name || /^personal mcp token$/i.test(name))
    return language === "ru" ? "Без названия" : "Untitled";
  return name;
}

function tokenLifecycle(
  token: ServiceToken,
  language: "ru" | "en",
): TokenLifecycle {
  const locale = language === "ru" ? "ru-RU" : "en-GB";
  const date = (value: string) =>
    new Date(value).toLocaleDateString(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  const createdLabel =
    language === "ru"
      ? `Создан ${date(token.createdAt)}`
      : `Created ${date(token.createdAt)}`;

  if (token.revokedAt)
    return {
      label: language === "ru" ? "Отозван" : "Revoked",
      tone: "revoked",
      createdLabel,
      expiryLabel: token.expiresAt
        ? language === "ru"
          ? `Действовал до ${date(token.expiresAt)}`
          : `Expired on ${date(token.expiresAt)}`
        : language === "ru"
          ? "Бессрочный до отзыва"
          : "No expiration before revocation",
    };

  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now())
    return {
      label: language === "ru" ? "Истёк" : "Expired",
      tone: "expired",
      createdLabel,
      expiryLabel:
        language === "ru"
          ? `Истёк ${date(token.expiresAt)}`
          : `Expired ${date(token.expiresAt)}`,
    };

  return {
    label: language === "ru" ? "Активен" : "Active",
    tone: "active",
    createdLabel,
    expiryLabel: token.expiresAt
      ? language === "ru"
        ? `Действует до ${date(token.expiresAt)}`
        : `Expires ${date(token.expiresAt)}`
      : language === "ru"
        ? "Бессрочно"
        : "No expiration",
  };
}

export default function DashboardPage() {
  const language = useLanguage();
  const pathname = usePathname();
  const router = useRouter();
  const deleteKeyCopy =
    language === "en"
      ? {
          action: "Delete key",
          success: "Key deleted.",
          failure: "Couldn't delete the key.",
          title: (name: string) => `Delete key “${name}”?`,
          description:
            "The AI client will lose access with this key. It can't be restored.",
        }
      : {
          action: "Удалить ключ",
          success: "Ключ удалён.",
          failure: "Не удалось удалить ключ.",
          title: (name: string) => `Удалить ключ «${name}»?`,
          description:
            "AI-клиент с этим ключом потеряет доступ. Восстановить ключ нельзя.",
        };
  const [active, setActive] = useState<Workspace | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [tokens, setTokens] = useState<ServiceToken[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [subscription, setSubscription] = useState<BillingSubscription | null>(
    null,
  );
  const [profileName, setProfileName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const section = dashboardSectionFromPath(pathname);
  const setSection = (next: Section) =>
    router.push(dashboardRoute(next) as never);

  useEffect(() => {
    document.title =
      language === "en"
        ? "HolyMedia MCP — Dashboard"
        : "HolyMedia MCP — Личный кабинет";
  }, [language, section]);

  const [client, setClient] = useState<Client>("codex");
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [openAccountsId, setOpenAccountsId] = useState<string | null>(null);
  const [accountSearch, setAccountSearch] = useState("");
  const [highlightedProvider, setHighlightedProvider] = useState<string | null>(
    null,
  );
  const [savingAccounts, setSavingAccounts] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [tokenAccessMode, setTokenAccessMode] = useState("read_only");
  const [editingTokenId, setEditingTokenId] = useState<string | null>(null);
  const [tokenNameDraft, setTokenNameDraft] = useState("");
  const [tokenActionId, setTokenActionId] = useState<string | null>(null);
  const [reportDays, setReportDays] = useState(7);
  const [reportAccountId, setReportAccountId] = useState("");
  const [reportFormat, setReportFormat] = useState<ReportFormat>("docx");
  const [reportPickerOpen, setReportPickerOpen] = useState(false);
  const [reportPickerProvider, setReportPickerProvider] = useState<
    string | null
  >(null);
  const [reportAccountSearch, setReportAccountSearch] = useState("");
  const [reportPreview, setReportPreview] = useState<ReportPreview | null>(
    null,
  );
  const [reportPreviewBusy, setReportPreviewBusy] = useState(false);
  const [reportPreviewError, setReportPreviewError] = useState("");
  const [reportDownloadError, setReportDownloadError] = useState("");
  const reportAccountTriggerRef = useRef<HTMLButtonElement>(null);
  const [analysisUrl, setAnalysisUrl] = useState("");
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("quick");
  const [analysisBrief, setAnalysisBrief] = useState<AnalysisBrief>({
    siteType: "",
    goal: "",
    audience: "",
    region: "",
    competitor: "",
    concern: "",
  });
  const [analysisTab, setAnalysisTab] = useState<
    "priorities" | "hero" | "plan" | "details"
  >("priorities");
  const [analysisStage, setAnalysisStage] = useState(0);
  const [analysisHistory, setAnalysisHistory] = useState<SiteAnalysis[]>([]);
  const [analysisResult, setAnalysisResult] = useState<SiteAnalysis | null>(
    null,
  );
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [oauthPendingProvider, setOauthPendingProvider] = useState<
    string | null
  >(null);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);

  const canManage = Boolean(active && ["OWNER", "ADMIN"].includes(active.role));
  const accessBlocked = Boolean(active && active.accessStatus !== "ACTIVE");
  const enabledAccounts = useMemo(
    () =>
      connections.flatMap((connection) =>
        ["CONNECTED", "DEGRADED", "REAUTH_REQUIRED"].includes(connection.status)
          ? connection.accounts
              .filter((account) => account.enabled)
              .map((account) => ({ account, connection }))
          : [],
      ),
    [connections],
  );
  const reportableAccounts = useMemo(
    () =>
      enabledAccounts.filter(
        ({ connection }) =>
          connection.status === "CONNECTED" &&
          ["META_ADS", "GOOGLE_ADS"].includes(connection.provider),
      ),
    [enabledAccounts],
  );
  const reportPickerConnections = useMemo(
    () =>
      ["GOOGLE_ADS", "META_ADS", "YANDEX_DIRECT", "TIKTOK_ADS"]
        .map((provider) =>
          connections.find((connection) => connection.provider === provider),
        )
        .filter((connection): connection is Connection => Boolean(connection)),
    [connections],
  );
  const selectedReportAccount = useMemo(
    () =>
      reportableAccounts.find(
        ({ account }) => account.id === reportAccountId,
      ) ?? null,
    [reportAccountId, reportableAccounts],
  );
  const reportPickerConnection =
    reportPickerConnections.find(
      (connection) => connection.provider === reportPickerProvider,
    ) ?? null;
  const reportPickerAccounts = useMemo(() => {
    if (!reportPickerConnection) return [];
    const needle = reportAccountSearch.trim().toLocaleLowerCase();
    return reportPickerConnection.accounts.filter((account) => {
      const reportable = reportableAccounts.some(
        (item) => item.account.id === account.id,
      );
      return (
        reportable &&
        (!needle ||
          account.displayName.toLocaleLowerCase().includes(needle) ||
          account.externalAccountId.toLocaleLowerCase().includes(needle))
      );
    });
  }, [reportAccountSearch, reportPickerConnection, reportableAccounts]);
  const reportConnectionIssue = useMemo(
    () =>
      connections.find(
        (connection) =>
          ["META_ADS", "GOOGLE_ADS"].includes(connection.provider) &&
          connection.status === "REAUTH_REQUIRED",
      ) ??
      connections.find(
        (connection) =>
          ["META_ADS", "GOOGLE_ADS"].includes(connection.provider) &&
          connection.status === "DEGRADED",
      ),
    [connections],
  );
  const reportCardCopy =
    language === "en"
      ? {
          eyebrow: "MONTHLY ADS REPORT",
          title: "Advertising performance report",
          noAccount: "Choose an account and period",
          checking: "Preparing selected account",
          footer: "Cover · KPI · comparison · campaigns · insights",
          docx: "Word document",
          pptx: "Presentation",
        }
      : {
          eyebrow: "ЕЖЕМЕСЯЧНЫЙ ОТЧЁТ ПО РЕКЛАМЕ",
          title: "Отчёт по рекламным кампаниям",
          noAccount: "Выберите кабинет и период",
          checking: "Проверяем выбранный кабинет",
          footer: "Обложка · KPI · сравнение · кампании · выводы",
          docx: "Word-документ",
          pptx: "Презентация",
        };
  const dashboardTariff = tariffPresentation(subscription?.plan?.key, {
    lifetimeAccess:
      subscription?.metadata?.accessGrant === FULL_ACCESS_LIFETIME_GRANT,
  });
  const reportFormatLabel =
    reportFormat === "pptx" ? reportCardCopy.pptx : reportCardCopy.docx;
  const connectedCount = connections.filter((connection) =>
    ["CONNECTED", "DEGRADED", "REAUTH_REQUIRED"].includes(connection.status),
  ).length;
  const activeTokenCount = useMemo(
    () =>
      tokens.filter(
        (token) =>
          !token.revokedAt &&
          (!token.expiresAt ||
            new Date(token.expiresAt).getTime() > Date.now()),
      ).length,
    [tokens],
  );
  const selectorConnection =
    connections.find((connection) => connection.id === openAccountsId) ?? null;
  const selectorSelected = new Set(
    selectorConnection ? (drafts[selectorConnection.id] ?? []) : [],
  );
  const selectorAccounts = selectorConnection
    ? selectorConnection.accounts.filter((account) => {
        const needle = accountSearch.trim().toLocaleLowerCase();
        return (
          !needle ||
          account.displayName.toLocaleLowerCase().includes(needle) ||
          account.externalAccountId.toLocaleLowerCase().includes(needle)
        );
      })
    : [];
  const selectorUsesProperties = [
    "GOOGLE_ANALYTICS",
    "GOOGLE_SEARCH_CONSOLE",
  ].includes(selectorConnection?.provider ?? "");
  const selectorLabel = selectorUsesProperties
    ? language === "en"
      ? "properties"
      : "ресурсы"
    : language === "en"
      ? "accounts"
      : "кабинеты";

  function notify(text: string) {
    setError("");
    setMessage(text);
  }

  function fail(text: string) {
    setMessage("");
    setError(text);
  }

  async function loadWorkspaces() {
    const response = await fetch(`${API}/api/v1/workspaces`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) {
      const requestedPath = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/auth?next=${encodeURIComponent(requestedPath)}`);
      return;
    }
    const data = (await response.json()) as Workspace[];
    setActive(
      (current) =>
        (current && data.find((item) => item.id === current.id)) ??
        data[0] ??
        null,
    );
  }

  async function loadProfile() {
    const [profileResponse, avatarResponse] = await Promise.all([
      fetch(`${API}/api/profile`, {
        credentials: "include",
        cache: "no-store",
      }),
      fetch(`${API}/api/profile/avatar`, {
        credentials: "include",
        cache: "no-store",
      }),
    ]);
    if (profileResponse.ok) {
      const data = (await profileResponse.json()) as { profile: Profile };
      setProfile(data.profile);
      setProfileName(data.profile.name);
    }
    if (avatarResponse.ok) {
      const data = (await avatarResponse.json()) as { dataUrl: string | null };
      setAvatar(data.dataUrl);
    }
  }

  async function loadConnections(workspace: Workspace) {
    const [providerResponse, connectionResponse] = await Promise.all([
      fetch(`${API}/api/v1/providers`, { credentials: "include" }),
      fetch(`${API}/api/v1/workspaces/${workspace.id}/connections`, {
        credentials: "include",
        cache: "no-store",
      }),
    ]);
    if (providerResponse.ok)
      setProviders((await providerResponse.json()) as Provider[]);
    if (connectionResponse.ok) {
      const data = (await connectionResponse.json()) as Connection[];
      setConnections(data);
      setDrafts(
        Object.fromEntries(
          data.map((connection) => [
            connection.id,
            connection.accounts
              .filter((account) => account.enabled)
              .map((account) => account.id),
          ]),
        ),
      );
      if (highlightedProvider) {
        const matching = data.find(
          (connection) => connection.provider === highlightedProvider,
        );
        if (matching) setOpenAccountsId(matching.id);
      }
    }
  }

  async function loadTokens(workspace: Workspace) {
    if (!["OWNER", "ADMIN"].includes(workspace.role)) {
      setTokens([]);
      return;
    }
    const response = await fetch(
      `${API}/api/v1/workspaces/${workspace.id}/service-tokens`,
      { credentials: "include", cache: "no-store" },
    );
    if (response.ok) setTokens((await response.json()) as ServiceToken[]);
  }

  async function loadSubscription(workspace: Workspace) {
    const response = await fetch(
      `${API}/api/v1/workspaces/${workspace.id}/billing/subscription`,
      { credentials: "include", cache: "no-store" },
    );
    if (response.ok)
      setSubscription((await response.json()) as BillingSubscription | null);
  }

  useEffect(() => {
    void loadWorkspaces();
    void loadProfile();
    const query = new URLSearchParams(window.location.search);
    const requestedSection = dashboardSectionFromLegacyQuery(
      query.get("section"),
    );
    if (requestedSection && pathname === "/dashboard")
      router.replace(dashboardRoute(requestedSection) as never);
    const oauthProvider = query.get("provider")?.toUpperCase();
    const oauthProviderAliases: Record<string, string> = {
      GOOGLE: "GOOGLE_ADS",
      META: "META_ADS",
      YANDEX: "YANDEX_DIRECT",
      TIKTOK: "TIKTOK_ADS",
    };
    if (oauthProvider)
      setHighlightedProvider(
        oauthProviderAliases[oauthProvider] ?? oauthProvider,
      );
    setOauthPendingProvider(null);
    setBusy(false);
    if (query.get("oauth") === "success")
      notify(
        "Платформа подключена. Откройте список кабинетов и выберите нужные.",
      );
    if (query.get("oauth") === "error")
      fail(
        oauthFailureMessage(
          oauthProviderAliases[oauthProvider ?? ""] ?? oauthProvider ?? null,
          query.get("oauth_reason"),
        ),
      );
    if (query.has("oauth")) router.replace("/dashboard/connections");
  }, [pathname, router]);

  useEffect(() => {
    if (!active) return;
    void loadConnections(active);
    void loadTokens(active);
    void loadSubscription(active);
  }, [active]);

  useEffect(() => {
    if (
      reportAccountId &&
      !reportableAccounts.some(({ account }) => account.id === reportAccountId)
    ) {
      setReportAccountId("");
    }
  }, [reportableAccounts, reportAccountId]);

  useEffect(() => {
    if (section !== "reports" || !active || !reportAccountId) {
      setReportPreview(null);
      setReportPreviewError("");
      return;
    }
    void loadReportPreview(active.id, reportAccountId, reportDays);
  }, [active, reportAccountId, reportDays, reportableAccounts, section]);

  useEffect(() => {
    if (!highlightedProvider) return;
    document
      .getElementById(`provider-${highlightedProvider}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [connections, highlightedProvider]);

  useEffect(() => {
    // Browser Back can restore this page from BFCache with its React state.
    // OAuth navigation is no longer in progress once the page is visible again.
    const releaseOAuthPending = () => setOauthPendingProvider(null);
    const releaseWhenVisible = () => {
      if (document.visibilityState === "visible") releaseOAuthPending();
    };

    window.addEventListener("pageshow", releaseOAuthPending);
    window.addEventListener("popstate", releaseOAuthPending);
    document.addEventListener("visibilitychange", releaseWhenVisible);
    return () => {
      window.removeEventListener("pageshow", releaseOAuthPending);
      window.removeEventListener("popstate", releaseOAuthPending);
      document.removeEventListener("visibilitychange", releaseWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (!confirm) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirm(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [confirm]);

  useEffect(() => {
    if (!openAccountsId) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAccountSelector();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [openAccountsId]);

  useEffect(() => {
    if (!reportPickerOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeReportPicker();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [reportPickerOpen]);

  function openAccountSelector(connection: Connection) {
    setDrafts((current) => ({
      ...current,
      [connection.id]: connection.accounts
        .filter((account) => account.enabled)
        .map((account) => account.id),
    }));
    setAccountSearch("");
    setOpenAccountsId(connection.id);
  }

  function closeAccountSelector() {
    setOpenAccountsId(null);
    setAccountSearch("");
  }

  function openReportPicker() {
    setReportPickerOpen(true);
    setReportPickerProvider(null);
    setReportAccountSearch("");
    setReportPreviewError("");
    setReportDownloadError("");
  }

  function closeReportPicker() {
    setReportPickerOpen(false);
    setReportPickerProvider(null);
    setReportAccountSearch("");
    requestAnimationFrame(() => reportAccountTriggerRef.current?.focus());
  }

  function openReportProvider(connection: Connection) {
    if (connection.status !== "CONNECTED") return;
    if (!["GOOGLE_ADS", "META_ADS"].includes(connection.provider)) return;
    setReportPickerProvider(connection.provider);
    setReportAccountSearch("");
  }

  function selectReportAccount(entry: ReportableAccount) {
    setReportAccountId(entry.account.id);
    setReportPreviewError("");
    setReportDownloadError("");
    closeReportPicker();
  }

  function openReportConnections(provider?: string) {
    if (provider) setHighlightedProvider(provider);
    setSection("connections");
    closeReportPicker();
  }

  async function startProvider(provider: string) {
    if (!active || oauthPendingProvider) return;
    setOauthPendingProvider(provider);
    try {
      const response = await fetch(
        `${API}/api/v1/workspaces/${active.id}/connections/${provider}/oauth/start`,
        {
          method: "POST",
          credentials: "include",
          headers: { "x-csrf-token": await csrf() },
        },
      );
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { authorizationUrl: string };
      window.history.replaceState({}, "", "/dashboard/connections");
      window.location.assign(data.authorizationUrl);
    } catch {
      fail(
        "Не удалось открыть вход в рекламную платформу. Попробуйте ещё раз.",
      );
      setOauthPendingProvider(null);
    }
  }

  async function refreshAccounts(connection: Connection) {
    if (!active) return;
    setBusy(true);
    try {
      const response = await fetch(
        `${API}/api/v1/workspaces/${active.id}/connections/${connection.id}/accounts/discover`,
        {
          method: "POST",
          credentials: "include",
          headers: { "x-csrf-token": await csrf() },
        },
      );
      if (!response.ok) throw new Error();
      await loadConnections(active);
      notify("Список кабинетов обновлён. Сохранённый выбор не изменён.");
    } catch {
      fail(
        "Не удалось обновить список кабинетов. Проверьте подключение платформы и попробуйте ещё раз.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(connection: Connection) {
    if (!active) return;
    const response = await fetch(
      `${API}/api/v1/workspaces/${active.id}/connections/${connection.id}`,
      {
        method: "DELETE",
        credentials: "include",
        headers: { "x-csrf-token": await csrf() },
      },
    );
    if (!response.ok) {
      fail("Не удалось отключить платформу.");
      return;
    }
    setOpenAccountsId((current) =>
      current === connection.id ? null : current,
    );
    setDrafts((current) => {
      const next = { ...current };
      delete next[connection.id];
      return next;
    });
    await loadConnections(active);
    notify(`${providerCopy(connection.provider).name} отключён.`);
  }

  function toggleDraft(connectionId: string, accountId: string) {
    setDrafts((current) => {
      const selected = new Set(current[connectionId] ?? []);
      if (selected.has(accountId)) selected.delete(accountId);
      else selected.add(accountId);
      return { ...current, [connectionId]: [...selected] };
    });
  }

  async function saveAccounts(connection: Connection) {
    if (!active) return;
    const selected = new Set(drafts[connection.id] ?? []);
    const changes = connection.accounts.filter(
      (account) => account.enabled !== selected.has(account.id),
    );
    if (!changes.length) {
      notify("Выбор уже сохранён.");
      return;
    }
    setSavingAccounts(connection.id);
    try {
      const csrfToken = await csrf();
      const response = await fetch(
        `${API}/api/v1/workspaces/${active.id}/connections/${connection.id}/accounts`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify({ accountIds: [...selected] }),
        },
      );
      if (!response.ok) throw new Error();
      await loadConnections(active);
      closeAccountSelector();
      notify("Выбранные кабинеты сохранены.");
    } catch (cause) {
      await loadConnections(active);
      fail(
        cause instanceof Error
          ? cause.message
          : "Не удалось сохранить выбор кабинетов.",
      );
    } finally {
      setSavingAccounts(null);
    }
  }

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      const response = await fetch(
        `${API}/api/v1/workspaces/${active.id}/service-tokens`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": await csrf(),
          },
          body: JSON.stringify({
            name: String(form.get("name") ?? "").trim(),
            scopes:
              form.get("access_mode") === "controlled_write"
                ? ["adforge:mcp:read", "adforge:mcp:write"]
                : ["adforge:mcp:read"],
            expiresInDays: Number(form.get("expires_in_days") || 90),
          }),
        },
      );
      if (!response.ok) throw new Error();
      const data = (await response.json()) as ServiceToken & { token: string };
      setCreatedToken(data.token);
      formElement.reset();
      setTokenName("");
      setTokenAccessMode("read_only");
      await loadTokens(active);
      notify("Ключ создан. Сохраните его сейчас.");
    } catch {
      fail("Не удалось создать ключ.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteToken(token: ServiceToken) {
    if (!active) return;
    setTokenActionId(token.id);
    try {
      const response = await fetch(
        `${API}/api/v1/workspaces/${active.id}/service-tokens/${token.id}`,
        {
          method: "DELETE",
          credentials: "include",
          headers: { "x-csrf-token": await csrf() },
        },
      );
      if (!response.ok) throw new Error();
      await loadTokens(active);
      notify(deleteKeyCopy.success);
    } catch {
      fail(deleteKeyCopy.failure);
    } finally {
      setTokenActionId(null);
    }
  }

  async function rotateToken(token: ServiceToken) {
    if (!active) return;
    setTokenActionId(token.id);
    try {
      const response = await fetch(
        `${API}/api/v1/workspaces/${active.id}/service-tokens/${token.id}/rotate`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": await csrf(),
          },
          body: "{}",
        },
      );
      if (!response.ok) throw new Error();
      const data = (await response.json()) as ServiceToken & { token: string };
      setCreatedToken(data.token);
      await loadTokens(active);
      notify("Новый ключ готов. Сохраните его сейчас.");
    } catch {
      fail("Не удалось обновить ключ.");
    } finally {
      setTokenActionId(null);
    }
  }

  async function renameToken(token: ServiceToken) {
    if (!active || !tokenNameDraft.trim()) return;
    setTokenActionId(token.id);
    try {
      const response = await fetch(
        `${API}/api/v1/workspaces/${active.id}/service-tokens/${token.id}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": await csrf(),
          },
          body: JSON.stringify({ name: tokenNameDraft.trim() }),
        },
      );
      if (!response.ok) throw new Error();
      await loadTokens(active);
      setEditingTokenId(null);
      setTokenNameDraft("");
      notify("Название ключа сохранено.");
    } catch {
      fail("Не удалось сохранить название ключа.");
    } finally {
      setTokenActionId(null);
    }
  }

  async function grantConfirmedWrite(token: ServiceToken) {
    if (!active) return;
    if (token.accountIds.length !== 1) {
      fail(
        "Для подтверждённой записи ключ должен быть ограничен одним рекламным кабинетом.",
      );
      return;
    }
    const response = await fetch(
      `${API}/api/v1/workspaces/${active.id}/service-tokens/${token.id}/scopes`,
      {
        method: "PATCH",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": await csrf(),
        },
        body: JSON.stringify({
          scopes: ["adforge:mcp:read", "adforge:mcp:write"],
        }),
      },
    );
    if (!response.ok) {
      return fail(
        await responseErrorMessage(
          response,
          "Не удалось выдать ключу право подтверждённой записи.",
        ),
      );
    }
    await loadTokens(active);
    notify("Ключ получил право подтверждённой записи для своего кабинета.");
  }

  async function loadReportPreview(
    workspaceId: string,
    accountId: string,
    days: number,
  ) {
    setReportPreviewBusy(true);
    setReportPreviewError("");
    try {
      const query = new URLSearchParams({ accountId, ...dateRange(days) });
      const response = await fetch(
        `${API}/api/v1/workspaces/${workspaceId}/reports/performance?${query}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(reportErrorMessage(response.status, "preview"));
      }
      setReportPreview((await response.json()) as ReportPreview);
    } catch (cause) {
      setReportPreview(null);
      setReportPreviewError(
        cause instanceof Error
          ? cause.message
          : "Не удалось получить данные отчёта.",
      );
    } finally {
      setReportPreviewBusy(false);
    }
  }

  async function downloadReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || !reportAccountId || !reportPreview) return;
    const accountId = reportAccountId;
    const format = reportFormat;
    setBusy(true);
    setReportDownloadError("");
    try {
      const query = new URLSearchParams({
        accountId,
        ...dateRange(reportDays),
      });
      const response = await fetch(
        `${API}/api/v1/workspaces/${active.id}/reports/performance.${format}?${query}`,
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error(reportErrorMessage(response.status, "download"));
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `holymedia-performance-report.${format}`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        link.remove();
      }, 1000);
      notify(format === "pptx" ? "Презентация готова." : "Отчёт готов.");
    } catch (cause) {
      setReportDownloadError(
        cause instanceof Error
          ? cause.message
          : "Не удалось собрать отчёт. Попробуйте ещё раз.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadAnalysisHistory(): Promise<SiteAnalysis[]> {
    const response = await fetch(`${API}/api/site/history`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { items: SiteAnalysis[] };
    setAnalysisHistory(data.items);
    return data.items;
  }

  async function analyzeSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || !analysisUrl.trim()) return;
    setAnalysisBusy(true);
    setAnalysisStage(0);
    setError("");
    setMessage("");
    let progressTimer: number | undefined;
    try {
      progressTimer = window.setTimeout(() => setAnalysisStage(1), 650);
      const response = await fetch(
        `${API}/api/v1/workspaces/${active.id}/site-analysis`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": await csrf(),
          },
          body: JSON.stringify({
            url: analysisUrl.trim(),
            mode: analysisMode,
            ...analysisBrief,
          }),
        },
      );
      const data = (await response.json()) as { error?: { message?: string } };
      if (!response.ok)
        throw new Error(data.error?.message ?? "Не удалось проверить сайт.");
      const items = await loadAnalysisHistory();
      setAnalysisResult(items[0] ?? null);
      notify("Проверка сайта завершена.");
    } catch (requestError) {
      fail(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось проверить сайт.",
      );
    } finally {
      if (progressTimer) window.clearTimeout(progressTimer);
      setAnalysisBusy(false);
      setAnalysisStage(0);
    }
  }

  async function downloadSiteAnalysis(item: SiteAnalysis) {
    try {
      const response = await fetch(`${API}/api/site/report.docx`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": await csrf(),
        },
        body: JSON.stringify({ history_id: item.id }),
      });
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "holymedia-site-analysis.docx";
      link.click();
      URL.revokeObjectURL(url);
      notify("Отчёт анализа скачан.");
    } catch {
      fail("Не удалось скачать отчёт анализа.");
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch(`${API}/api/profile`, {
      method: "PUT",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": await csrf(),
      },
      body: JSON.stringify({ name: profileName }),
    });
    if (!response.ok) return fail("Не удалось сохранить имя.");
    const data = (await response.json()) as { profile: Profile };
    setProfile(data.profile);
    notify("Профиль сохранён.");
  }

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      return fail("Выберите изображение JPG, PNG или WebP.");
    if (file.size > 2_097_152)
      return fail("Размер изображения не должен превышать 2 МБ.");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error());
      reader.readAsDataURL(file);
    });
    const response = await fetch(`${API}/api/profile/avatar`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": await csrf(),
      },
      body: JSON.stringify({ dataUrl }),
    });
    if (!response.ok) return fail("Не удалось обновить фото.");
    setAvatar(((await response.json()) as { dataUrl: string }).dataUrl);
    notify("Фото профиля обновлено.");
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch(`${API}/api/v1/auth/password/change`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": await csrf(),
      },
      body: JSON.stringify({
        currentPassword: form.get("current_password"),
        newPassword: form.get("new_password"),
      }),
    });
    if (!response.ok)
      return fail("Не удалось изменить пароль. Проверьте текущий пароль.");
    formElement.reset();
    notify("Пароль изменён.");
  }

  async function copy(text: string, success: string) {
    await navigator.clipboard.writeText(text);
    notify(success);
  }

  async function logout() {
    await fetch(`${API}/api/v1/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: { "x-csrf-token": await csrf() },
    });
    window.location.assign("/auth");
  }

  const nav: Array<{
    id?: Section;
    label: string;
    disabled?: boolean;
  }> = [
    { id: "overview", label: "Обзор" },
    { id: "tariffs", label: "Тарифы" },
    { id: "connections", label: "Подключения" },
    { id: "mcp", label: "AI-клиент" },
    { id: "reports", label: "Отчёты" },
    { label: "Анализ сайта", disabled: true },
    { label: "SEO", disabled: true },
  ];
  const allProviderIds = [
    "GOOGLE_ADS",
    "META_ADS",
    "YANDEX_DIRECT",
    "TIKTOK_ADS",
    "GOOGLE_SEARCH_CONSOLE",
    "GOOGLE_ANALYTICS",
  ];

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="dashboard-topbar">
          <a
            className="brand-link"
            href="/dashboard"
            aria-label="HolyMedia MCP — обзор"
          >
            <BrandLockup />
          </a>
          <div className="dashboard-actions">
            <LanguageSwitcher compact />
            <button
              className="profile-link"
              type="button"
              aria-label={`Открыть профиль${profile?.email ? `: ${profile.email}` : ""}`}
              onClick={() => setSection("profile")}
            >
              {avatar ? (
                <img src={avatar} alt="" />
              ) : (
                <span aria-hidden="true">
                  {profile?.name?.charAt(0).toUpperCase() || "H"}
                </span>
              )}
              <strong>{profile?.email ?? "Профиль"}</strong>
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => void logout()}
            >
              Выйти
            </button>
          </div>
        </div>
        <nav className="tabs-bar" aria-label="Основные разделы">
          {nav.map((item) => (
            <button
              key={item.label}
              className={item.id === section ? "nav-tab is-active" : "nav-tab"}
              type="button"
              disabled={item.disabled}
              title={item.disabled ? "Скоро" : undefined}
              onClick={() => item.id && setSection(item.id)}
            >
              <span>{item.label}</span>
              {item.disabled && <small>Скоро</small>}
            </button>
          ))}
        </nav>
      </header>

      <div className="dashboard-main">
        {(message || error) && (
          <div
            className={
              error ? "notice notice--error" : "notice notice--success"
            }
            role={error ? "alert" : "status"}
          >
            <span>{error || message}</span>
            <button
              type="button"
              aria-label="Закрыть сообщение"
              onClick={() => {
                setError("");
                setMessage("");
              }}
            >
              ×
            </button>
          </div>
        )}

        {accessBlocked && active && section !== "profile" && (
          <section
            className="company-access-gate"
            aria-labelledby="company-access-title"
          >
            <p className="eyebrow">HOLYMEDIA MCP</p>
            <h1 id="company-access-title">
              {active.accessStatus === "SUSPENDED"
                ? "Доступ компании приостановлен"
                : "Компания на проверке"}
            </h1>
            <p>
              {active.accessStatus === "SUSPENDED"
                ? "Рабочие функции временно недоступны. Обратитесь к администратору HolyMedia."
                : "Профиль компании и команда уже доступны. Рекламные подключения, AI-клиент и отчёты откроются после одобрения администратором."}
            </p>
            <button
              className="primary-button"
              type="button"
              onClick={() => setSection("profile")}
            >
              Открыть профиль компании
            </button>
          </section>
        )}

        {!accessBlocked && section === "overview" && (
          <section className="section" aria-labelledby="overview-title">
            <div className="overview-hero">
              <div className="overview-lead">
                <p className="eyebrow">Личный кабинет</p>
                <h1 id="overview-title">Реклама в вашем AI-чате</h1>
                <p>
                  Подключите рекламные платформы, выберите кабинеты и задавайте
                  вопросы о кампаниях обычными словами.
                </p>
                <div className="overview-actions">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => setSection("connections")}
                  >
                    Подключить платформу
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setSection("mcp")}
                  >
                    Подключить AI-клиент
                  </button>
                </div>
              </div>
              <div className="overview-stats">
                <div className="stat-card">
                  <span>Платформы</span>
                  <strong>{connectedCount}</strong>
                  <small>подключено</small>
                </div>
                <div className="stat-card">
                  <span>Кабинеты</span>
                  <strong>{enabledAccounts.length}</strong>
                  <small>выбрано</small>
                </div>
                <button
                  className="stat-card stat-card--link"
                  type="button"
                  onClick={() => setSection("mcp")}
                >
                  <span>Ключи доступа</span>
                  <strong>{activeTokenCount}</strong>
                  <small>активных ключей</small>
                </button>
                <button
                  className="stat-card stat-card--link"
                  type="button"
                  onClick={() => setSection("tariffs")}
                >
                  <span>Тариф</span>
                  <strong>{dashboardTariff.plan.ru}</strong>
                  <small>
                    {dashboardTariff.kind === "lifetime"
                      ? "Бессрочно"
                      : subscription?.status === "TRIALING"
                        ? "Пробный период"
                        : subscription?.status === "ACTIVE"
                          ? "Активен"
                          : "Открыть тарифы"}
                  </small>
                </button>
              </div>
            </div>
            <ol className="onboarding-steps" aria-label="Как начать">
              <li className="onboarding-step">
                <span className="onboarding-step__num">1</span>
                <strong>Подключите платформу</strong>
                <p>Войдите через официальный OAuth.</p>
              </li>
              <li className="onboarding-step">
                <span className="onboarding-step__num">2</span>
                <strong>Выберите кабинеты</strong>
                <p>Отметьте аккаунты, с которыми хотите работать.</p>
              </li>
              <li className="onboarding-step">
                <span className="onboarding-step__num">3</span>
                <strong>Добавьте AI-клиент</strong>
                <p>Скопируйте MCP URL и следуйте инструкции.</p>
              </li>
            </ol>
          </section>
        )}

        {section === "tariffs" && (
          <section className="section" aria-label="Тарифы">
            <h1 className="sr-only">
              {"\u0422\u0430\u0440\u0438\u0444\u044b HolyMedia MCP"}
            </h1>
            <TariffCatalog
              subscription={subscription}
              workspaceId={active?.id}
            />
          </section>
        )}

        {section === "connections" && (
          <section className="section" aria-labelledby="connections-title">
            <div className="section-head">
              <div>
                <p className="eyebrow">Рекламные платформы</p>
                <h1 id="connections-title">Подключения</h1>
                <p className="section-head__sub">
                  Подключите платформу и выберите кабинеты для AI-клиента.
                </p>
              </div>
            </div>
            <div className="connection-list">
              {allProviderIds.map((providerId) => {
                const definition = providers.find(
                  (item) => item.id === providerId,
                );
                const storedConnection = connections.find(
                  (item) => item.provider === providerId,
                );
                const connection =
                  storedConnection &&
                  !["DISCONNECTED", "REVOKED"].includes(storedConnection.status)
                    ? storedConnection
                    : undefined;
                const copyText = providerCopy(providerId);
                const providerDescription =
                  providerId === "GOOGLE_ANALYTICS" && language === "en"
                    ? "Analyze website traffic, sources, pages, events and key actions through AI."
                    : copyText.description;
                const providerConfigured =
                  !["GOOGLE_ANALYTICS", "GOOGLE_SEARCH_CONSOLE"].includes(
                    providerId,
                  ) || definition?.status.toLowerCase() === "available";
                const status = connectionStatus(connection?.status ?? "");
                const selected = new Set(
                  connection ? (drafts[connection.id] ?? []) : [],
                );
                return (
                  <article
                    className={`connection-card ${
                      highlightedProvider === providerId ? "is-highlighted" : ""
                    }`}
                    id={`provider-${providerId}`}
                    key={providerId}
                  >
                    <div className="connection-card__head">
                      {providerId === "GOOGLE_ANALYTICS" ? (
                        <img
                          className="provider-mark provider-mark--google-analytics"
                          src="/google-analytics.svg"
                          alt=""
                        />
                      ) : (
                        <span
                          className={`provider-mark provider-mark--${providerId.toLowerCase()}`}
                          aria-hidden="true"
                        >
                          {copyText.short}
                        </span>
                      )}
                      <div>
                        <h2>{copyText.name}</h2>
                        <p>{providerDescription}</p>
                      </div>
                      <div className="connection-card__statuses">
                        <span className={`status-badge ${status.tone}`}>
                          {status.label}
                        </span>
                        {providerId === "META_ADS" && !connection && (
                          <span className="status-badge info status-badge--muted">
                            Проходит верификацию
                          </span>
                        )}
                      </div>
                    </div>
                    {connection ? (
                      <>
                        <p className="connection-count">
                          {connection.accounts.length
                            ? providerId === "GOOGLE_ANALYTICS"
                              ? language === "en"
                                ? `${connection.accounts.length} properties · ${selected.size} selected`
                                : `${connection.accounts.length} ресурсов · ${selected.size} выбрано`
                              : `${connection.accounts.length} кабинетов · ${selected.size} выбрано`
                            : providerId === "GOOGLE_ANALYTICS"
                              ? language === "en"
                                ? "Properties have not been found yet"
                                : "Ресурсы ещё не найдены"
                              : "Кабинеты ещё не найдены"}
                        </p>
                        {connection.status !== "CONNECTED" && (
                          <p className="connection-note">
                            Подключите платформу заново, чтобы восстановить
                            доступ к кабинетам.
                          </p>
                        )}
                        <div className="connection-actions">
                          <button
                            className="primary-button btn--small"
                            type="button"
                            aria-haspopup="dialog"
                            onClick={() => openAccountSelector(connection)}
                          >
                            {providerId === "GOOGLE_ANALYTICS"
                              ? language === "en"
                                ? "View properties"
                                : "Посмотреть ресурсы"
                              : "Посмотреть кабинеты"}
                          </button>
                          <button
                            className="secondary-button btn--small"
                            type="button"
                            disabled={busy}
                            onClick={() => void refreshAccounts(connection)}
                          >
                            Обновить
                          </button>
                          {connection.status !== "CONNECTED" && (
                            <button
                              className="ghost-button btn--small"
                              type="button"
                              disabled={Boolean(oauthPendingProvider)}
                              onClick={() => void startProvider(providerId)}
                            >
                              Подключить заново
                            </button>
                          )}
                          <button
                            className="secondary-button secondary-button--danger btn--small"
                            type="button"
                            onClick={() =>
                              setConfirm({
                                title: `Отключить ${copyText.name}?`,
                                description:
                                  "Кабинеты этой платформы перестанут быть доступны в AI-клиенте. Чтобы вернуть доступ, потребуется подключить её снова.",
                                confirmLabel: "Отключить",
                                run: () => disconnect(connection),
                              })
                            }
                          >
                            Отключить
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="connection-empty">
                        <p>
                          {providerId === "GOOGLE_ANALYTICS" &&
                          language === "en"
                            ? "Google Analytics has not been connected yet."
                            : "Платформа ещё не подключена."}
                        </p>
                        {!providerConfigured && (
                          <p className="connection-note">
                            {language === "en"
                              ? "Google Analytics connection is not configured on the server yet."
                              : "Подключение Google Analytics ещё не настроено на сервере."}
                          </p>
                        )}
                        <button
                          className="primary-button"
                          type="button"
                          disabled={
                            Boolean(oauthPendingProvider) ||
                            definition?.status === "DISABLED" ||
                            !providerConfigured
                          }
                          onClick={() => void startProvider(providerId)}
                        >
                          {providerId === "GOOGLE_ANALYTICS" &&
                          language === "en"
                            ? "Connect Google Analytics"
                            : `Подключить ${copyText.name}`}
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {section === "mcp" && (
          <section className="section" aria-labelledby="mcp-title">
            <div className="section-head">
              <div>
                <p className="eyebrow">AI-клиент</p>
                <h1 id="mcp-title">Подключите HolyMedia MCP</h1>
                <p className="section-head__sub">
                  {client === "claude" || client === "chatgpt"
                    ? language === "ru"
                      ? `Скопируйте адрес и подключите ${
                          client === "claude" ? "Claude" : "ChatGPT"
                        } через безопасную авторизацию HolyMedia MCP.`
                      : `Copy the URL and connect ${
                          client === "claude" ? "Claude" : "ChatGPT"
                        } through secure HolyMedia MCP authorization.`
                    : "Скопируйте адрес, создайте личный ключ и выберите инструкцию."}
                </p>
              </div>
            </div>
            <section className="mcp-setup">
              <div className="mcp-step">
                <span>1</span>
                <div>
                  <h2>Скопируйте MCP URL</h2>
                  <div className="copy-row">
                    <code>{MCP_URL}</code>
                    <button
                      className="secondary-button btn--small"
                      type="button"
                      onClick={() => void copy(MCP_URL, "MCP URL скопирован.")}
                    >
                      Скопировать
                    </button>
                  </div>
                </div>
              </div>
              <div className="mcp-step">
                <span>2</span>
                <div className="mcp-step__body">
                  {client !== "codex" ? (
                    <OAuthKeyNote client={client} language={language} />
                  ) : (
                    <>
                      <h2>Создайте ключ доступа</h2>
                      {canManage ? (
                        <form className="token-form" onSubmit={createToken}>
                          <div className="form-row">
                            <label>
                              Название
                              <input
                                name="name"
                                required
                                minLength={2}
                                value={tokenName}
                                onChange={(event) =>
                                  setTokenName(event.target.value)
                                }
                                placeholder="Например, Codex"
                              />
                            </label>
                            <label>
                              Срок действия
                              <ProjectSelect
                                ariaLabel="Срок действия"
                                name="expires_in_days"
                                defaultValue="90"
                                options={[
                                  { value: "30", label: "30 дней" },
                                  { value: "90", label: "90 дней" },
                                  { value: "365", label: "1 год" },
                                ]}
                              />
                            </label>
                          </div>
                          <p className="scope-note">
                            Ключ получит доступ ко всем подключённым кабинетам
                            из раздела «Подключения» текущей компании.
                          </p>
                          <label>
                            {language === "ru"
                              ? "Режим доступа"
                              : "Access mode"}
                            <ProjectSelect
                              ariaLabel={
                                language === "ru"
                                  ? "Режим доступа"
                                  : "Access mode"
                              }
                              name="access_mode"
                              value={tokenAccessMode}
                              onChange={setTokenAccessMode}
                              options={[
                                {
                                  value: "read_only",
                                  label:
                                    language === "ru"
                                      ? "Только чтение"
                                      : "Read-only",
                                },
                                {
                                  value: "controlled_write",
                                  label:
                                    language === "ru"
                                      ? "Контролируемая запись"
                                      : "Controlled write",
                                },
                              ]}
                            />
                          </label>
                          <p className="controlled-write-note">
                            {language === "ru"
                              ? "Контролируемая запись разрешает только операции из серверной политики после вашего явного запроса. Произвольные изменения запрещены."
                              : "Controlled write allows only server-policy-approved operations after your explicit request. Arbitrary changes are blocked."}
                          </p>
                          <button
                            className="primary-button"
                            type="submit"
                            disabled={busy}
                          >
                            Создать ключ
                          </button>
                        </form>
                      ) : (
                        <div className="empty-state">
                          <p>
                            Создать ключ может владелец аккаунта. Попросите его
                            выдать вам доступ.
                          </p>
                        </div>
                      )}
                      {createdToken && (
                        <div className="one-time-secret" role="status">
                          <strong>Сохраните ключ сейчас</strong>
                          <p>
                            После закрытия страницы полный ключ больше не
                            показывается.
                          </p>
                          <div className="copy-row">
                            <code>{createdToken}</code>
                            <button
                              className="secondary-button btn--small"
                              type="button"
                              onClick={() =>
                                void copy(createdToken, "Ключ скопирован.")
                              }
                            >
                              Скопировать
                            </button>
                          </div>
                          <button
                            className="ghost-button btn--small"
                            type="button"
                            onClick={() => setCreatedToken("")}
                          >
                            Скрыть
                          </button>
                        </div>
                      )}
                      {canManage && tokens.length > 0 && (
                        <div className="token-list" aria-live="polite">
                          <h3>Ваши ключи</h3>
                          {tokens.map((token) => {
                            const lifecycle = tokenLifecycle(token, language);
                            const displayName = tokenDisplayName(
                              token,
                              language,
                            );
                            const isEditing = editingTokenId === token.id;
                            const actionPending = tokenActionId === token.id;
                            const isExpired = lifecycle.tone === "expired";
                            return (
                              <article className="token-row" key={token.id}>
                                <div className="token-row__identity">
                                  {isEditing ? (
                                    <form
                                      className="token-name-editor"
                                      onSubmit={(event) => {
                                        event.preventDefault();
                                        void renameToken(token);
                                      }}
                                    >
                                      <label>
                                        <span className="sr-only">
                                          Название ключа
                                        </span>
                                        <input
                                          autoFocus
                                          value={tokenNameDraft}
                                          minLength={2}
                                          maxLength={160}
                                          required
                                          aria-label="Название ключа"
                                          onChange={(event) =>
                                            setTokenNameDraft(
                                              event.target.value,
                                            )
                                          }
                                        />
                                      </label>
                                      <button
                                        className="token-action"
                                        type="submit"
                                        disabled={actionPending}
                                      >
                                        {actionPending
                                          ? "Сохраняем…"
                                          : "Сохранить"}
                                      </button>
                                      <button
                                        className="token-action"
                                        type="button"
                                        disabled={actionPending}
                                        onClick={() => {
                                          setEditingTokenId(null);
                                          setTokenNameDraft("");
                                        }}
                                      >
                                        Отмена
                                      </button>
                                    </form>
                                  ) : (
                                    <>
                                      <div className="token-row__title">
                                        <strong>{displayName}</strong>
                                        <span
                                          className={`token-status token-status--${lifecycle.tone}`}
                                        >
                                          {lifecycle.label}
                                        </span>
                                      </div>
                                      <div className="token-row__meta">
                                        <small>{lifecycle.createdLabel}</small>
                                        <small>{lifecycle.expiryLabel}</small>
                                      </div>
                                    </>
                                  )}
                                </div>
                                {!isEditing && (
                                  <div className="token-row__actions">
                                    <button
                                      className="token-action"
                                      type="button"
                                      disabled={actionPending}
                                      onClick={() => {
                                        setEditingTokenId(token.id);
                                        setTokenNameDraft(
                                          /^personal mcp token$/i.test(
                                            token.name,
                                          )
                                            ? ""
                                            : token.name,
                                        );
                                      }}
                                    >
                                      {/^personal mcp token$/i.test(token.name)
                                        ? "Назвать"
                                        : "Переименовать"}
                                    </button>
                                    {!token.revokedAt && (
                                      <>
                                        {!isExpired &&
                                          !token.scopes.includes(
                                            "adforge:mcp:write",
                                          ) && (
                                            <button
                                              className="token-action"
                                              type="button"
                                              disabled={actionPending}
                                              onClick={() =>
                                                setConfirm({
                                                  title:
                                                    language === "en"
                                                      ? `Allow confirmed write access for “${displayName}”?`
                                                      : `Разрешить подтверждённую запись для «${displayName}»?`,
                                                  description:
                                                    language === "en"
                                                      ? "The key value will not change. The server will allow only the allowlisted Meta operation after separate confirmation."
                                                      : "Значение ключа не изменится. Сервер разрешит только allowlisted Meta-операцию после отдельного подтверждения.",
                                                  confirmLabel:
                                                    language === "en"
                                                      ? "Allow"
                                                      : "Разрешить",
                                                  run: () =>
                                                    grantConfirmedWrite(token),
                                                })
                                              }
                                            >
                                              {language === "en"
                                                ? "Allow write access"
                                                : "Разрешить запись"}
                                            </button>
                                          )}
                                        {!isExpired && (
                                          <button
                                            className="token-action"
                                            type="button"
                                            disabled={actionPending}
                                            onClick={() =>
                                              setConfirm({
                                                title: `Обновить ключ «${displayName}»?`,
                                                description:
                                                  "Текущее значение сразу перестанет работать. Новый ключ будет показан один раз.",
                                                confirmLabel: "Обновить",
                                                run: () => rotateToken(token),
                                              })
                                            }
                                          >
                                            Обновить
                                          </button>
                                        )}
                                        <button
                                          className="token-action token-action--danger"
                                          type="button"
                                          disabled={actionPending}
                                          onClick={() =>
                                            setConfirm({
                                              title:
                                                deleteKeyCopy.title(
                                                  displayName,
                                                ),
                                              description:
                                                deleteKeyCopy.description,
                                              confirmLabel:
                                                deleteKeyCopy.action,
                                              run: () => deleteToken(token),
                                            })
                                          }
                                        >
                                          {deleteKeyCopy.action}
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="mcp-step">
                <span>3</span>
                <div className="mcp-step__body">
                  <h2>Выберите AI-клиент</h2>
                  <div
                    className="client-tabs"
                    role="tablist"
                    aria-label="AI-клиенты"
                  >
                    {(["codex", "claude", "chatgpt"] as Client[]).map(
                      (item) => (
                        <button
                          key={item}
                          type="button"
                          role="tab"
                          aria-selected={client === item}
                          className={client === item ? "is-active" : ""}
                          onClick={() => setClient(item)}
                        >
                          {item === "codex"
                            ? "Codex"
                            : item === "claude"
                              ? "Claude"
                              : "ChatGPT"}
                        </button>
                      ),
                    )}
                  </div>
                  <ClientInstructions
                    client={client}
                    language={language}
                    onCopyUrl={() => void copy(MCP_URL, "MCP URL скопирован.")}
                  />
                </div>
              </div>
            </section>
          </section>
        )}

        {section === "reports" && (
          <section
            className="section report-section"
            aria-labelledby="reports-title"
          >
            <div className="section-head">
              <div>
                <p className="eyebrow">Отчёты</p>
                <h1 id="reports-title">Отчёт по рекламному кабинету</h1>
                <p className="section-head__sub">
                  Выберите кабинет и период. Подготовим Word-документ или
                  презентацию с показателями, сравнением и кампаниями.
                </p>
              </div>
            </div>
            <div className="report-layout">
              <section className="panel report-panel report-builder-card">
                <p className="report-builder-card__eyebrow">
                  HOLYMEDIA MCP · ОТЧЁТ
                </p>
                <h2>Собрать отчёт</h2>
                <p className="report-builder-card__note">
                  В отчёт попадут только данные выбранного кабинета и периода.
                </p>
                <form className="report-form" onSubmit={downloadReport}>
                  <label className="report-form__account">
                    Рекламный кабинет
                    <button
                      ref={reportAccountTriggerRef}
                      className="report-account-trigger"
                      type="button"
                      aria-haspopup="dialog"
                      aria-expanded={reportPickerOpen}
                      onClick={openReportPicker}
                    >
                      <span>
                        {selectedReportAccount
                          ? selectedReportAccount.account.displayName
                          : "Выберите кабинет"}
                      </span>
                      <small>
                        {selectedReportAccount
                          ? providerCopy(
                              selectedReportAccount.connection.provider,
                            ).name
                          : "Платформа → кабинет"}
                      </small>
                    </button>
                  </label>
                  <label>
                    Период
                    <ProjectSelect
                      ariaLabel="Период отчёта"
                      value={String(reportDays)}
                      onChange={(value) => setReportDays(Number(value))}
                      options={[
                        { value: "7", label: "Последние 7 дней" },
                        { value: "14", label: "Последние 14 дней" },
                        { value: "30", label: "Последние 30 дней" },
                        { value: "90", label: "Последние 90 дней" },
                      ]}
                    />
                  </label>
                  <label>
                    Формат
                    <ProjectSelect
                      ariaLabel="Формат отчёта"
                      value={reportFormat}
                      onChange={(value) =>
                        setReportFormat(value === "pptx" ? "pptx" : "docx")
                      }
                      options={[
                        { value: "docx", label: "Word (.docx)" },
                        { value: "pptx", label: "PowerPoint (.pptx)" },
                      ]}
                    />
                  </label>
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={
                      busy ||
                      reportPreviewBusy ||
                      !reportAccountId ||
                      !reportPreview
                    }
                  >
                    {busy
                      ? "Готовим…"
                      : reportPreviewBusy
                        ? "Проверяем данные…"
                        : "Скачать отчёт"}
                  </button>
                </form>
                {!reportAccountId && (
                  <div className="report-status" role="status">
                    <strong>Сначала выберите рекламный кабинет.</strong>
                    <span>
                      Здесь отображаются только те кабинеты, которые включены у
                      вас в разделе «Подключения».
                    </span>
                    <button
                      className="secondary-button btn--small"
                      type="button"
                      onClick={openReportPicker}
                    >
                      Выбрать кабинет
                    </button>
                  </div>
                )}
                {reportPreviewError && (
                  <div
                    className="report-status report-status--error"
                    role="alert"
                  >
                    <strong>Не удалось подготовить отчёт</strong>
                    <span>{reportPreviewError}</span>
                    <button
                      className="secondary-button btn--small"
                      type="button"
                      onClick={() =>
                        active &&
                        reportAccountId &&
                        void loadReportPreview(
                          active.id,
                          reportAccountId,
                          reportDays,
                        )
                      }
                    >
                      Повторить проверку
                    </button>
                  </div>
                )}
                {reportDownloadError && (
                  <div
                    className="report-status report-status--error"
                    role="alert"
                  >
                    <strong>Не удалось скачать отчёт</strong>
                    <span>{reportDownloadError}</span>
                    {selectedReportAccount?.connection.status ===
                      "REAUTH_REQUIRED" && (
                      <button
                        className="secondary-button btn--small"
                        type="button"
                        onClick={() =>
                          openReportConnections(
                            selectedReportAccount.connection.provider,
                          )
                        }
                      >
                        Открыть подключения
                      </button>
                    )}
                  </div>
                )}
                {reportPreviewBusy && !reportPreviewError && (
                  <div className="report-status" role="status">
                    Получаем реальные показатели выбранного кабинета…
                  </div>
                )}
                {reportPreview && !reportPreviewBusy && (
                  <div className="report-data-preview">
                    <div className="report-data-preview__head">
                      <div>
                        <strong>{reportPreview.account.name}</strong>
                        <span>
                          {providerCopy(reportPreview.account.provider).name} ·{" "}
                          {reportPreview.period.startDate} —{" "}
                          {reportPreview.period.endDate}
                        </span>
                      </div>
                      <span className="status-badge ok">
                        {reportPreview.provenance.summary.realData
                          ? "Реальные данные"
                          : "Данные недоступны"}
                      </span>
                    </div>
                    <div
                      className="report-kpis"
                      aria-label="Основные показатели"
                    >
                      <span>
                        <small>Расход</small>
                        <strong>
                          {formatReportMoney(reportPreview.metrics.spend)}
                        </strong>
                      </span>
                      <span>
                        <small>Показы</small>
                        <strong>
                          {formatReportNumber(
                            reportPreview.metrics.impressions,
                          )}
                        </strong>
                      </span>
                      <span>
                        <small>Клики</small>
                        <strong>
                          {formatReportNumber(reportPreview.metrics.clicks)}
                        </strong>
                      </span>
                      <span>
                        <small>Конверсии</small>
                        <strong>
                          {formatReportNumber(
                            reportPreview.metrics.conversions,
                          )}
                        </strong>
                      </span>
                    </div>
                    <p className="report-data-preview__note">
                      В документ попадут показатели, сравнение периодов,
                      кампании и выводы только из этого источника.
                    </p>
                  </div>
                )}
                {!reportableAccounts.length && (
                  <div className="empty-state">
                    <p>
                      {reportConnectionIssue
                        ? `${providerCopy(reportConnectionIssue.provider).name} нужно переподключить, чтобы получить данные для отчёта.`
                        : "Для отчёта нужен подключённый и выбранный кабинет Meta Ads или Google Ads."}
                    </p>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setSection("connections")}
                    >
                      {reportConnectionIssue
                        ? "Открыть подключения"
                        : "Перейти к подключениям"}
                    </button>
                  </div>
                )}
              </section>
              <aside className="report-preview-card" aria-label="Отчёт">
                <div className="report-preview-card__topline">
                  <span>{reportCardCopy.eyebrow}</span>
                  <span>{reportFormat.toUpperCase()}</span>
                </div>
                <div className="report-preview-card__body">
                  <span>HOLYMEDIA MCP</span>
                  <strong>{reportCardCopy.title}</strong>
                  <em>
                    {reportPreview
                      ? `${reportPreview.period.startDate} — ${reportPreview.period.endDate} · ${reportPreview.account.name}`
                      : selectedReportAccount
                        ? `${reportDays} дней · ${selectedReportAccount.account.displayName}`
                        : reportCardCopy.noAccount}
                  </em>
                  <small>{reportFormatLabel}</small>
                </div>
                <p className="report-preview-card__footer">
                  {reportCardCopy.footer}
                </p>
              </aside>
            </div>
          </section>
        )}

        {section === "analysis" && (
          <section
            className="section coming-soon-panel"
            aria-labelledby="site-audit-coming-soon-title"
          >
            <div className="section-head">
              <div>
                <p className="eyebrow">Инструменты</p>
                <h1 id="site-audit-coming-soon-title">
                  Анализ сайта скоро вернётся
                </h1>
                <p className="section-head__sub">
                  Мы временно приостановили запуск новых аудитов. Существующие
                  данные и отчёты сохранены.
                </p>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setSection("overview")}
              >
                Вернуться в обзор
              </button>
            </div>
          </section>
        )}

        {section === "analysis" && SITE_AUDIT_PRODUCT_ENABLED && active && (
          <SiteAuditV3
            workspaceId={active.id}
            csrf={csrf}
            notify={notify}
            fail={fail}
          />
        )}

        {section === "analysis" &&
          SITE_AUDIT_PRODUCT_ENABLED &&
          Boolean(analysisResult) && (
            <section className="section" aria-labelledby="analysis-title">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Инструменты</p>
                  <h1 id="analysis-title">Анализ сайта</h1>
                  <p className="section-head__sub">
                    Разберите публичную страницу и получите список понятных
                    улучшений для первого экрана, структуры и следующего шага.
                  </p>
                </div>
              </div>
              <div className="analysis-layout">
                <section className="panel analysis-panel">
                  <form className="site-analysis-form" onSubmit={analyzeSite}>
                    <label className="full-field">
                      Адрес сайта
                      <input
                        type="url"
                        required
                        value={analysisUrl}
                        onChange={(event) => setAnalysisUrl(event.target.value)}
                        placeholder="https://example.com"
                      />
                    </label>
                    <fieldset className="analysis-mode full-field">
                      <legend>Глубина проверки</legend>
                      <button
                        className={analysisMode === "quick" ? "is-active" : ""}
                        type="button"
                        aria-pressed={analysisMode === "quick"}
                        onClick={() => setAnalysisMode("quick")}
                      >
                        Быстрая
                      </button>
                      <button
                        className={analysisMode === "full" ? "is-active" : ""}
                        type="button"
                        aria-pressed={analysisMode === "full"}
                        onClick={() => setAnalysisMode("full")}
                      >
                        Полная
                      </button>
                    </fieldset>
                    <details className="analysis-brief full-field">
                      <summary>Уточнить задачу</summary>
                      <div className="analysis-brief__fields">
                        <label>
                          Тип сайта
                          <select
                            value={analysisBrief.siteType}
                            onChange={(event) =>
                              setAnalysisBrief((current) => ({
                                ...current,
                                siteType: event.target.value,
                              }))
                            }
                          >
                            <option value="">Определить по странице</option>
                            <option value="landing">Лендинг</option>
                            <option value="corporate">Сайт компании</option>
                            <option value="ecommerce">Интернет-магазин</option>
                            <option value="services">Услуги</option>
                          </select>
                        </label>
                        <label>
                          Цель
                          <select
                            value={analysisBrief.goal}
                            onChange={(event) =>
                              setAnalysisBrief((current) => ({
                                ...current,
                                goal: event.target.value,
                              }))
                            }
                          >
                            <option value="">Определить по странице</option>
                            <option value="Заявки">Заявки</option>
                            <option value="Продажи">Продажи</option>
                            <option value="Звонки">Звонки</option>
                            <option value="Записи">Записи</option>
                          </select>
                        </label>
                        <label>
                          Аудитория
                          <input
                            value={analysisBrief.audience}
                            maxLength={400}
                            onChange={(event) =>
                              setAnalysisBrief((current) => ({
                                ...current,
                                audience: event.target.value,
                              }))
                            }
                            placeholder="Кому вы продаёте"
                          />
                        </label>
                        <label>
                          Город или страна
                          <input
                            value={analysisBrief.region}
                            maxLength={160}
                            onChange={(event) =>
                              setAnalysisBrief((current) => ({
                                ...current,
                                region: event.target.value,
                              }))
                            }
                            placeholder="Например, Казахстан"
                          />
                        </label>
                        <label>
                          Конкурент
                          <input
                            value={analysisBrief.competitor}
                            maxLength={240}
                            onChange={(event) =>
                              setAnalysisBrief((current) => ({
                                ...current,
                                competitor: event.target.value,
                              }))
                            }
                            placeholder="Необязательно"
                          />
                        </label>
                        <label>
                          Что беспокоит
                          <input
                            value={analysisBrief.concern}
                            maxLength={400}
                            onChange={(event) =>
                              setAnalysisBrief((current) => ({
                                ...current,
                                concern: event.target.value,
                              }))
                            }
                            placeholder="Например, мало заявок"
                          />
                        </label>
                      </div>
                    </details>
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={analysisBusy}
                    >
                      {analysisBusy ? "Проверяем…" : "Проанализировать сайт"}
                    </button>
                  </form>
                  {analysisBusy && (
                    <ol className="analysis-progress" aria-live="polite">
                      <li className="is-active">
                        Открываем публичную страницу
                      </li>
                      <li className={analysisStage > 0 ? "is-active" : ""}>
                        Изучаем структуру и контент
                      </li>
                      <li>Собираем рекомендации</li>
                    </ol>
                  )}
                  {analysisResult && (
                    <div className="analysis-result" aria-live="polite">
                      <div className="analysis-result__head">
                        <div>
                          <span className="eyebrow">Результат</span>
                          <h2>{analysisResult.url}</h2>
                        </div>
                        <span className="status-badge ok">Готово</span>
                      </div>
                      <p className="analysis-verdict">
                        {analysisResult.result.overview?.verdict}
                      </p>
                      <div className="analysis-scores">
                        {(analysisResult.result.scores ?? []).map((score) => (
                          <div key={score.id}>
                            <strong>{score.value}</strong>
                            <span>{score.label}</span>
                          </div>
                        ))}
                      </div>
                      <div
                        className="analysis-tabs"
                        role="tablist"
                        aria-label="Разделы анализа"
                      >
                        {(
                          [
                            ["priorities", "Приоритеты"],
                            ["hero", "Первый экран"],
                            ["plan", "План"],
                            ["details", "Детали"],
                          ] as const
                        ).map(([id, label]) => (
                          <button
                            className={analysisTab === id ? "is-active" : ""}
                            type="button"
                            role="tab"
                            aria-selected={analysisTab === id}
                            key={id}
                            onClick={() => setAnalysisTab(id)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {analysisTab === "priorities" && (
                        <div className="analysis-priorities">
                          {(analysisResult.result.topIssues ?? []).map(
                            (item, index) => (
                              <article key={`${item.title}-${index}`}>
                                <span>{item.priority}</span>
                                <h3>{item.title}</h3>
                                <p>{item.problem}</p>
                                <small>{item.evidence}</small>
                                <strong>{item.recommendation}</strong>
                              </article>
                            ),
                          )}
                          <div className="analysis-quick-wins">
                            <h3>Быстрые улучшения</h3>
                            <ul>
                              {(analysisResult.result.quickWins ?? []).map(
                                (item, index) => (
                                  <li key={`${item.title}-${index}`}>
                                    {item.title}
                                  </li>
                                ),
                              )}
                            </ul>
                          </div>
                        </div>
                      )}
                      {analysisTab === "hero" && (
                        <div className="analysis-copy-card">
                          <span>Главный заголовок</span>
                          <h3>{analysisResult.result.hero?.h1}</h3>
                          <p>{analysisResult.result.hero?.subtitle}</p>
                          <strong>{analysisResult.result.hero?.cta}</strong>
                        </div>
                      )}
                      {analysisTab === "plan" && (
                        <div className="analysis-plan">
                          <h3>План на один рабочий день</h3>
                          <ol>
                            {(analysisResult.result.oneDayPlan ?? []).map(
                              (item, index) => (
                                <li key={`${item.title}-${index}`}>
                                  {item.title}
                                </li>
                              ),
                            )}
                          </ol>
                          <h3>Рекомендуемая структура</h3>
                          <ol>
                            {(analysisResult.result.structure ?? []).map(
                              (item) => (
                                <li key={item}>{item}</li>
                              ),
                            )}
                          </ol>
                          {(analysisResult.result.questions ?? []).length >
                            0 && (
                            <>
                              <h3>Что уточнить</h3>
                              <ul>
                                {analysisResult.result.questions?.map(
                                  (item) => (
                                    <li key={item}>{item}</li>
                                  ),
                                )}
                              </ul>
                            </>
                          )}
                        </div>
                      )}
                      {analysisTab === "details" && (
                        <>
                          <dl className="analysis-checks">
                            <div>
                              <dt>HTTPS</dt>
                              <dd>
                                {analysisResult.result.checks?.https
                                  ? "Да"
                                  : "Нет"}
                              </dd>
                            </div>
                            <div>
                              <dt>Заголовок страницы</dt>
                              <dd>
                                {analysisResult.result.checks?.hasTitle
                                  ? "Есть"
                                  : "Нет"}
                              </dd>
                            </div>
                            <div>
                              <dt>Описание</dt>
                              <dd>
                                {analysisResult.result.checks?.hasDescription
                                  ? "Есть"
                                  : "Нет"}
                              </dd>
                            </div>
                            <div>
                              <dt>Один H1</dt>
                              <dd>
                                {analysisResult.result.checks?.hasSingleH1
                                  ? "Да"
                                  : "Проверьте"}
                              </dd>
                            </div>
                          </dl>
                          <p className="analysis-limitations">
                            {analysisResult.result.evidence?.limitations}
                          </p>
                        </>
                      )}
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() =>
                          void downloadSiteAnalysis(analysisResult)
                        }
                      >
                        Скачать отчёт DOCX
                      </button>
                    </div>
                  )}
                </section>
                <aside className="analysis-aside">
                  <h2>Последние проверки</h2>
                  {analysisHistory.length ? (
                    <ul className="analysis-history">
                      {analysisHistory.slice(0, 5).map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => setAnalysisResult(item)}
                          >
                            <strong>{item.url}</strong>
                            <small>
                              {new Date(item.created_at).toLocaleDateString(
                                "ru-RU",
                              )}
                            </small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty-inline">
                      Здесь появятся ваши проверки.
                    </p>
                  )}
                </aside>
              </div>
            </section>
          )}

        {section === "profile" && (
          <section className="section" aria-labelledby="profile-title">
            <div className="section-head">
              <div>
                <p className="eyebrow">Аккаунт</p>
                <h1 id="profile-title">Профиль</h1>
                <p className="section-head__sub">
                  Личные данные и безопасность аккаунта.
                </p>
              </div>
            </div>
            <div className="profile-grid">
              <section className="panel profile-card">
                <div className="avatar-editor">
                  {avatar ? (
                    <img src={avatar} alt="Фото профиля" />
                  ) : (
                    <span aria-hidden="true">
                      {profile?.name?.charAt(0).toUpperCase() || "H"}
                    </span>
                  )}
                  <label className="secondary-button btn--small">
                    Изменить фото
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => void uploadAvatar(event)}
                    />
                  </label>
                  <small>JPG, PNG или WebP, до 2 МБ</small>
                </div>
                <form onSubmit={saveProfile}>
                  <label>
                    Имя
                    <input
                      value={profileName}
                      onChange={(event) => setProfileName(event.target.value)}
                      minLength={2}
                      maxLength={160}
                      required
                    />
                  </label>
                  <label>
                    Email
                    <input value={profile?.email ?? ""} readOnly />
                  </label>
                  <div className="profile-summary">
                    <span>Подключено платформ</span>
                    <strong>{connectedCount}</strong>
                  </div>
                  <button className="primary-button" type="submit">
                    Сохранить
                  </button>
                </form>
              </section>
              <section className="panel profile-card">
                <h2>Сменить пароль</h2>
                <form onSubmit={changePassword}>
                  <label>
                    Текущий пароль
                    <input
                      name="current_password"
                      type="password"
                      autoComplete="current-password"
                      required
                    />
                  </label>
                  <label>
                    Новый пароль
                    <input
                      name="new_password"
                      type="password"
                      minLength={12}
                      autoComplete="new-password"
                      required
                    />
                    <small>Не менее 12 символов</small>
                  </label>
                  <button className="primary-button" type="submit">
                    Сменить пароль
                  </button>
                </form>
              </section>
              <SubscriptionInfo
                subscription={subscription}
                onOpenTariffs={() => setSection("tariffs")}
              />
            </div>
            {active && <CompanyTeam workspace={active} canManage={canManage} />}
          </section>
        )}
      </div>

      {active && <FeedbackBlock workspaceId={active.id} />}
      <SiteFooter compact />

      {reportPickerOpen && (
        <div
          className="modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeReportPicker();
          }}
        >
          <section
            className="modal__panel modal__panel--wide report-picker-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-picker-title"
          >
            <div className="report-picker__head">
              <div>
                <p className="eyebrow">ОТЧЁТЫ · ШАГ 1 ИЗ 2</p>
                <h2 id="report-picker-title">
                  {reportPickerConnection
                    ? `Кабинеты ${providerCopy(reportPickerConnection.provider).name}`
                    : "Выберите рекламную платформу"}
                </h2>
                <p>
                  {reportPickerConnection
                    ? "Выберите один включённый кабинет для этого отчёта."
                    : "Сначала выберите платформу, затем рекламный кабинет."}
                </p>
              </div>
              <button
                className="modal__close account-selector__close"
                type="button"
                autoFocus
                aria-label="Закрыть выбор кабинета для отчёта"
                onClick={closeReportPicker}
              >
                ×
              </button>
            </div>

            {reportPickerConnection ? (
              <>
                <div className="report-picker__controls">
                  <button
                    className="secondary-button btn--small"
                    type="button"
                    onClick={() => {
                      setReportPickerProvider(null);
                      setReportAccountSearch("");
                    }}
                  >
                    Назад к платформам
                  </button>
                </div>
                <label className="account-selector__search">
                  <span>Поиск кабинета</span>
                  <input
                    autoFocus
                    value={reportAccountSearch}
                    onChange={(event) =>
                      setReportAccountSearch(event.target.value)
                    }
                    placeholder="Название или ID"
                  />
                </label>
                <div className="report-account-list" aria-live="polite">
                  {reportPickerAccounts.map((account) => {
                    const status = reportAccountStatus(account.status);
                    return (
                      <button
                        className={`report-account-option ${
                          status.inactive ? "is-inactive" : ""
                        }`}
                        type="button"
                        key={account.id}
                        onClick={() =>
                          selectReportAccount({
                            account,
                            connection: reportPickerConnection,
                          })
                        }
                      >
                        <span>
                          <strong>{account.displayName}</strong>
                          <small>{account.externalAccountId}</small>
                        </span>
                        <em className={`report-account-status ${status.tone}`}>
                          {status.label}
                        </em>
                      </button>
                    );
                  })}
                </div>
                {!reportPickerAccounts.length && (
                  <div className="empty-state report-picker__empty">
                    <p>
                      Включённых кабинетов по этому запросу не найдено. Выберите
                      их в разделе «Подключения».
                    </p>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() =>
                        openReportConnections(reportPickerConnection.provider)
                      }
                    >
                      Открыть подключения
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="report-provider-grid" aria-live="polite">
                {reportPickerConnections.map((connection) => {
                  const supported = ["GOOGLE_ADS", "META_ADS"].includes(
                    connection.provider,
                  );
                  const selectable =
                    connection.status === "CONNECTED" && supported;
                  return (
                    <article
                      className={`report-provider-option ${
                        selectable ? "" : "is-unavailable"
                      }`}
                      key={connection.id}
                    >
                      <div className="report-provider-option__summary">
                        <span
                          className={`provider-mark provider-mark--${connection.provider.toLowerCase()}`}
                          aria-hidden="true"
                        >
                          {providerCopy(connection.provider).short}
                        </span>
                        <span className="report-provider-option__copy">
                          <strong>
                            {providerCopy(connection.provider).name}
                          </strong>
                          <small>
                            {providerCopy(connection.provider).description}
                          </small>
                        </span>
                      </div>
                      <span
                        className={`status-badge ${
                          connectionStatus(connection.status).tone
                        }`}
                      >
                        {connectionStatus(connection.status).label}
                      </span>
                      {selectable ? (
                        <button
                          className="secondary-button btn--small"
                          type="button"
                          onClick={() => openReportProvider(connection)}
                        >
                          Показать кабинеты
                        </button>
                      ) : connection.status === "REAUTH_REQUIRED" ||
                        connection.status === "DEGRADED" ? (
                        <button
                          className="secondary-button btn--small"
                          type="button"
                          onClick={() =>
                            openReportConnections(connection.provider)
                          }
                        >
                          Переподключить
                        </button>
                      ) : (
                        <span className="report-provider-option__note">
                          {supported
                            ? "Сначала подключите платформу"
                            : "Генерация недоступна"}
                        </span>
                      )}
                    </article>
                  );
                })}
                {!reportPickerConnections.length && (
                  <div className="empty-state report-picker__empty">
                    <p>
                      Подключите Meta Ads или Google Ads и включите нужный
                      кабинет, чтобы сформировать отчёт.
                    </p>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => openReportConnections()}
                    >
                      Открыть подключения
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {selectorConnection && (
        <div
          className="modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeAccountSelector();
          }}
        >
          <section
            className="modal__panel modal__panel--wide account-selector-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-selector-title"
          >
            <div className="account-selector__head">
              <div>
                <h2 id="account-selector-title">
                  {language === "en"
                    ? `Select ${selectorLabel}`
                    : `Выберите ${selectorLabel}`}
                </h2>
                <p>
                  {language === "en"
                    ? `${selectorSelected.size} of ${selectorConnection.accounts.length} selected`
                    : `${selectorSelected.size} из ${selectorConnection.accounts.length} выбрано`}
                </p>
              </div>
              {selectorConnection.accounts.length > 0 && (
                <div className="bulk-actions">
                  <button
                    type="button"
                    onClick={() =>
                      setDrafts((current) => ({
                        ...current,
                        [selectorConnection.id]:
                          selectorConnection.accounts.map(
                            (account) => account.id,
                          ),
                      }))
                    }
                  >
                    {language === "en" ? "Select all" : "Выбрать все"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDrafts((current) => ({
                        ...current,
                        [selectorConnection.id]: [],
                      }))
                    }
                  >
                    {language === "en" ? "Clear all" : "Снять все"}
                  </button>
                </div>
              )}
              <button
                className="modal__close account-selector__close"
                type="button"
                aria-label={
                  language === "en"
                    ? `Close ${selectorLabel} selection`
                    : `Закрыть выбор: ${selectorLabel}`
                }
                onClick={closeAccountSelector}
              >
                ×
              </button>
            </div>
            {selectorConnection.accounts.length ? (
              <>
                <label className="account-selector__search">
                  <span>
                    {language === "en"
                      ? `Search ${selectorLabel}`
                      : `Поиск: ${selectorLabel}`}
                  </span>
                  <input
                    autoFocus
                    value={accountSearch}
                    onChange={(event) => setAccountSearch(event.target.value)}
                    placeholder={
                      language === "en" ? "Name or ID" : "Название или ID"
                    }
                  />
                </label>
                <p className="account-selector__hint">
                  {language === "en"
                    ? "Status is shown only when it is supplied by the connected platform."
                    : "Статус показываем только если его передала подключённая платформа."}
                </p>
                <div className="account-list" aria-live="polite">
                  {selectorAccounts.map((account) => {
                    const inactive = isInactiveProviderAccount(account.status);
                    return (
                      <label
                        className={`account-row ${inactive ? "is-inactive" : ""}`}
                        key={account.id}
                      >
                        <input
                          type="checkbox"
                          checked={selectorSelected.has(account.id)}
                          onChange={() =>
                            toggleDraft(selectorConnection.id, account.id)
                          }
                        />
                        <span>
                          <strong>{account.displayName}</strong>
                          <small>{account.externalAccountId}</small>
                          {selectorUsesProperties &&
                            (account.accountName ||
                              account.timezone ||
                              account.currency) && (
                              <small>
                                {[
                                  account.accountName,
                                  account.timezone,
                                  account.currency,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </small>
                            )}
                        </span>
                        {inactive && (
                          <em>
                            {language === "en" ? "Inactive" : "Неактивен"}
                          </em>
                        )}
                      </label>
                    );
                  })}
                </div>
                {!selectorAccounts.length && (
                  <p className="empty-inline">
                    {language === "en"
                      ? `No ${selectorLabel} match this search.`
                      : `По этому запросу ${selectorLabel} не найдены.`}
                  </p>
                )}
                <div className="account-selector__save">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={closeAccountSelector}
                  >
                    {language === "en" ? "Cancel" : "Отмена"}
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={savingAccounts === selectorConnection.id}
                    onClick={() => void saveAccounts(selectorConnection)}
                  >
                    {savingAccounts === selectorConnection.id
                      ? language === "en"
                        ? "Saving…"
                        : "Сохраняем…"
                      : language === "en"
                        ? "Save selection"
                        : "Сохранить выбор"}
                  </button>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <p>
                  {language === "en"
                    ? `No ${selectorLabel} have been found yet.`
                    : `${selectorLabel[0]!.toUpperCase()}${selectorLabel.slice(1)} пока не найдены.`}
                </p>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void refreshAccounts(selectorConnection)}
                >
                  {language === "en"
                    ? `Find ${selectorLabel}`
                    : `Найти ${selectorLabel}`}
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {confirm && (
        <div
          className="modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirm(null);
          }}
        >
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <h2 id="confirm-title">{confirm.title}</h2>
            <p>{confirm.description}</p>
            <div className="confirm-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setConfirm(null)}
              >
                Отмена
              </button>
              <button
                className="danger-button"
                type="button"
                autoFocus
                onClick={() => {
                  const action = confirm.run;
                  setConfirm(null);
                  void action();
                }}
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function ClientInstructions({
  client,
  language,
  onCopyUrl,
}: {
  client: Client;
  language: "ru" | "en";
  onCopyUrl: () => void;
}) {
  if (client === "codex") return <CodexInstructions language={language} />;
  if (client === "claude")
    return <ClaudeInstructions language={language} onCopyUrl={onCopyUrl} />;
  return <ChatGPTInstructions language={language} onCopyUrl={onCopyUrl} />;
}

function OAuthKeyNote({
  client,
  language,
}: {
  client: Exclude<Client, "codex">;
  language: "ru" | "en";
}) {
  const ru = language === "ru";
  const clientName = client === "claude" ? "Claude" : "ChatGPT";
  return (
    <div className="oauth-key-note" role="note" data-language-static>
      <div className="oauth-key-note__icon" aria-hidden="true">
        ✓
      </div>
      <div>
        <h2>{ru ? "Ключ доступа не требуется" : "No access key required"}</h2>
        <p>
          {ru
            ? `${clientName} подключается к HolyMedia MCP через безопасную OAuth-авторизацию. Создавать и копировать MCP-ключ для ${clientName} не нужно.`
            : `${clientName} connects to HolyMedia MCP through secure OAuth authorization. You do not need to create or copy an MCP key for ${clientName}.`}
        </p>
        <small>
          {ru
            ? `После создания подключения ${clientName} откроет страницу HolyMedia MCP для входа и подтверждения доступа.`
            : `After adding the connector, ${clientName} opens HolyMedia MCP so you can sign in and approve access.`}
        </small>
      </div>
    </div>
  );
}

function ClaudeInstructions({
  language,
  onCopyUrl,
}: {
  language: "ru" | "en";
  onCopyUrl: () => void;
}) {
  const ru = language === "ru";
  return (
    <div
      className="client-panel client-panel--codex client-panel--claude"
      role="tabpanel"
      data-language-static
    >
      <h3>Claude</h3>
      <p className="client-panel__intro">
        {ru
          ? "Подключение выполняется через OAuth. Ключ доступа создавать и копировать не нужно."
          : "Claude connects through OAuth. You do not need to create or copy an access key."}
      </p>
      <ol className="codex-steps claude-steps">
        <li>
          <strong>
            {ru ? "Откройте настройки Claude" : "Open Claude settings"}
          </strong>
          <span>
            {ru
              ? "Откройте Claude Desktop и перейдите: File → Settings."
              : "Open Claude Desktop and go to File → Settings."}
          </span>
        </li>
        <li>
          <strong>{ru ? "Откройте Connectors" : "Open Connectors"}</strong>
          <span>
            {ru
              ? "В левом меню откройте: Customize → Connectors."
              : "In the left menu, open Customize → Connectors."}
          </span>
        </li>
        <li>
          <strong>
            {ru ? "Добавьте custom connector" : "Add a custom connector"}
          </strong>
          <span>
            {ru
              ? "В правом верхнем углу нажмите Add → Add custom connector."
              : "In the upper-right corner, select Add → Add custom connector."}
          </span>
        </li>
        <li>
          <strong>
            {ru
              ? "Заполните данные HolyMedia MCP"
              : "Enter the HolyMedia MCP details"}
          </strong>
          <dl className="codex-config oauth-config">
            <div>
              <dt>Name</dt>
              <dd>
                <code>HolyMedia MCP</code>
              </dd>
            </div>
            <div>
              <dt>Remote MCP server URL</dt>
              <dd className="oauth-config__url">
                <code>{MCP_URL}</code>
                <button
                  className="token-action oauth-config__copy"
                  type="button"
                  onClick={onCopyUrl}
                >
                  {ru ? "Скопировать" : "Copy"}
                </button>
              </dd>
            </div>
          </dl>
        </li>
        <li>
          <strong>
            {ru ? "Настройте авторизацию" : "Configure authorization"}
          </strong>
          <dl className="codex-config">
            <div>
              <dt>Authentication</dt>
              <dd>
                <code>Always required</code>
              </dd>
            </div>
            <div>
              <dt>OAuth client</dt>
              <dd>
                <code>No client ID — register one automatically</code>
              </dd>
            </div>
          </dl>
          <small>{ru ? "После этого нажмите Add." : "Then select Add."}</small>
        </li>
        <li>
          <strong>
            {ru ? "Подключите HolyMedia MCP" : "Connect HolyMedia MCP"}
          </strong>
          <span>
            {ru
              ? "После добавления HolyMedia MCP нажмите Connect."
              : "After adding HolyMedia MCP, select Connect."}
          </span>
        </li>
        <li>
          <strong>
            {ru ? "Войдите в HolyMedia MCP" : "Sign in to HolyMedia MCP"}
          </strong>
          <span>
            {ru
              ? "Claude откроет страницу HolyMedia MCP в браузере. Войдите в свой аккаунт."
              : "Claude opens HolyMedia MCP in your browser. Sign in to your account."}
          </span>
        </li>
        <li>
          <strong>
            {ru ? "Разрешите доступ Claude" : "Allow Claude access"}
          </strong>
          <span>
            {ru
              ? "На странице «Подключить Claude» нажмите «Разрешить»."
              : "On the Connect Claude page, select Allow."}
          </span>
          <small>
            {ru
              ? "Claude получит доступ только к данным вашей текущей компании и подключённым в HolyMedia MCP рекламным кабинетам."
              : "Claude receives access only to your current company and its advertising accounts connected in HolyMedia MCP."}
          </small>
        </li>
        <li>
          <strong>{ru ? "Вернитесь в Claude" : "Return to Claude"}</strong>
          <span>
            {ru
              ? "После успешной авторизации вернитесь в Claude. HolyMedia MCP должен отображаться со статусом Connected."
              : "After authorization, return to Claude. HolyMedia MCP should show the Connected status."}
          </span>
        </li>
        <li>
          <strong>
            {ru ? "Проверьте подключение" : "Verify the connection"}
          </strong>
          <span>
            {ru ? "Откройте новый чат и напишите:" : "Open a new chat and ask:"}
          </span>
          <div className="oauth-prompts">
            <code>
              {ru
                ? "Покажи мои подключённые рекламные кабинеты."
                : "Show my connected advertising accounts."}
            </code>
            <code>
              {ru
                ? "Покажи активные кампании Google Ads."
                : "Show active Google Ads campaigns."}
            </code>
          </div>
        </li>
      </ol>

      <aside className="oauth-callout" aria-labelledby="claude-important-title">
        <strong id="claude-important-title">
          {ru ? "Важно" : "Important"}
        </strong>
        <p>
          {ru
            ? "Для Claude MCP-ключ не используется. Не создавайте отдельный ключ в разделе «AI-клиент» специально для Claude — авторизация выполняется через ваш аккаунт HolyMedia MCP."
            : "Claude does not use an MCP key. Do not create a separate AI client key for Claude — authorization uses your HolyMedia MCP account."}
        </p>
      </aside>

      <section
        className="oauth-troubleshooting"
        aria-labelledby="claude-troubleshooting-title"
      >
        <h4 id="claude-troubleshooting-title">
          {ru ? "Если не работает" : "If it does not work"}
        </h4>
        <dl>
          <div>
            <dt>
              {ru
                ? "Не появляется подключение"
                : "The connection does not appear"}
            </dt>
            <dd>
              {ru
                ? `Проверьте, что указан URL ${MCP_URL} и connector добавлен в разделе Customize → Connectors.`
                : `Check that the URL is ${MCP_URL} and the connector was added in Customize → Connectors.`}
            </dd>
          </div>
          <div>
            <dt>
              {ru
                ? "Claude просит авторизоваться"
                : "Claude asks you to sign in"}
            </dt>
            <dd>
              {ru
                ? "Нажмите Connect и войдите в HolyMedia MCP."
                : "Select Connect and sign in to HolyMedia MCP."}
            </dd>
          </div>
          <div>
            <dt>
              {ru
                ? "Рекламных кабинетов нет"
                : "No advertising accounts appear"}
            </dt>
            <dd>
              {ru
                ? "Откройте HolyMedia MCP → Подключения и убедитесь, что нужная рекламная платформа и кабинеты подключены."
                : "Open HolyMedia MCP → Connections and confirm that the required platform and accounts are connected."}
            </dd>
          </div>
          <div>
            <dt>
              {ru
                ? "Отдельная рекламная платформа требует повторного входа"
                : "One advertising platform asks you to reconnect"}
            </dt>
            <dd>
              {ru
                ? "Переподключите только эту платформу в разделе «Подключения». Повторно подключать Claude не требуется."
                : "Reconnect only that platform in Connections. You do not need to reconnect Claude."}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function ChatGPTInstructions({
  language,
  onCopyUrl,
}: {
  language: "ru" | "en";
  onCopyUrl: () => void;
}) {
  const ru = language === "ru";
  return (
    <div
      className="client-panel client-panel--codex client-panel--chatgpt"
      role="tabpanel"
      data-language-static
    >
      <h3>ChatGPT</h3>
      <p className="client-panel__intro">
        {ru
          ? "Подключение выполняется через OAuth. Ключ доступа создавать и копировать не нужно."
          : "ChatGPT connects through OAuth. You do not need to create or copy an access key."}
      </p>
      <ol className="codex-steps chatgpt-steps">
        <li>
          <strong>
            {ru ? "Откройте настройки ChatGPT" : "Open ChatGPT settings"}
          </strong>
          <span>
            {ru
              ? "Откройте меню профиля ChatGPT и нажмите «Настройки»."
              : "Open the ChatGPT profile menu and select Settings."}
          </span>
        </li>
        <li>
          <strong>{ru ? "Откройте раздел «Плагины»" : "Open Plugins"}</strong>
          <span>
            {ru
              ? "В левом меню настроек выберите «Плагины»."
              : "In the settings sidebar, select Plugins."}
          </span>
        </li>
        <li>
          <strong>
            {ru ? "Откройте список плагинов" : "Open the plugins list"}
          </strong>
          <span>
            {ru
              ? "Прокрутите страницу вниз и нажмите «Просмотреть плагины»."
              : "Scroll down and select Browse plugins."}
          </span>
        </li>
        <li>
          <strong>
            {ru ? "Создайте новый плагин" : "Create a new plugin"}
          </strong>
          <span>
            {ru
              ? "В правом верхнем углу нажмите кнопку «+». Откроется окно «Новый плагин»."
              : "Select the + button in the upper-right corner. The New plugin dialog opens."}
          </span>
        </li>
        <li>
          <strong>
            {ru
              ? "Заполните данные HolyMedia MCP"
              : "Enter the HolyMedia MCP details"}
          </strong>
          <dl className="codex-config oauth-config">
            <div>
              <dt>{ru ? "Название" : "Name"}</dt>
              <dd>
                <code>HolyMedia MCP</code>
              </dd>
            </div>
            <div>
              <dt>{ru ? "Описание" : "Description"}</dt>
              <dd>
                {ru
                  ? "Работа с подключёнными рекламными кабинетами через HolyMedia MCP"
                  : "Work with connected advertising accounts through HolyMedia MCP"}
              </dd>
            </div>
            <div>
              <dt>{ru ? "Подключение" : "Connection"}</dt>
              <dd>
                <code>{ru ? "URL-адрес сервера" : "Server URL"}</code>
              </dd>
            </div>
            <div>
              <dt>URL</dt>
              <dd className="oauth-config__url">
                <code>{MCP_URL}</code>
                <button
                  className="token-action oauth-config__copy"
                  type="button"
                  onClick={onCopyUrl}
                >
                  {ru ? "Скопировать" : "Copy"}
                </button>
              </dd>
            </div>
            <div>
              <dt>{ru ? "Аутентификация" : "Authentication"}</dt>
              <dd>
                <code>OAuth</code>
              </dd>
            </div>
          </dl>
        </li>
        <li>
          <strong>
            {ru ? "Подтвердите подключение" : "Confirm the connection"}
          </strong>
          <span>
            {ru
              ? "Поставьте галочку «Я понимаю и хочу продолжить» и нажмите «Создать»."
              : "Select “I understand and want to continue”, then select Create."}
          </span>
          <small>
            {ru
              ? "ChatGPT автоматически определит параметры OAuth HolyMedia MCP. Расширенные настройки менять не нужно."
              : "ChatGPT automatically discovers HolyMedia MCP OAuth settings. You do not need to change advanced settings."}
          </small>
        </li>
        <li>
          <strong>
            {ru
              ? "Войдите через HolyMedia MCP"
              : "Sign in through HolyMedia MCP"}
          </strong>
          <span>
            {ru
              ? "После создания нажмите «Войти через HolyMedia MCP». ChatGPT откроет страницу HolyMedia MCP в браузере."
              : "After creating it, select “Sign in through HolyMedia MCP”. ChatGPT opens HolyMedia MCP in your browser."}
          </span>
        </li>
        <li>
          <strong>
            {ru ? "Войдите в аккаунт" : "Sign in to your account"}
          </strong>
          <span>
            {ru
              ? "Войдите в свой аккаунт HolyMedia MCP, если вы ещё не авторизованы. При активной сессии этот шаг пропустится автоматически."
              : "Sign in to your HolyMedia MCP account if needed. An active session continues automatically."}
          </span>
        </li>
        <li>
          <strong>
            {ru ? "Разрешите доступ ChatGPT" : "Allow ChatGPT access"}
          </strong>
          <span>
            {ru
              ? "На странице «Подключить ChatGPT» нажмите «Разрешить»."
              : "On the Connect ChatGPT page, select Allow."}
          </span>
          <small>
            {ru
              ? "ChatGPT получит доступ только к данным вашей текущей компании и подключённым в HolyMedia MCP рекламным кабинетам."
              : "ChatGPT receives access only to your current company and its advertising accounts connected in HolyMedia MCP."}
          </small>
        </li>
        <li>
          <strong>{ru ? "Вернитесь в ChatGPT" : "Return to ChatGPT"}</strong>
          <span>
            {ru
              ? "После успешной авторизации вернитесь в ChatGPT. HolyMedia MCP должен отображаться как подключённый плагин."
              : "After authorization, return to ChatGPT. HolyMedia MCP should appear as a connected plugin."}
          </span>
        </li>
        <li>
          <strong>{ru ? "Проверьте работу" : "Verify the connection"}</strong>
          <span>
            {ru
              ? "Откройте новый чат ChatGPT и включите HolyMedia MCP, если он не активирован автоматически."
              : "Open a new ChatGPT chat and enable HolyMedia MCP if it is not active automatically."}
          </span>
          <div className="oauth-prompts">
            <code>
              {ru
                ? "Покажи мои подключённые рекламные кабинеты."
                : "Show my connected advertising accounts."}
            </code>
            <code>
              {ru
                ? "Покажи активные кампании Google Ads."
                : "Show active Google Ads campaigns."}
            </code>
            <code>
              {ru
                ? "Покажи расходы за последние 7 дней."
                : "Show spend for the last 7 days."}
            </code>
          </div>
        </li>
      </ol>

      <aside
        className="oauth-callout"
        aria-labelledby="chatgpt-important-title"
      >
        <strong id="chatgpt-important-title">
          {ru ? "Важно" : "Important"}
        </strong>
        <p>
          {ru
            ? "Для ChatGPT MCP-ключ не используется. Не создавайте отдельный ключ в разделе «AI-клиент» специально для ChatGPT — авторизация выполняется через ваш аккаунт HolyMedia MCP."
            : "ChatGPT does not use an MCP key. Do not create a separate AI client key for ChatGPT — authorization uses your HolyMedia MCP account."}
        </p>
        <p>
          {ru
            ? "Расширенные настройки OAuth обычно менять не требуется: ChatGPT определяет параметры подключения автоматически."
            : "You normally do not need to change advanced OAuth settings: ChatGPT discovers connection settings automatically."}
        </p>
      </aside>

      <section
        className="oauth-troubleshooting"
        aria-labelledby="chatgpt-troubleshooting-title"
      >
        <h4 id="chatgpt-troubleshooting-title">
          {ru ? "Если не работает" : "If it does not work"}
        </h4>
        <dl>
          <div>
            <dt>
              {ru
                ? "Не удаётся создать подключение"
                : "Cannot create the connection"}
            </dt>
            <dd>
              {ru
                ? `Проверьте URL ${MCP_URL} и убедитесь, что выбрана аутентификация OAuth.`
                : `Check the URL ${MCP_URL} and confirm OAuth authentication is selected.`}
            </dd>
          </div>
          <div>
            <dt>
              {ru
                ? "Не появляется окно входа"
                : "The sign-in window does not appear"}
            </dt>
            <dd>
              {ru
                ? "Откройте HolyMedia MCP в списке подключённых плагинов и нажмите «Войти через HolyMedia MCP» или «Подключить»."
                : "Open HolyMedia MCP in the connected plugins list and select “Sign in through HolyMedia MCP” or Connect."}
            </dd>
          </div>
          <div>
            <dt>
              {ru
                ? "Рекламных кабинетов нет"
                : "No advertising accounts appear"}
            </dt>
            <dd>
              {ru
                ? "Откройте HolyMedia MCP → Подключения и убедитесь, что нужная рекламная платформа и кабинеты подключены."
                : "Open HolyMedia MCP → Connections and confirm that the required platform and accounts are connected."}
            </dd>
          </div>
          <div>
            <dt>
              {ru
                ? "Отдельная рекламная платформа требует повторного входа"
                : "One advertising platform asks you to reconnect"}
            </dt>
            <dd>
              {ru
                ? "Переподключите только эту рекламную платформу в разделе «Подключения». Повторно создавать ChatGPT plugin не требуется."
                : "Reconnect only that advertising platform in Connections. You do not need to create the ChatGPT plugin again."}
            </dd>
          </div>
          <div>
            <dt>
              {ru
                ? "ChatGPT просит OAuth Client ID / Secret"
                : "ChatGPT asks for an OAuth Client ID / Secret"}
            </dt>
            <dd>
              {ru
                ? "Обычному пользователю это не требуется. Не вводите их вручную, если стандартное OAuth-подключение работает."
                : "Regular users do not need these. Do not enter them manually when standard OAuth setup works."}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function CodexInstructions({ language }: { language: "ru" | "en" }) {
  const ru = language === "ru";
  return (
    <div className="client-panel client-panel--codex" role="tabpanel">
      <h3>Codex</h3>
      <p className="client-panel__intro">
        {ru
          ? "Подключение выполняется только в HolyMedia MCP и настройках Codex — без терминала и переменных среды."
          : "Set up the connection entirely in HolyMedia MCP and Codex settings — no terminal or environment variables required."}
      </p>
      <ol className="codex-steps">
        <li>
          <strong>{ru ? "Создайте ключ Codex" : "Create a Codex key"}</strong>
          <span>
            {ru
              ? "В разделе «AI-клиент» выше введите название "
              : "In the AI client section above, name the key "}
            <code>Codex</code>
            {ru ? " и нажмите «Создать ключ»." : " and select Create key."}
          </span>
        </li>
        <li>
          <strong>{ru ? "Скопируйте ключ" : "Copy the key"}</strong>
          <span>
            {ru
              ? "Нажмите «Скопировать» в одноразовом окне. Не закрывайте его, пока ключ не скопирован: повторно он не показывается."
              : "Use Copy in the one-time dialog. Do not close it before copying: the key is not shown again."}
          </span>
        </li>
        <li>
          <strong>
            {ru ? "Откройте настройки Codex" : "Open Codex settings"}
          </strong>
          <span>
            {ru
              ? "Перейдите: «Настройки» → «Плагины» → «MCP» → «Добавить сервер»."
              : "Go to Settings → Plugins → MCP → Add server."}
          </span>
        </li>
        <li>
          <strong>
            {ru ? "Выберите тип подключения" : "Choose the connection type"}
          </strong>
          <span>
            {ru
              ? "Выберите «Потоковая передача HTTP». Не выбирайте STDIO."
              : "Choose Streaming HTTP. Do not select STDIO."}
          </span>
        </li>
        <li>
          <strong>
            {ru ? "Заполните основные поля" : "Complete the main fields"}
          </strong>
          <dl className="codex-config">
            <div>
              <dt>{ru ? "Имя" : "Name"}</dt>
              <dd>
                <code>HolyMedia MCP</code>
              </dd>
            </div>
            <div>
              <dt>URL</dt>
              <dd>
                <code>{MCP_URL}</code>
              </dd>
            </div>
            <div className="codex-config__empty">
              <dt>
                {ru
                  ? "Переменная окружения токена Bearer"
                  : "Bearer token environment variable"}
              </dt>
              <dd>{ru ? "Оставьте пустым." : "Leave empty."}</dd>
            </div>
          </dl>
        </li>
        <li>
          <strong>
            {ru
              ? "Добавьте Authorization header"
              : "Add the Authorization header"}
          </strong>
          <dl className="codex-config">
            <div>
              <dt>{ru ? "Ключ" : "Key"}</dt>
              <dd>
                <code>Authorization</code>
              </dd>
            </div>
            <div>
              <dt>{ru ? "Значение" : "Value"}</dt>
              <dd>
                <code>Bearer &lt;{ru ? "ваш ключ" : "your key"}&gt;</code>
              </dd>
            </div>
          </dl>
          <small>
            {ru
              ? "Между Bearer и ключом — один пробел. Не используйте кавычки и не повторяйте слово Bearer."
              : "Use one space between Bearer and the key. Do not use quotes or repeat Bearer."}
          </small>
        </li>
        <li>
          <strong>
            {ru ? "Сохраните подключение" : "Save the connection"}
          </strong>
          <span>
            {ru
              ? "Проверьте имя, URL и заголовок Authorization, затем нажмите «Сохранить»."
              : "Check the name, URL, and Authorization header, then select Save."}
          </span>
        </li>
        <li>
          <strong>
            {ru
              ? "Проверьте, что сервер включён"
              : "Confirm the server is enabled"}
          </strong>
          <span>
            {ru
              ? "В списке MCP найдите HolyMedia MCP и включите переключатель справа, если он выключен."
              : "Find HolyMedia MCP in the MCP list and turn on its switch if needed."}
          </span>
        </li>
        <li>
          <strong>
            {ru
              ? "Проверьте кабинеты в новом чате"
              : "Verify accounts in a new chat"}
          </strong>
          <span>
            {ru
              ? "Напишите: «Покажи мои подключённые рекламные кабинеты», затем запросите активные кампании или расходы за последние 7 дней."
              : "Ask: “Show my connected advertising accounts,” then request active campaigns or spend for the last 7 days."}
          </span>
        </li>
      </ol>
    </div>
  );
}

type CompanyProfile = {
  name: string;
  legalName: string | null;
  registrationNumber: string | null;
  registrationCountry: string;
  legalAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  websiteUrl: string | null;
  accessStatus: "PENDING" | "ACTIVE" | "SUSPENDED";
  onboardingCompletedAt: string | null;
};
type TeamMember = {
  userId: string;
  role: string;
  businessTitle: string | null;
  user: { name: string; email: string };
};
type TeamInvitation = {
  id: string;
  email: string;
  role: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
};

function CompanyTeam({
  workspace,
  canManage,
}: {
  workspace: Workspace;
  canManage: boolean;
}) {
  const language = useLanguage();
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const companyName = company?.onboardingCompletedAt
    ? company.name
    : "Название компании не указано";

  const load = async () => {
    const requests = [
      fetch(`${API}/api/v1/workspaces/${workspace.id}`, {
        credentials: "include",
      }),
      fetch(`${API}/api/v1/workspaces/${workspace.id}/members`, {
        credentials: "include",
      }),
      ...(canManage
        ? [
            fetch(`${API}/api/v1/workspaces/${workspace.id}/invitations`, {
              credentials: "include",
            }),
          ]
        : []),
    ];
    const responses = await Promise.all(requests);
    const companyResponse = responses[0]!;
    const memberResponse = responses[1]!;
    const invitationResponse = responses[2];
    if (companyResponse.ok)
      setCompany((await companyResponse.json()) as CompanyProfile);
    if (memberResponse.ok)
      setMembers((await memberResponse.json()) as TeamMember[]);
    if (invitationResponse?.ok)
      setInvitations((await invitationResponse.json()) as TeamInvitation[]);
  };

  useEffect(() => {
    void load();
  }, [workspace.id, canManage]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    setStatus("");
    const response = await fetch(
      `${API}/api/v1/workspaces/${workspace.id}/invitations`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": await csrf(),
        },
        body: JSON.stringify({ email: email.trim(), role: "MEMBER" }),
      },
    );
    if (!response.ok) return setStatus("Не удалось отправить приглашение.");
    setEmail("");
    setStatus("Приглашение отправлено.");
    await load();
  }

  async function invitationAction(
    invitation: TeamInvitation,
    action: "resend" | "revoke",
  ) {
    const response = await fetch(
      `${API}/api/v1/workspaces/${workspace.id}/invitations/${invitation.id}${action === "resend" ? "/resend" : ""}`,
      {
        method: action === "resend" ? "POST" : "DELETE",
        credentials: "include",
        headers: { "x-csrf-token": await csrf() },
      },
    );
    setStatus(
      response.ok
        ? action === "resend"
          ? "Приглашение отправлено повторно."
          : "Приглашение отозвано."
        : "Не удалось обновить приглашение.",
    );
    await load();
  }

  async function remove(member: TeamMember) {
    const response = await fetch(
      `${API}/api/v1/workspaces/${workspace.id}/members/${member.userId}`,
      {
        method: "DELETE",
        credentials: "include",
        headers: { "x-csrf-token": await csrf() },
      },
    );
    setStatus(
      response.ok
        ? "Участник удалён из компании."
        : "Не удалось удалить участника.",
    );
    await load();
  }

  return (
    <section
      className="panel company-team"
      aria-labelledby="company-team-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">КОМПАНИЯ</p>
          <h2 id="company-team-title">Профиль компании</h2>
          <p className="section-head__sub">
            {company?.accessStatus === "ACTIVE"
              ? "Доступ компании активен."
              : company?.accessStatus === "SUSPENDED"
                ? "Доступ компании приостановлен."
                : "Компания на проверке. Рабочие функции станут доступны после одобрения администратора."}
          </p>
        </div>
        {company && (
          <span
            className={`company-status company-status--${company.accessStatus.toLowerCase()}`}
          >
            {company.accessStatus === "ACTIVE"
              ? "Активна"
              : company.accessStatus === "SUSPENDED"
                ? "Приостановлена"
                : "На проверке"}
          </span>
        )}
      </div>
      {company && (
        <dl className="company-details">
          <div>
            <dt>Компания</dt>
            <dd>{companyName}</dd>
          </div>
          <div>
            <dt>Юридическое наименование</dt>
            <dd>{company.legalName || "—"}</dd>
          </div>
          <div>
            <dt>БИН / рег. номер</dt>
            <dd>{company.registrationNumber || "—"}</dd>
          </div>
          <div>
            <dt>Рабочий email</dt>
            <dd>{company.companyEmail || "—"}</dd>
          </div>
        </dl>
      )}
      <div className="company-team__grid">
        <section>
          <h3>Команда</h3>
          <div className="team-list">
            {members.map((member) => (
              <div className="member-row" key={member.userId}>
                <span>
                  <strong>{member.user.name}</strong>
                  <small>
                    {member.user.email}
                    {` · ${
                      businessMemberTitleLabel(
                        member.businessTitle,
                        language,
                      ) ?? memberRoleLabel(member.role)
                    }`}
                  </small>
                </span>
                {canManage && member.role !== "OWNER" && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => void remove(member)}
                  >
                    Удалить
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
        {canManage && (
          <section>
            <h3>Приглашения</h3>
            <form className="invite-form" onSubmit={invite}>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
                aria-label="Email коллеги"
                required
              />
              <button
                className="secondary-button invite-form__submit"
                type="submit"
              >
                Пригласить
              </button>
            </form>
            <div className="team-list">
              {invitations
                .filter((item) => item.status === "PENDING")
                .map((invitation) => (
                  <div className="member-row" key={invitation.id}>
                    <span>
                      <strong>{invitation.email}</strong>
                      <small>Ожидает принятия</small>
                    </span>
                    <div className="member-actions">
                      <button
                        className="text-button"
                        type="button"
                        onClick={() =>
                          void invitationAction(invitation, "resend")
                        }
                      >
                        Повторить
                      </button>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() =>
                          void invitationAction(invitation, "revoke")
                        }
                      >
                        Отозвать
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </section>
        )}
      </div>
      {status && (
        <p className="company-team__status" role="status">
          {status}
        </p>
      )}
    </section>
  );
}

function memberRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    OWNER: "Владелец",
    ADMIN: "Администратор",
    MEMBER: "Участник",
    VIEWER: "Только просмотр",
  };
  return labels[role] ?? "Участник";
}
