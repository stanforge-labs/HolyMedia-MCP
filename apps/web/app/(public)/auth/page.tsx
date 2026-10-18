"use client";

import Link from "../../components/locale-link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { currentLocaleHref } from "../../components/locale-routing";
import {
  LanguageSwitcher,
  useLanguage,
} from "../../components/language-switcher";
import {
  measureSuccessfulSignup,
  signupConversionConfig,
} from "../../components/signup-conversion";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const googleLoginEnabled =
  process.env.NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED !== "false";
const restrictedTestAuth =
  process.env.NEXT_PUBLIC_TEST_RESTRICTED_AUTH === "true";
const signupConversion = signupConversionConfig({
  enabled: process.env.NEXT_PUBLIC_SIGNUP_GOOGLE_ADS_ENABLED,
  conversionId: process.env.NEXT_PUBLIC_SIGNUP_GOOGLE_ADS_CONVERSION_ID,
  label: process.env.NEXT_PUBLIC_SIGNUP_GOOGLE_ADS_LABEL,
  restrictedTestAuth: process.env.NEXT_PUBLIC_TEST_RESTRICTED_AUTH,
});
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
    invalidEmail: "Укажите корректный адрес электронной почты.",
    invalidCredentials: "Неверный email или пароль.",
    accessDenied: "Этой учётной записи не предоставлен доступ к TEST.",
    invalidInput: "Проверьте введённые данные и попробуйте снова.",
    rateLimited: "Слишком много попыток. Подождите и повторите вход.",
    serviceUnavailable: "Сервис входа временно недоступен. Повторите позже.",
    networkFailed:
      "Нет связи с сервисом входа. Проверьте подключение и повторите попытку.",
    googleOauth:
      "Вход через Google был отменён или не завершился. Попробуйте снова.",
    googleSession:
      "Сессия входа через Google истекла или не совпала. Начните вход заново в этом браузере.",
    googleProvider: "Google не подтвердил вход. Попробуйте снова позже.",
    googleAccess:
      "Этот Google-аккаунт не привязан к разрешённому владельцу TEST workspace.",
    resetSent:
      "Если такой аккаунт есть, мы отправили письмо со ссылкой для сброса пароля.",
    measurementConsent:
      "Разрешаю передать Google Ads факт успешной регистрации для оценки рекламы. Это необязательно; email, имя и пароль не передаются.",
    privacyDetails: "Подробнее в Политике конфиденциальности.",
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
    invalidEmail: "Enter a valid email address.",
    invalidCredentials: "Invalid email or password.",
    accessDenied: "This account has not been granted TEST access.",
    invalidInput: "Check the entered information and try again.",
    rateLimited: "Too many attempts. Wait and try again.",
    serviceUnavailable:
      "Sign-in service is temporarily unavailable. Try again later.",
    networkFailed:
      "Cannot reach the sign-in service. Check your connection and try again.",
    googleOauth: "Google sign-in was cancelled or did not finish. Try again.",
    googleSession:
      "Google sign-in session expired or did not match. Start again in this browser.",
    googleProvider: "Google could not confirm sign-in. Try again later.",
    googleAccess:
      "This Google account is not linked to the authorized TEST workspace owner.",
    resetSent: "If an account exists, we sent an email with a reset link.",
    measurementConsent:
      "I allow Google Ads to measure my successful registration. This is optional; email, name and password are not sent.",
    privacyDetails: "Read the Privacy Policy.",
  },
};

