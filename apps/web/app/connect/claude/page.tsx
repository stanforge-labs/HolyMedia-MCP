"use client";
import { localizedHref } from "../../components/locale-routing";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { BrandLockup } from "../../components/brand-lockup";
import {
  LanguageSwitcher,
  useLanguage,
} from "../../components/language-switcher";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type OAuthWorkspace = {
  id: string;
  name: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
};

type AuthorizationContext = {
  transactionId: string;
  client: { id: string; name: string };
  workspaces: OAuthWorkspace[];
  selectedWorkspaceId: string | null;
  expiresAt: string;
};

function copyFor(clientName: string) {
  return {
    ru: {
      eyebrow: "БЕЗОПАСНОЕ ПОДКЛЮЧЕНИЕ",
      title: `Подключить ${clientName}`,
      lead: `${clientName} запрашивает доступ к вашему HolyMedia MCP.`,
      company: "Компания",
      chooseCompany: `К какой компании подключить ${clientName}?`,
      canTitle: `${clientName} сможет`,
      can: [
        "видеть подключённые рекламные кабинеты этой компании;",
        "читать доступные рекламные данные;",
        "использовать разрешённые MCP-инструменты.",
      ],
      cannotTitle: `${clientName} не получает`,
      cannot: [
        "пароль HolyMedia MCP;",
        "OAuth-токены Google, Meta, Яндекс или TikTok;",
        "данные других компаний.",
      ],
      allow: "Разрешить",
      deny: "Отмена",
      working: "Подключаем…",
      loading: `Проверяем запрос ${clientName}…`,
      invalid:
        "Запрос подключения недействителен или истёк. Вернитесь в AI-клиент и начните подключение заново.",
      failed: "Не удалось продолжить подключение. Попробуйте ещё раз.",
    },
    en: {
      eyebrow: "SECURE CONNECTION",
      title: `Connect ${clientName}`,
      lead: `${clientName} is requesting access to your HolyMedia MCP.`,
      company: "Company",
      chooseCompany: `Which company should ${clientName} connect to?`,
      canTitle: `${clientName} can`,
      can: [
        "see the connected advertising accounts of this company;",
        "read available advertising data;",
        "use permitted MCP tools.",
      ],
      cannotTitle: `${clientName} does not receive`,
      cannot: [
        "your HolyMedia MCP password;",
        "Google, Meta, Yandex, or TikTok OAuth tokens;",
        "data from other companies.",
      ],
      allow: "Allow",
      deny: "Cancel",
      working: "Connecting…",
      loading: `Checking ${clientName}’s request…`,
      invalid:
        "This connection request is invalid or expired. Return to your AI client and start again.",
      failed: "Could not continue the connection. Please try again.",
    },
  };
}

function verifiedClientLabel(context: AuthorizationContext | null): string {
  if (!context) return "AI-клиент";
  try {
    const hostname = new URL(context.client.id).hostname.toLowerCase();
    if (hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com")) {
      return "ChatGPT";
    }
    if (hostname === "claude.ai" || hostname.endsWith(".claude.ai")) {
      return "Claude";
    }
  } catch {
    // DCR client IDs are opaque; the verified server-side client name is safe.
  }
  return context.client.name.trim().slice(0, 80) || "AI-клиент";
}

async function csrf(): Promise<string> {
  const response = await fetch(`${API}/api/v1/auth/csrf`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("csrf_failed");
  const data = (await response.json()) as { csrfToken?: string };
  if (!data.csrfToken) throw new Error("csrf_failed");
  return data.csrfToken;
}

export default function ClaudeConsentPage() {
  const language = useLanguage();
  const [transactionId, setTransactionId] = useState("");
  const [context, setContext] = useState<AuthorizationContext | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState("");
  const t = useMemo(
    () => copyFor(verifiedClientLabel(context))[language],
    [context, language],
  );

  useEffect(() => {
    document.title = `${t.title} — HolyMedia MCP`;
  }, [t.title]);

  useEffect(() => {
    const transaction =
      new URLSearchParams(window.location.search).get("transaction") ?? "";
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        transaction,
      )
    ) {
      setError(t.invalid);
      return;
    }
    setTransactionId(transaction);
    let active = true;
    void fetch(
      `${API}/oauth/authorize/transaction?transaction=${encodeURIComponent(transaction)}`,
      { credentials: "include" },
    )
      .then(async (response) => {
        if (response.status === 401) {
          window.location.assign(
            `/auth?oauth_transaction=${encodeURIComponent(transaction)}`,
          );
          return null;
        }
        if (!response.ok) throw new Error("transaction_failed");
        return (await response.json()) as AuthorizationContext;
      })
      .then((result) => {
        if (!active || !result) return;
        setContext(result);
        setWorkspaceId(
          result.selectedWorkspaceId || result.workspaces[0]?.id || "",
        );
      })
      .catch(() => active && setError(t.invalid));
    return () => {
      active = false;
    };
  }, [t.invalid]);

  async function decide(
    decision: "allow" | "deny",
    event?: FormEvent<HTMLFormElement>,
  ) {
    event?.preventDefault();
    if (busy || !context || (decision === "allow" && !workspaceId)) return;
    setBusy(decision);
    setError("");
    try {
      const response = await fetch(`${API}/oauth/authorize/consent`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": await csrf(),
        },
        body: JSON.stringify({
          transaction_id: transactionId,
          workspace_id: workspaceId,
          decision,
        }),
      });
      if (!response.ok) throw new Error("consent_failed");
      const result = (await response.json()) as { redirect_url?: string };
      if (!result.redirect_url) throw new Error("consent_failed");
      window.location.assign(result.redirect_url);
    } catch {
      setBusy(null);
      setError(t.failed);
    }
  }

  return (
    <main className="oauth-consent-shell">
      <section className="oauth-consent-card" aria-labelledby="oauth-title">
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

        {context ? (
          <form onSubmit={(event) => void decide("allow", event)}>
            <p className="eyebrow">{t.eyebrow}</p>
            <h1 id="oauth-title">{t.title}</h1>
            <p className="oauth-consent-lead">{t.lead}</p>

            <fieldset className="oauth-workspace-fieldset">
              <legend>
                {context.workspaces.length > 1 ? t.chooseCompany : t.company}
              </legend>
              <div className="oauth-workspace-list">
                {context.workspaces.map((workspace) => (
                  <label
                    className={
                      workspaceId === workspace.id
                        ? "oauth-workspace-option is-selected"
                        : "oauth-workspace-option"
                    }
                    key={workspace.id}
                  >
                    <input
                      type="radio"
                      name="workspace"
                      value={workspace.id}
                      checked={workspaceId === workspace.id}
                      onChange={() => setWorkspaceId(workspace.id)}
                    />
                    <span>{workspace.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="oauth-permissions-grid">
              <section>
                <h2>{t.canTitle}</h2>
                <ul>
                  {t.can.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
              <section>
                <h2>{t.cannotTitle}</h2>
                <ul>
                  {t.cannot.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            </div>

            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="oauth-consent-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void decide("deny")}
              >
                {t.deny}
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={Boolean(busy) || !workspaceId}
              >
                {busy === "allow" ? t.working : t.allow}
              </button>
            </div>
          </form>
        ) : (
          <div
            className="oauth-consent-loading"
            role={error ? "alert" : "status"}
          >
            <p className="eyebrow">{t.eyebrow}</p>
            <h1 id="oauth-title">{t.title}</h1>
            <p>{error || t.loading}</p>
          </div>
        )}
      </section>
    </main>
  );
}
