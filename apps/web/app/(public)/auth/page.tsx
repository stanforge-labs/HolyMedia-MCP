"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  LanguageSwitcher,
  useLanguage,
} from "../../components/language-switcher";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
type AuthMode = "login" | "signup" | "forgot";
const copy = {
  ru: {
    back: "← Вернуться на главную",
    login: "Войти",
    signup: "Регистрация",
    signInTitle: "Вход",
    signupTitle: "Новый аккаунт",
    forgotTitle: "Восстановление пароля",
    signInLead: "Войдите, чтобы открыть рекламные кабинеты.",
    signupLead: "Создайте аккаунт HolyMedia MCP.",
    forgotLead: "Укажите email, который использовали при регистрации.",
    google: "Войти через Google",
    name: "Имя",
    namePlaceholder: "Ваше имя",
    email: "Email",
    password: "Пароль",
    confirmPassword: "Подтвердите пароль",
    passwordPlaceholder: "Ваш пароль",
    passwordMin: "Минимум 12 символов",
    confirmPlaceholder: "Повторите пароль",
    showPassword: "Показать пароль",
    hidePassword: "Скрыть пароль",
    forgot: "Забыли пароль?",
    backToLogin: "← Назад ко входу",
    wait: "Подождите…",
    create: "Зарегистрироваться",
    send: "Отправить ссылку",
    passwordsMismatch: "Пароли не совпадают.",
    requestFailed: "Не удалось выполнить запрос. Попробуйте ещё раз.",
    resetSent:
      "Если такой аккаунт есть, мы отправили письмо со ссылкой для сброса пароля.",
  },
  en: {
    back: "← Back to home",
    login: "Sign in",
    signup: "Create account",
    signInTitle: "Sign in",
    signupTitle: "Create your account",
    forgotTitle: "Reset your password",
    signInLead: "Sign in to open your advertising accounts.",
    signupLead: "Create your HolyMedia MCP account.",
    forgotLead: "Enter the email you used to register.",
    google: "Continue with Google",
    name: "Name",
    namePlaceholder: "Your name",
    email: "Email",
    password: "Password",
    confirmPassword: "Confirm password",
    passwordPlaceholder: "Your password",
    passwordMin: "At least 12 characters",
    confirmPlaceholder: "Repeat your password",
    showPassword: "Show password",
    hidePassword: "Hide password",
    forgot: "Forgot password?",
    backToLogin: "← Back to sign in",
    wait: "Please wait…",
    create: "Create account",
    send: "Send link",
    passwordsMismatch: "Passwords do not match.",
    requestFailed: "We could not complete the request. Please try again.",
    resetSent: "If an account exists, we sent an email with a reset link.",
  },
};

async function csrf(): Promise<string> {
  const response = await fetch(`${API}/api/v1/auth/csrf`, {
    credentials: "include",
  });
  const data = (await response.json()) as { csrfToken: string };
  return data.csrfToken;
}

function safeDashboardPath(value: string | null): string {
  if (!value) return "/dashboard";
  try {
    const url = new URL(value, window.location.origin);
    if (
      url.origin === window.location.origin &&
      /^\/dashboard(?:\/(?:overview|connections|ai-client|reports|tariffs|profile|analysis))?$/.test(
        url.pathname,
      )
    )
      return `${url.pathname}${url.search}`;
  } catch {
    // Use the safe dashboard default.
  }
  return "/dashboard";
}

