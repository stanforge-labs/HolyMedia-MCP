"use client";

import Link from "../../../components/locale-link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { LanguageSwitcher } from "../../../components/language-switcher";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const csrfResponse = await fetch(`${API}/api/v1/auth/csrf`, {
        credentials: "include",
      });
      const csrfData = (await csrfResponse.json()) as { csrfToken: string };
      const response = await fetch(`${API}/api/v1/auth/reset-password`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfData.csrfToken,
        },
        body: JSON.stringify({
          token: token || form.get("token"),
          password: form.get("password"),
        }),
      });
      if (!response.ok) {
        const data = (await response.json()) as {
          error?: { message?: string };
        };
        throw new Error(
          data.error?.message ?? "Ссылка недействительна или устарела.",
        );
      }
      setMessage("Пароль изменён. Теперь можно войти.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось изменить пароль.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-language">
          <LanguageSwitcher compact />
        </div>
        <Link className="back-link" href="/auth">
          ← Назад ко входу
        </Link>
        <h1>Новый пароль</h1>
        <p className="muted">Придумайте новый пароль для аккаунта.</p>
        <form onSubmit={submit}>
          {!token && (
            <label>
              Код из письма
              <input
                name="token"
                required
                minLength={32}
                autoComplete="one-time-code"
              />
            </label>
          )}
          <label>
            Новый пароль
            <input
              name="password"
              required
              minLength={12}
              type="password"
              autoComplete="new-password"
              placeholder="Минимум 12 символов"
            />
          </label>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Сохраняем…" : "Сохранить пароль"}
          </button>
        </form>
        {message && (
          <div className="success" role="status">
            {message} <Link href="/auth">Войти</Link>
          </div>
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