async function csrf(): Promise<string> {
  const response = await fetch(`${API}/api/v1/auth/csrf`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("csrf_unavailable");
  const data = (await response.json()) as { csrfToken: string };
  if (typeof data.csrfToken !== "string" || !data.csrfToken)
    throw new Error("csrf_unavailable");
  return data.csrfToken;
}

function safeDashboardPath(value: string | null): string {
  if (!value) return currentLocaleHref("/dashboard");
  try {
    const url = new URL(value, window.location.origin);
    if (
      url.origin === window.location.origin &&
      /^\/(?:en\/)?(?:dashboard(?:\/(?:overview|connections|ai-client|reports|tariffs|profile|analysis))?|onboarding)$/.test(
        url.pathname,
      )
    )
      return `${url.pathname}${url.search}${url.hash}`;
    if (
      url.origin === window.location.origin &&
      /^\/(?:en\/)?mcp\/approve$/.test(url.pathname) &&
      !url.search &&
      !url.hash
    )
      return url.pathname;
  } catch {
    // Use the safe dashboard default.
  }
  return currentLocaleHref("/dashboard");
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
    if (restrictedTestAuth) {
      const googleError = query.get("error");
      if (googleError === "google_session") setError(t.googleSession);
      else if (googleError === "google_provider") setError(t.googleProvider);
      else if (googleError === "google_access") setError(t.googleAccess);
      else if (googleError === "google_oauth" || googleError === "google_login")
        setError(t.googleOauth);
    }
    const transaction = query.get("oauth_transaction") ?? "";
    setNextPath(safeDashboardPath(query.get("next")));
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        transaction,
      )
    ) {
      setOauthTransaction(transaction);
    }
    if (
      !restrictedTestAuth &&
      (requested === "signup" || requested === "forgot")
    )
      setMode(requested);
    // Restore only ordinary login; consent/signup/reset flows keep their own lifecycle.
    const controller = new AbortController();
    if (!requested || requested === "login" || restrictedTestAuth) {
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
          ) {
            if (transaction) {
              window.location.replace(
                `${API}/oauth/authorize/continue?transaction=${encodeURIComponent(transaction)}`,
              );
            } else if (restrictedTestAuth) {
              setMessage(
                language === "ru"
                  ? "Вход в TEST выполнен. Вернитесь к подключению ChatGPT или Claude."
                  : "Signed in to TEST. Return to the ChatGPT or Claude connection.",
              );
            } else {
              window.location.replace(safeDashboardPath(query.get("next")));
            }
          }
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
    window.history.replaceState(
      {},
      "",
      currentLocaleHref(suffix ? `/auth?${suffix}` : "/auth"),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = String(form.get("email") ?? "").trim();
    const emailInput = formElement.elements.namedItem("email");
    if (
      !(emailInput instanceof HTMLInputElement) ||
      !emailInput.checkValidity() ||
      !email
    ) {
      setError(t.invalidEmail);
      return;
    }
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
        ? { email }
        : mode === "login"
          ? { email, password }
          : {
              name: String(form.get("name") ?? ""),
              email,
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
      if (!response.ok) {
        setError(
          response.status === 401
            ? t.invalidCredentials
            : response.status === 403
              ? t.accessDenied
              : response.status === 429
                ? t.rateLimited
                : response.status >= 500
                  ? t.serviceUnavailable
                  : t.invalidInput,
        );
        return;
      }
      if (mode === "forgot") {
        setMessage(t.resetSent);
      } else if (mode === "signup") {
        const result = await response.json().catch(() => null);
        const measurementConsent =
          form.get("signupMeasurementConsent") === "on";
        try {
          // Remove entered credentials and OAuth/query values before loading a tag.
          formElement.reset();
          window.history.replaceState({}, "", currentLocaleHref("/auth"));
          await measureSuccessfulSignup(
            signupConversion,
            measurementConsent,
            typeof result?.user?.id === "string" ? result.user.id : undefined,
            typeof result?.workspace?.id === "string"
              ? result.workspace.id
              : undefined,
          );
        } catch {
          // Measurement must never turn a completed signup into a failed signup.
        }
        navigating = true;
        window.location.assign(currentLocaleHref("/onboarding"));
      } else if (restrictedTestAuth && mode === "login" && !oauthTransaction) {
        setMessage(
          language === "ru"
            ? "Вход в TEST выполнен. Вернитесь к подключению ChatGPT или Claude."
            : "Signed in to TEST. Return to the ChatGPT or Claude connection.",
        );
      } else {
        navigating = true;
        window.location.assign(
          oauthTransaction
            ? `${API}/oauth/authorize/continue?transaction=${encodeURIComponent(oauthTransaction)}`
            : nextPath,
        );
      }
    } catch {
      setError(t.networkFailed);
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

        {mode !== "forgot" && !restrictedTestAuth && (
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
            {restrictedTestAuth
              ? language === "ru"
                ? "Доступ только для приглашённого владельца TEST workspace. Аккаунты и пароли production здесь не переносятся."
                : "Only the invited TEST workspace owner can sign in. Production accounts and passwords are not copied here."
              : mode === "login"
                ? t.signInLead
                : mode === "signup"
                  ? t.signupLead
                  : t.forgotLead}
          </p>

          {mode !== "forgot" && googleLoginEnabled && (
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
            {mode === "login" && !restrictedTestAuth && (
              <button
                className="text-button forgot-link"
                type="button"
                onClick={() => changeMode("forgot")}
              >
                {t.forgot}
              </button>
            )}
            {mode === "signup" && signupConversion && (
              <label className="signup-measurement-consent">
                <input
                  type="checkbox"
                  name="signupMeasurementConsent"
                  value="on"
                  defaultChecked={false}
                />
                <span>{t.measurementConsent}</span>
                <Link href="/privacy">{t.privacyDetails}</Link>
              </label>
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