export default function AuthPage() {
  const language = useLanguage();
  const t = copy[language];
  const [mode, setMode] = useState<AuthMode>("login");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [oauthTransaction, setOauthTransaction] = useState("");
  const [nextPath, setNextPath] = useState("/dashboard");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const requested = query.get("mode");
    const transaction = query.get("oauth_transaction") ?? "";
    setNextPath(safeDashboardPath(query.get("next")));
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        transaction,
      )
    ) {
      setOauthTransaction(transaction);
    }
    if (requested === "signup" || requested === "forgot") setMode(requested);
    // Restore only ordinary login; consent/signup/reset flows keep their own lifecycle.
    const controller = new AbortController();
    if ((!requested || requested === "login") && !transaction) {
      void fetch(`${API}/api/v1/auth/session`, {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (
            response.ok &&
            (await response.json()).user &&
            !controller.signal.aborted
          )
            window.location.replace(safeDashboardPath(query.get("next")));
        })
        .catch(() => {
          /* A temporary API error does not invalidate the cookie. */
        });
    }
    return () => controller.abort();
  }, []);

  useEffect(() => {
    document.title =
      mode === "signup"
        ? language === "ru"
          ? "Регистрация — HolyMedia MCP"
          : "Create account — HolyMedia MCP"
        : mode === "login"
          ? language === "ru"
            ? "Вход — HolyMedia MCP"
            : "Sign in — HolyMedia MCP"
          : language === "ru"
            ? "Восстановление пароля — HolyMedia MCP"
            : "Reset password — HolyMedia MCP";
  }, [language, mode]);

  function changeMode(next: AuthMode) {
    setMode(next);
    setMessage("");
    setError("");
    setShowPassword(false);
    setShowConfirmPassword(false);
    const query = new URLSearchParams();
    if (next !== "login") query.set("mode", next);
    if (oauthTransaction) query.set("oauth_transaction", oauthTransaction);
    if (nextPath !== "/dashboard") query.set("next", nextPath);
    const suffix = query.toString();
    window.history.replaceState({}, "", suffix ? `/auth?${suffix}` : "/auth");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (mode === "signup" && password !== confirmPassword) {
      setError(t.passwordsMismatch);
      return;
    }
    setBusy(true);
    setMessage("");
    setError("");
    let navigating = false;
    const body =
      mode === "forgot"
        ? { email: String(form.get("email") ?? "") }
        : mode === "login"
          ? { email: String(form.get("email") ?? ""), password }
          : {
              name: String(form.get("name") ?? ""),
              email: String(form.get("email") ?? ""),
              password,
              confirmPassword,
            };
    try {
      const response = await fetch(
        `${API}/api/v1/auth/${mode === "forgot" ? "forgot-password" : mode}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": await csrf(),
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw new Error("request_failed");
      if (mode === "forgot") {
        setMessage(t.resetSent);
      } else {
        navigating = true;
        window.location.assign(
          mode === "signup"
            ? "/onboarding"
            : oauthTransaction
              ? `${API}/oauth/authorize/continue?transaction=${encodeURIComponent(oauthTransaction)}`
              : nextPath,
        );
      }
    } catch {
      setError(t.requestFailed);
    } finally {
      if (!navigating) setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-language">
          <LanguageSwitcher compact />
        </div>
        {mode === "forgot" ? (
          <button
            className="back-link auth-recovery-back"
            type="button"
            onClick={() => changeMode("login")}
          >
            {t.backToLogin}
          </button>
        ) : (
          <Link className="back-link" href="/">
            {t.back}
          </Link>
        )}

        {mode !== "forgot" && (
          <div
            className="tabs"
            role="tablist"
            aria-label={`${t.login} / ${t.signup}`}
          >
            <button
              className={mode === "login" ? "tab active" : "tab"}
              onClick={() => changeMode("login")}
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              aria-controls="auth-panel"
            >
              {t.login}
            </button>
            <button
              className={mode === "signup" ? "tab active" : "tab"}
              onClick={() => changeMode("signup")}
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              aria-controls="auth-panel"
            >
              {t.signup}
            </button>
          </div>
        )}

        <div id="auth-panel" role={mode === "forgot" ? undefined : "tabpanel"}>
          <h1 id="auth-title">
            {mode === "login"
              ? t.signInTitle
              : mode === "signup"
                ? t.signupTitle
                : t.forgotTitle}
          </h1>
          <p className="muted">
            {mode === "login"
              ? t.signInLead
              : mode === "signup"
                ? t.signupLead
                : t.forgotLead}
          </p>

          {mode !== "forgot" && (
            <a
              className="secondary-button google-login-button"
              href={`${API}/auth/google/start?${new URLSearchParams({
                ...(oauthTransaction
                  ? { oauth_transaction: oauthTransaction }
                  : {}),
                ...(nextPath !== "/dashboard" ? { next: nextPath } : {}),
              }).toString()}`}
            >
              <GoogleIcon />
              {t.google}
            </a>
          )}

          <form onSubmit={submit} noValidate>
            {mode === "signup" && (
              <label>
                {t.name}
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={160}
                  autoComplete="name"
                  placeholder={t.namePlaceholder}
                />
              </label>
            )}
            <label>
              {t.email}
              <input
                name="email"
                required
                type="email"
                maxLength={320}
                autoComplete="email"
                placeholder="name@company.com"
              />
            </label>
            {mode !== "forgot" && (
              <PasswordField
                label={t.password}
                name="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={mode === "signup" ? 12 : 1}
                placeholder={
                  mode === "signup" ? t.passwordMin : t.passwordPlaceholder
                }
                shown={showPassword}
                onToggle={() => setShowPassword((value) => !value)}
                showLabel={t.showPassword}
                hideLabel={t.hidePassword}
              />
            )}
            {mode === "signup" && (
              <PasswordField
                label={t.confirmPassword}
                name="confirmPassword"
                autoComplete="new-password"
                minLength={12}
                placeholder={t.confirmPlaceholder}
                shown={showConfirmPassword}
                onToggle={() => setShowConfirmPassword((value) => !value)}
                showLabel={t.showPassword}
                hideLabel={t.hidePassword}
              />
            )}
            {mode === "login" && (
              <button
                className="text-button forgot-link"
                type="button"
                onClick={() => changeMode("forgot")}
              >
                {t.forgot}
              </button>
            )}
            <button
              className={`primary-button auth-submit ${mode === "signup" ? "auth-submit--signup" : ""}`}
              type="submit"
              disabled={busy}
            >
              {busy
                ? t.wait
                : mode === "login"
                  ? t.login
                  : mode === "signup"
                    ? t.create
                    : t.send}
            </button>
          </form>
        </div>

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

function PasswordField({
  label,
  name,
  autoComplete,
  minLength,
  placeholder,
  shown,
  onToggle,
  showLabel,
  hideLabel,
}: {
  label: string;
  name: string;
  autoComplete: string;
  minLength: number;
  placeholder: string;
  shown: boolean;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
}) {
  return (
    <label>
      {label}
      <span className="password-input">
        <input
          name={name}
          required
          minLength={minLength}
          maxLength={128}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={shown ? hideLabel : showLabel}
          aria-pressed={shown}
          onClick={onToggle}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            {shown ? (
              <>
                <path d="m3 3 18 18" />
                <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                <path d="M9.9 4.2A10.5 10.5 0 0 1 12 4c5.2 0 9.4 4.1 10 8-0.2 1.3-0.9 2.7-1.8 3.8" />
                <path d="M6.1 6.1C4.2 7.5 2.7 9.5 2 12c0.7 4 4.8 8 10 8 1 0 2-.2 2.9-.6" />
              </>
            ) : (
              <>
                <path d="M2 12s3.6-8 10-8 10 8 10 8-3.6 8-10 8S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
              </>
            )}
          </svg>
        </button>
      </span>
    </label>
  );
}

function GoogleIcon() {
  return (
    <svg
      aria-hidden="true"
      className="google-icon"
      viewBox="0 0 18 18"
      width="18"
      height="18"
    >
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.878 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.258c-.806.54-1.835.86-3.048.86-2.344 0-4.33-1.584-5.04-3.714H.954v2.332A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.708A5.41 5.41 0 0 1 3.68 9c0-.593.102-1.17.28-1.708V4.96H.954A9 9 0 0 0 0 9c0 1.453.348 2.827.954 4.04l3.006-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.578c1.322 0 2.51.454 3.443 1.345l2.582-2.582C13.463.89 11.426 0 9 0A9 9 0 0 0 .954 4.96L3.96 7.292C4.67 5.162 6.656 3.578 9 3.578Z"
      />
    </svg>
  );
}
