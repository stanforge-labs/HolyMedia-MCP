"use client";
import { currentLocaleHref } from "../../components/locale-routing";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  LanguageSwitcher,
  useLanguage,
} from "../../components/language-switcher";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
type Workspace = {
  id: string;
  name: string;
  role: string;
  accessStatus: "PENDING" | "ACTIVE" | "SUSPENDED";
};
type Company = {
  name: string;
  legalName: string | null;
  registrationCountry: string;
  registrationNumber: string | null;
  legalAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  websiteUrl: string | null;
};

async function csrf() {
  const response = await fetch(`${API}/api/v1/auth/csrf`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("csrf");
  return ((await response.json()) as { csrfToken: string }).csrfToken;
}

export default function OnboardingPage() {
  const language = useLanguage();
  const ru = language === "ru";
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [accountEmail, setAccountEmail] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    document.title = ru
      ? "Данные компании — HolyMedia MCP"
      : "Company details — HolyMedia MCP";
    void (async () => {
      const response = await fetch(`${API}/api/v1/workspaces`, {
        credentials: "include",
      });
      if (!response.ok)
        return window.location.assign(
          currentLocaleHref(
            `/auth?next=${encodeURIComponent(window.location.pathname)}`,
          ),
        );
      const workspaces = (await response.json()) as Workspace[];
      const pending = workspaces.find(
        (item) => item.accessStatus === "PENDING" && item.role === "OWNER",
      );
      if (!pending)
        return window.location.assign(currentLocaleHref("/dashboard"));
      setWorkspace(pending);
      const [companyResponse, sessionResponse] = await Promise.all([
        fetch(`${API}/api/v1/workspaces/${pending.id}`, {
          credentials: "include",
        }),
        fetch(`${API}/api/v1/auth/session`, { credentials: "include" }),
      ]);
      if (companyResponse.ok)
        setCompany((await companyResponse.json()) as Company);
      if (sessionResponse.ok) {
        const session = (await sessionResponse.json()) as {
          user?: { email?: string };
        };
        setAccountEmail(session.user?.email ?? "");
      }
    })();
  }, [ru]);

  async function saveCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `${API}/api/v1/workspaces/${workspace.id}/company`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": await csrf(),
          },
          body: JSON.stringify({
            name: String(form.get("name") ?? ""),
            legalName: String(form.get("legalName") ?? ""),
            registrationCountry: "KZ",
            registrationNumber: String(form.get("registrationNumber") ?? ""),
            legalAddress: String(form.get("legalAddress") ?? ""),
            companyPhone: String(form.get("companyPhone") ?? ""),
            companyEmail: String(form.get("companyEmail") ?? ""),
            websiteUrl: String(form.get("websiteUrl") ?? ""),
          }),
        },
      );
      if (!response.ok) throw new Error("company");
      setCompany((await response.json()) as Company);
      setStep(2);
    } catch {
      setError(
        ru
          ? "Не удалось сохранить данные компании. Проверьте обязательные поля."
          : "We could not save the company details. Check the required fields.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || busy) return;
    const emails = String(new FormData(event.currentTarget).get("emails") ?? "")
      .split(/[\s,;]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    if (!emails.length)
      return window.location.assign(currentLocaleHref("/dashboard"));
    setBusy(true);
    setError("");
    try {
      const token = await csrf();
      const results = await Promise.all(
        emails.map((email) =>
          fetch(`${API}/api/v1/workspaces/${workspace.id}/invitations`, {
            method: "POST",
            credentials: "include",
            headers: {
              "content-type": "application/json",
              "x-csrf-token": token,
            },
            body: JSON.stringify({ email, role: "MEMBER" }),
          }),
        ),
      );
      if (results.some((response) => !response.ok)) throw new Error("invite");
      setNotice(ru ? "Приглашения отправлены." : "Invitations sent.");
    } catch {
      setError(
        ru
          ? "Не удалось отправить одно или несколько приглашений."
          : "We could not send one or more invitations.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!workspace || !company)
    return <main className="auth-shell" aria-busy="true" />;

  return (
    <main className="onboarding-shell">
      <section className="onboarding-card" aria-labelledby="onboarding-title">
        <div className="auth-language">
          <LanguageSwitcher compact />
        </div>
        <p className="eyebrow">HOLYMEDIA MCP</p>
        <h1 id="onboarding-title">
          {ru ? "Данные компании" : "Company details"}
        </h1>
        <p className="muted">
          {ru
            ? "Заполните профиль компании. Доступ к рабочим функциям включится после проверки администратором."
            : "Complete your company profile. Working features will be available after administrator approval."}
        </p>
        <ol
          className="onboarding-steps"
          aria-label={ru ? "Шаги onboarding" : "Onboarding steps"}
        >
          <li className={`onboarding-step ${step === 1 ? "is-active" : ""}`}>
            <span className="onboarding-step__num">1</span>
            <strong>{ru ? "Компания" : "Company"}</strong>
          </li>
          <li className={`onboarding-step ${step === 2 ? "is-active" : ""}`}>
            <span className="onboarding-step__num">2</span>
            <strong>{ru ? "Коллеги" : "Colleagues"}</strong>
          </li>
        </ol>

        {step === 1 ? (
          <form className="onboarding-form" onSubmit={saveCompany}>
            <label>
              {ru ? "Название компании" : "Company name"}
              <input
                name="name"
                required
                minLength={2}
                maxLength={160}
                defaultValue={company.name}
              />
            </label>
            <label>
              {ru ? "Юридическое наименование" : "Legal company name"}
              <input
                name="legalName"
                required
                minLength={2}
                maxLength={255}
                defaultValue={company.legalName ?? ""}
              />
            </label>
            <label>
              {ru
                ? "БИН / регистрационный номер"
                : "Business registration number"}
              <input
                name="registrationNumber"
                required
                maxLength={64}
                defaultValue={company.registrationNumber ?? ""}
              />
            </label>
            <label>
              {ru ? "Юридический адрес / реквизиты" : "Legal address / details"}
              <textarea
                name="legalAddress"
                maxLength={500}
                defaultValue={company.legalAddress ?? ""}
              />
            </label>
            <label>
              {ru ? "Контактный телефон" : "Company phone"}
              <input
                name="companyPhone"
                maxLength={64}
                defaultValue={company.companyPhone ?? ""}
              />
            </label>
            <label>
              {ru ? "Рабочий email компании" : "Company email"}
              <input
                name="companyEmail"
                type="email"
                required
                maxLength={320}
                defaultValue={company.companyEmail ?? accountEmail}
              />
            </label>
            <label>
              {ru
                ? "Сайт компании (необязательно)"
                : "Company website (optional)"}
              <input
                name="websiteUrl"
                type="url"
                maxLength={500}
                defaultValue={company.websiteUrl ?? ""}
                placeholder="https://"
              />
            </label>
            <button className="primary-button" type="submit" disabled={busy}>
              {busy
                ? ru
                  ? "Сохраняем…"
                  : "Saving…"
                : ru
                  ? "Продолжить"
                  : "Continue"}
            </button>
          </form>
        ) : (
          <form className="onboarding-form" onSubmit={invite}>
            <h2>{ru ? "Пригласите коллег" : "Invite colleagues"}</h2>
            <p className="muted">
              {ru
                ? "Добавьте несколько email через запятую. Вы сможете управлять командой и приглашениями позже в профиле."
                : "Add multiple email addresses separated by commas. You can manage the team and invitations later from your profile."}
            </p>
            <label>
              {ru ? "Email коллег" : "Colleague emails"}
              <textarea
                name="emails"
                placeholder="name@company.com, teammate@company.com"
              />
            </label>
            <div className="onboarding-actions">
              <button className="primary-button" type="submit" disabled={busy}>
                {busy
                  ? ru
                    ? "Отправляем…"
                    : "Sending…"
                  : ru
                    ? "Отправить приглашения"
                    : "Send invitations"}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  window.location.assign(currentLocaleHref("/dashboard"))
                }
              >
                {ru ? "Пропустить и открыть профиль" : "Skip to profile"}
              </button>
            </div>
          </form>
        )}
        {notice && (
          <p className="success" role="status">
            {notice}
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
