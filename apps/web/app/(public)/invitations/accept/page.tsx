"use client";
import { currentLocaleHref } from "../../../components/locale-routing";

import Link from "../../../components/locale-link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { LanguageSwitcher } from "../../../components/language-switcher";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

async function csrf(): Promise<string> {
  const response = await fetch(`${API}/api/v1/auth/csrf`, {
    credentials: "include",
  });
  const data = (await response.json()) as { csrfToken: string };
  return data.csrfToken;
}

export default function AcceptInvitationPage() {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const queryToken = new URLSearchParams(window.location.search).get("token");
    if (queryToken) setToken(queryToken);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      const response = await fetch(`${API}/api/v1/invitations/accept`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": await csrf(),
        },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = (await response.json()) as {
        workspace?: { name?: string };
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(
          data.error?.message ?? "Не удалось принять приглашение.",
        );
      setMessage(
        `Приглашение принято. Команда: ${data.workspace?.name ?? "доступ открыт"}.`,
      );
      window.setTimeout(
        () => window.location.assign(currentLocaleHref("/dashboard")),
        600,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось принять приглашение.",
      );
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="invitation-title">
        <div className="auth-language">
          <LanguageSwitcher compact />
        </div>
        <Link className="back-link" href="/">
          HolyMedia MCP v2
        </Link>
        <h1 id="invitation-title">Принять приглашение</h1>
        <p className="muted">
          Войдите в аккаунт, которому предназначено приглашение, затем вставьте
          одноразовый код из письма.
        </p>
        <form onSubmit={submit}>
          <label>
            Код приглашения
            <textarea
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
              minLength={32}
              maxLength={128}
              rows={4}
              autoComplete="one-time-code"
              spellCheck={false}
            />
          </label>
          <button className="primary-button" type="submit">
            Принять приглашение
          </button>
        </form>
        {message && (
          <p className="success" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
