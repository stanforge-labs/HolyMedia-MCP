"use client";

import { useEffect, useState } from "react";
import { BrandLockup } from "../../components/brand-lockup";
import {
  LanguageSwitcher,
  useLanguage,
} from "../../components/language-switcher";
import { localizedHref } from "../../components/locale-routing";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type ApprovalView = {
  provider: string;
  account: string;
  campaign: string;
  operation: string;
  field: "name" | "status";
  before: string;
  after: string;
  expires_at: string;
  approved: boolean;
};

const copy = {
  ru: {
    eyebrow: "HOLYMEDIA MCP",
    title: "Подтверждение изменения",
    lead: "Проверьте изменение перед выполнением в рекламном кабинете.",
    account: "Рекламный кабинет",
    campaign: "Кампания",
    operation: "Изменение",
    before: "Было",
    after: "Будет",
    expires: "Ссылка действует до",
    rename: "Название кампании",
    pause: "Остановка кампании",
    resume: "Возобновление кампании",
    approve: "Подтвердить изменение",
    cancel: "Отмена",
    pending: "Проверяем ссылку и доступ…",
    working: "Сохраняем решение…",
    invalid:
      "Ссылка недействительна, истекла или недоступна вашему аккаунту. Создайте новый предварительный просмотр в AI-клиенте.",
    failed: "Не удалось сохранить решение. Попробуйте ещё раз.",
    approved:
      "Изменение подтверждено. Вернитесь в ChatGPT/Codex для выполнения.",
    cancelled: "Изменение отменено. Выполнение по этому preview невозможно.",
    noMutation: "Подтверждение здесь ещё не изменяет кампанию в Meta Ads.",
  },
  en: {
    eyebrow: "HOLYMEDIA MCP",
    title: "Approve a change",
    lead: "Review the change before it is executed in your ad account.",
    account: "Ad account",
    campaign: "Campaign",
    operation: "Change",
    before: "Before",
    after: "Requested after",
    expires: "Link expires",
    rename: "Campaign name",
    pause: "Pause campaign",
    resume: "Resume campaign",
    approve: "Approve change",
    cancel: "Cancel",
    pending: "Checking this link and your access…",
    working: "Saving your decision…",
    invalid:
      "This link is invalid, expired, or unavailable to your account. Create a new preview in your AI client.",
    failed: "We could not save your decision. Please try again.",
    approved: "Change approved. Return to ChatGPT/Codex to execute it.",
    cancelled: "Change cancelled. This preview can no longer be executed.",
    noMutation: "Approval here does not yet change the Meta Ads campaign.",
  },
};

async function csrf(): Promise<string> {
  const response = await fetch(`${API}/api/v1/auth/csrf`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("csrf_failed");
  const data = (await response.json()) as { csrfToken?: string };
  if (!data.csrfToken) throw new Error("csrf_failed");
  return data.csrfToken;
}

export default function McpApprovalPage() {
  const language = useLanguage();
  const t = copy[language];
  const [nonce, setNonce] = useState("");
  const [view, setView] = useState<ApprovalView | null>(null);
  const [outcome, setOutcome] = useState<"approved" | "cancelled" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = `${t.title} — HolyMedia MCP`;
  }, [t.title]);

  useEffect(() => {
    const approval =
      new URLSearchParams(window.location.search).get("approval") ?? "";
    if (!/^hmap_[A-Za-z0-9_-]{43}$/.test(approval)) {
      setError("invalid");
      return;
    }
    setNonce(approval);
    const controller = new AbortController();
    void fetch(
      `${API}/api/v1/mcp/public/approval?approval=${encodeURIComponent(approval)}`,
      {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (response.status === 401) {
          const next = `${window.location.pathname}${window.location.search}`;
          window.location.assign(
            localizedHref(`/auth?next=${encodeURIComponent(next)}`, language),
          );
          return null;
        }
        if (!response.ok) throw new Error("approval_unavailable");
        return (await response.json()) as ApprovalView;
      })
      .then((result) => {
        if (!controller.signal.aborted && result) {
          setView(result);
          if (result.approved) setOutcome("approved");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("invalid");
      });
    return () => controller.abort();
  }, [language]);

  async function decide(decision: "approve" | "cancel") {
    if (!view || !nonce || busy || outcome) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/v1/mcp/public/approval`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": await csrf(),
        },
        body: JSON.stringify({ approval: nonce, decision }),
      });
      if (!response.ok) throw new Error("approval_failed");
      const result = (await response.json()) as { status?: string };
      if (result.status !== "approved" && result.status !== "cancelled")
        throw new Error("approval_failed");
      setOutcome(result.status);
    } catch {
      setError("failed");
    } finally {
      setBusy(false);
    }
  }

  const operation = view
    ? view.operation === "META_CAMPAIGN_RENAME"
      ? t.rename
      : view.operation === "META_CAMPAIGN_PAUSE"
        ? t.pause
        : t.resume
    : "";

  return (
    <main className="oauth-consent-shell">
      <section
        className="oauth-consent-card mcp-approval-card"
        aria-labelledby="approval-title"
      >
        <header className="oauth-consent-card__header">
          <a
            className="oauth-consent-brand"
            href={localizedHref("/", language)}
            aria-label="HolyMedia MCP"
          >
            <BrandLockup />
          </a>
          <LanguageSwitcher compact />
        </header>
        <p className="eyebrow">{t.eyebrow}</p>
        <h1 id="approval-title">{t.title}</h1>
        {outcome ? (
          <div className="mcp-approval-outcome" role="status">
            <p>{outcome === "approved" ? t.approved : t.cancelled}</p>
            <p>{t.noMutation}</p>
          </div>
        ) : view ? (
          <>
            <p className="oauth-consent-lead">{t.lead}</p>
            <dl className="mcp-approval-details">
              <div>
                <dt>{t.account}</dt>
                <dd>
                  {view.provider} · {view.account}
                </dd>
              </div>
              <div>
                <dt>{t.campaign}</dt>
                <dd>{view.campaign}</dd>
              </div>
              <div>
                <dt>{t.operation}</dt>
                <dd>{operation}</dd>
              </div>
            </dl>
            <div className="mcp-approval-diff">
              <div>
                <span>{t.before}</span>
                <strong>{view.before}</strong>
              </div>
              <div>
                <span>{t.after}</span>
                <strong>{view.after}</strong>
              </div>
            </div>
            <p className="mcp-approval-expiry">
              {t.expires}:{" "}
              {new Date(view.expires_at).toLocaleString(
                language === "ru" ? "ru-RU" : "en-US",
              )}
            </p>
            <p className="mcp-approval-note">{t.noMutation}</p>
            {error && (
              <p className="error" role="alert">
                {t.failed}
              </p>
            )}
            <div className="oauth-consent-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void decide("cancel")}
              >
                {t.cancel}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() => void decide("approve")}
              >
                {busy ? t.working : t.approve}
              </button>
            </div>
          </>
        ) : (
          <p role={error ? "alert" : "status"} className="oauth-consent-lead">
            {error ? t.invalid : t.pending}
          </p>
        )}
      </section>
    </main>
  );
}
