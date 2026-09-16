"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  businessMemberTitleLabel,
  FULL_ACCESS_LIFETIME_PLAN_KEY,
  tariffPresentation,
} from "@holymedia/contracts";
import { BrandLockup } from "../components/brand-lockup";
import { LanguageSwitcher } from "../components/language-switcher";
import { ProjectSelect } from "../components/project-select";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
type Section =
  | "overview"
  | "companies"
  | "users"
  | "diagnostics"
  | "support"
  | "tariff-requests"
  | "audit";
type Json = Record<string, unknown>;

const labels: Record<Section, string> = {
  overview: "Обзор",
  companies: "Компании",
  users: "Пользователи",
  diagnostics: "Диагностика",
  support: "Поддержка",
  "tariff-requests": "Заявки на тарифы",
  audit: "Журнал действий",
};

const providerLabels: Record<string, string> = {
  GOOGLE_ADS: "Google Ads",
  META_ADS: "Meta Ads",
  TIKTOK_ADS: "TikTok Ads",
  YANDEX_DIRECT: "Яндекс Директ",
  GOOGLE_SEARCH_CONSOLE: "Google Search Console",
};

const statusLabels: Record<string, string> = {
  ACTIVE: "Активна",
  active: "Активен",
  PENDING: "На проверке",
  SUSPENDED: "Приостановлена",
  disabled: "Заблокирован",
  CONNECTED: "Подключено",
  DEGRADED: "Требует внимания",
  REAUTH_REQUIRED: "Нужно переподключить",
  ERROR: "Ошибка",
  ok: "Работает",
  not_probed: "Не проверялось",
  failed: "Ошибка",
  NEW: "Новый",
  IN_PROGRESS: "В работе",
  WAITING_FOR_CLIENT: "Ждём клиента",
  READY_FOR_CONNECTION: "Готов к подключению",
  COMPLETED: "Завершён",
  CANCELED: "Отменён",
  CLOSED: "Закрыта",
  IN_REVIEW: "На рассмотрении",
  APPROVED: "Одобрена",
  DECLINED: "Отклонена",
};

const roleLabels: Record<string, string> = {
  OWNER: "Владелец",
  ADMIN: "Администратор",
  MEMBER: "Участник",
  VIEWER: "Наблюдатель",
};

const eventLabels: Record<string, string> = {
  login_success: "Вход в систему",
  logout: "Выход из системы",
  admin_login_success: "Вход в админ-панель",
  admin_login_failed: "Неудачная попытка входа в админ-панель",
  admin_logout: "Выход из админ-панели",
  admin_plan_assigned: "Назначен коммерческий тариф",
  admin_full_access_assigned: "Назначен полный бессрочный доступ",
  admin_full_access_removed: "Снят полный бессрочный доступ",
  company_profile_updated: "Обновлён профиль компании",
  company_access_updated: "Изменён доступ компании",
  user_access_updated: "Изменён доступ пользователя",
  provider_connected: "Подключена рекламная платформа",
  provider_disconnected: "Отключена рекламная платформа",
  provider_reauthorized: "Обновлён доступ к платформе",
  report_generated: "Сформирован отчёт",
  mcp_tool_executed: "Выполнен запрос AI-клиента",
  invitation_created: "Отправлено приглашение",
  invitation_accepted: "Принято приглашение",
};

async function csrf(): Promise<string> {
  const response = await fetch(`${API}/api/v1/auth/csrf`, {
    credentials: "include",
  });
  const data = (await response.json()) as { csrfToken: string };
  return data.csrfToken;
}

async function adminFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.method && !["GET", "HEAD"].includes(init.method)) {
    headers.set("x-csrf-token", await csrf());
    if (init.body) headers.set("content-type", "application/json");
  }
  return fetch(`${API}/api/v1/admin${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
}

function formatDate(value: unknown) {
  if (!value || typeof value !== "string") return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function value(row: Json, key: string) {
  const item = row[key];
  return typeof item === "string" || typeof item === "number"
    ? String(item)
    : "—";
}

function humanStatus(status: string) {
  return statusLabels[status] ?? status.replaceAll("_", " ");
}

function humanRole(role: string) {
  return roleLabels[role] ?? role;
}

function humanMembershipRole(item: Json) {
  return (
    businessMemberTitleLabel(value(item, "businessTitle")) ??
    humanRole(value(item, "role"))
  );
}

function humanProvider(provider: string) {
  return providerLabels[provider] ?? provider.replaceAll("_", " ");
}

function humanEvent(eventType: string) {
  return eventLabels[eventType] ?? eventType.replaceAll("_", " ");
}

function humanError(code: string) {
  if (code === "—") return code;
  const labels: Record<string, string> = {
    insufficient_permissions: "Недостаточно разрешений у подключения",
    reauth_required: "Нужно переподключить аккаунт",
    provider_error: "Ошибка рекламной платформы",
  };
  return labels[code] ?? code.replaceAll("_", " ");
}

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [section, updateSection] = useState<Section>("overview");
  function setSection(next: Section) {
    updateSection(next);
    const url = new URL(window.location.href);
    url.searchParams.set("section", next);
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }
  const [data, setData] = useState<Json>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyStatus, setCompanyStatus] = useState("");
  const [selectedCompany, setSelectedCompany] = useState<Json | null>(null);
  const [confirmation, setConfirmation] = useState<null | {
    title: string;
    body: string;
    action: () => Promise<void>;
  }>(null);

  useEffect(() => {
    const requestedSection = new URLSearchParams(window.location.search).get(
      "section",
    );
    if (requestedSection && Object.hasOwn(labels, requestedSection))
      updateSection(requestedSection as Section);
  }, []);

  const endpoint = useMemo(() => {
    if (section === "companies") {
      const query = new URLSearchParams();
      if (companyQuery.trim()) query.set("q", companyQuery.trim());
      if (companyStatus) query.set("status", companyStatus);
      return `/companies?${query.toString()}`;
    }
    return `/${section}`;
  }, [section, companyQuery, companyStatus]);

  async function load(path = endpoint) {
    setBusy(true);
    setError("");
    try {
      const response = await adminFetch(path);
      if (response.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!response.ok) throw new Error("load");
      setData((await response.json()) as Json);
    } catch {
      setError("Не удалось загрузить данные админ-панели.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void (async () => {
      const response = await adminFetch("/session");
      if (response.ok) {
        setAuthenticated(true);
      } else {
        setAuthenticated(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (authenticated) void load();
  }, [authenticated, endpoint]);

  async function mutate(
    path: string,
    method: "POST" | "PATCH" | "PUT" | "DELETE",
    body: Json,
    success?: () => void,
  ) {
    setBusy(true);
    setError("");
    try {
      const response = await adminFetch(path, {
        method,
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("mutation");
      success?.();
      await load();
    } catch {
      setError("Действие не выполнено. Проверьте права и повторите попытку.");
    } finally {
      setBusy(false);
      setConfirmation(null);
    }
  }

  async function openCompany(id: string) {
    setBusy(true);
    setError("");
    try {
      const response = await adminFetch(`/companies/${id}`);
      if (!response.ok) throw new Error("company");
      setSelectedCompany((await response.json()) as Json);
    } catch {
      setError("Не удалось открыть компанию.");
    } finally {
      setBusy(false);
    }
  }

  if (authenticated === null)
    return <main className="admin-loading">Проверяем защищённую сессию…</main>;
  if (!authenticated)
    return <AdminLogin onAuthenticated={() => setAuthenticated(true)} />;

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <BrandLockup />
        <div className="admin-header__title">
          <strong>Операционная панель</strong>
          <small>Защищённый доступ владельца</small>
        </div>
        <div className="admin-header__actions">
          <LanguageSwitcher compact />
          <button
            className="text-button"
            onClick={() =>
              void adminFetch("/auth/logout", { method: "POST" }).then(() =>
                setAuthenticated(false),
              )
            }
          >
            Выйти
          </button>
        </div>
      </header>
      <div className="admin-layout">
        <nav className="admin-nav" aria-label="Разделы администрирования">
          {(Object.keys(labels) as Section[]).map((item) => (
            <button
              key={item}
              className={section === item ? "is-active" : ""}
              onClick={() => {
                setSection(item);
                setSelectedCompany(null);
              }}
            >
              {labels[item]}
            </button>
          ))}
        </nav>
        <section className="admin-content" aria-live="polite">
          <div className="admin-page-head">
            <div>
              <p className="eyebrow">HOLYMEDIA MCP</p>
              <h1>{labels[section]}</h1>
            </div>
            {busy && <span className="status-badge">Обновление…</span>}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {section === "overview" && (
            <Overview
              data={data}
              onPending={() => {
                setCompanyStatus("PENDING");
                setSection("companies");
              }}
            />
          )}
          {section === "companies" && (
            <Companies
              data={data}
              query={companyQuery}
              status={companyStatus}
              onQuery={setCompanyQuery}
              onStatus={setCompanyStatus}
              onOpen={openCompany}
            />
          )}
          {section === "users" && (
            <Users
              data={data}
              onChange={(id, status) =>
                setConfirmation({
                  title:
                    status === "disabled"
                      ? "Заблокировать пользователя?"
                      : "Восстановить доступ пользователя?",
                  body:
                    status === "disabled"
                      ? "Все активные пользовательские сессии будут отозваны. Данные и memberships сохранятся."
                      : "Пользователь снова сможет войти в существующие компании.",
                  action: () =>
                    mutate(`/users/${id}/access`, "PATCH", { status }),
                })
              }
            />
          )}
          {section === "diagnostics" && <Diagnostics data={data} />}
          {section === "support" && (
            <Support
              data={data}
              onChange={(id, status) =>
                setConfirmation({
                  title: "Обновить статус запроса?",
                  body: "Изменяется только карточка обращения. Данные подключений и провайдеров не затрагиваются.",
                  action: () => mutate(`/support/${id}`, "PATCH", { status }),
                })
              }
              onFeedbackChange={(id, status) =>
                setConfirmation({
                  title: "Обновить статус обращения?",
                  body: "Изменится только статус заявки поддержки. Данные компании и подключений не затрагиваются.",
                  action: () =>
                    mutate(`/support/feedback/${id}`, "PATCH", { status }),
                })
              }
            />
          )}
          {section === "tariff-requests" && (
            <TariffRequests
              data={data}
              onChange={(id, status) =>
                setConfirmation({
                  title: "Обновить статус заявки?",
                  body: "Изменяется только статус заявки. Тариф и доступ компании меняются отдельно через карточку компании.",
                  action: () =>
                    mutate(`/tariff-requests/${id}`, "PATCH", { status }),
                })
              }
            />
          )}
          {section === "audit" && <Audit data={data} />}
        </section>
      </div>
      {selectedCompany && (
        <CompanyDrawer
          company={selectedCompany}
          onClose={() => setSelectedCompany(null)}
          onAccess={(id, status) =>
            setConfirmation({
              title:
                status === "ACTIVE"
                  ? "Активировать компанию?"
                  : status === "SUSPENDED"
                    ? "Приостановить доступ компании?"
                    : "Вернуть компанию на проверку?",
              body:
                status === "ACTIVE"
                  ? "Рабочий доступ станет доступен. Подключения, кабинеты и provider bindings не изменятся."
                  : "Данные сохранятся, но рабочий доступ будет ограничен согласно V2 policy.",
              action: () =>
                mutate(
                  `/companies/${id}/access`,
                  "PATCH",
                  { status },
                  () => void openCompany(id),
                ),
            })
          }
          onPlan={(id, planKey, mode) =>
            setConfirmation({
              title:
                mode === "TRIAL"
                  ? "Начать пробный период?"
                  : "Активировать тариф?",
              body:
                mode === "TRIAL"
                  ? "Компания получит 14 дней бесплатного доступа. Платёж не создаётся."
                  : "Тариф будет активирован вручную без создания платежа.",
              action: () =>
                mutate(
                  `/companies/${id}/plan`,
                  "PUT",
                  { planKey, mode },
                  () => void openCompany(id),
                ),
            })
          }
          onFullLifetimeAccess={(id, action) =>
            setConfirmation({
              title:
                action === "assign"
                  ? "Назначить полный доступ / бессрочно?"
                  : "Снять полный бессрочный доступ?",
              body:
                action === "assign"
                  ? "Вы действительно хотите предоставить этой компании полный бессрочный доступ ко всем функциям HolyMedia MCP? Оплата и срок действия не создаются."
                  : "Бессрочный доступ будет снят. После этого можно назначить обычный коммерческий тариф или trial.",
              action: () =>
                mutate(
                  `/companies/${id}/access/full-lifetime`,
                  action === "assign" ? "POST" : "DELETE",
                  {},
                  () => void openCompany(id),
                ),
            })
          }
          onEntitlement={(id, featureKey, entitlementValue) =>
            setConfirmation({
              title: "Изменить entitlement?",
              body: "Изменится только явное право этой компании; её статус доступа и данные провайдеров не затрагиваются.",
              action: () =>
                mutate(
                  `/companies/${id}/entitlements`,
                  "PUT",
                  { featureKey, value: entitlementValue },
                  () => void openCompany(id),
                ),
            })
          }
          onInvitation={(id, action) =>
            setConfirmation({
              title:
                action === "resend"
                  ? "Отправить приглашение повторно?"
                  : "Отменить приглашение?",
              body:
                action === "resend"
                  ? "Старая ссылка будет отозвана, а новая отправлена на адрес приглашения."
                  : "Приглашение нельзя будет принять.",
              action: () =>
                mutate(
                  `/invitations/${id}`,
                  "POST",
                  { action },
                  () =>
                    selectedCompany.id &&
                    void openCompany(String(selectedCompany.id)),
                ),
            })
          }
        />
      )}
      {confirmation && (
        <ConfirmDialog
          {...confirmation}
          busy={busy}
          onClose={() => setConfirmation(null)}
        />
      )}
    </main>
  );
}

function AdminLogin({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await adminFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          login: String(form.get("login") ?? ""),
          password: String(form.get("password") ?? ""),
        }),
      });
      if (!response.ok) throw new Error("login");
      onAuthenticated();
    } catch {
      setError("Неверные данные или admin-доступ не настроен.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="admin-login">
      <section className="admin-login__card">
        <LanguageSwitcher compact />
        <BrandLockup />
        <p className="eyebrow">HOLYMEDIA MCP · SYSTEM ACCESS</p>
        <h1>Вход в админ-панель</h1>
        <p className="muted">
          Отдельная защищённая сессия. Обычный клиентский вход здесь не
          подходит.
        </p>
        <form onSubmit={submit}>
          <label>
            Логин
            <input
              name="login"
              autoComplete="username"
              defaultValue="Admin"
              required
            />
          </label>
          <label>
            Пароль
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="primary-button" disabled={busy}>
            {busy ? "Проверяем…" : "Войти"}
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}

function Overview({ data, onPending }: { data: Json; onPending: () => void }) {
  const companies = (data.companies ?? {}) as Json;
  const connections = (data.connections ?? {}) as Json;
  const health = (data.health ?? {}) as Json;
  return (
    <div className="admin-stack">
      <div className="admin-metrics">
        <Metric label="Компании" value={value(companies, "total")} />
        <button
          className="admin-metric admin-metric--action"
          onClick={onPending}
        >
          <span>На проверке</span>
          <strong>{value(companies, "pending")}</strong>
          <small>Открыть очередь</small>
        </button>
        <Metric label="Активны" value={value(companies, "active")} />
        <Metric label="Приостановлены" value={value(companies, "suspended")} />
        <Metric label="Пользователи" value={value(data, "users")} />
        <Metric
          label="Подключения"
          value={value(connections, "active")}
          note={`Внимание: ${value(connections, "attention")}`}
        />
      </div>
      <section className="admin-card">
        <h2>Состояние системы</h2>
        <div className="admin-health">
          {Object.entries(health).map(([name, status]) => (
            <div key={name}>
              <span>{name}</span>
              <strong className={status === "ok" ? "is-ok" : "is-muted"}>
                {humanStatus(String(status))}
              </strong>
            </div>
          ))}
        </div>
      </section>
      <section className="admin-card">
        <h2>Последние события</h2>
        <SimpleEvents
          rows={
            Array.isArray(data.latestAudit) ? (data.latestAudit as Json[]) : []
          }
        />
      </section>
    </div>
  );
}

function Metric({
  label,
  value: metric,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="admin-metric">
      <span>{label}</span>
      <strong>{metric}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function Companies({
  data,
  query,
  status,
  onQuery,
  onStatus,
  onOpen,
}: {
  data: Json;
  query: string;
  status: string;
  onQuery: (value: string) => void;
  onStatus: (value: string) => void;
  onOpen: (id: string) => void;
}) {
  const rows = Array.isArray(data.companies) ? (data.companies as Json[]) : [];
  return (
    <div className="admin-stack">
      <div className="admin-filters">
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Компания, email или БИН"
          aria-label="Поиск компании"
        />
        <ProjectSelect
          ariaLabel="Статус компании"
          value={status}
          onChange={onStatus}
          options={[
            { value: "", label: "Все статусы" },
            { value: "PENDING", label: "На проверке" },
            { value: "ACTIVE", label: "Активные" },
            { value: "SUSPENDED", label: "Приостановленные" },
          ]}
        />
        <div className="admin-filter-actions" aria-label="Быстрые фильтры">
          <button
            type="button"
            className={status === "PENDING" ? "is-active" : ""}
            onClick={() => onStatus(status === "PENDING" ? "" : "PENDING")}
          >
            На проверке
          </button>
          <button
            type="button"
            className={status === "ACTIVE" ? "is-active" : ""}
            onClick={() => onStatus(status === "ACTIVE" ? "" : "ACTIVE")}
          >
            Активные
          </button>
        </div>
      </div>
      <section className="admin-card admin-table-wrap">
        <p className="muted">Найдено: {value(data, "total")}</p>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Компания</th>
              <th>БИН / контакт</th>
              <th>Владелец</th>
              <th>Статус</th>
              <th>Тариф</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const owner = Array.isArray(row.memberships)
                ? (row.memberships[0] as Json | undefined)
                : undefined;
              const member = owner?.user as Json | undefined;
              const subscription = Array.isArray(row.subscriptions)
                ? (row.subscriptions[0] as Json | undefined)
                : undefined;
              const plan = subscription?.plan as Json | undefined;
              return (
                <tr key={String(row.id)}>
                  <td>
                    <strong>{value(row, "name")}</strong>
                    <small>{value(row, "legalName")}</small>
                  </td>
                  <td>
                    {value(row, "registrationNumber")}
                    <small>{value(row, "companyEmail")}</small>
                  </td>
                  <td>
                    {member ? value(member, "name") : "—"}
                    <small>{member ? value(member, "email") : ""}</small>
                  </td>
                  <td>
                    <Status status={value(row, "accessStatus")} />
                  </td>
                  <td>{plan ? value(plan, "name") : "—"}</td>
                  <td>
                    <button
                      className="secondary-button"
                      onClick={() => onOpen(String(row.id))}
                    >
                      Открыть
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <Empty text="Компании по этому фильтру не найдены." />
        )}
      </section>
    </div>
  );
}

function Users({
  data,
  onChange,
}: {
  data: Json;
  onChange: (id: string, status: string) => void;
}) {
  const rows = Array.isArray(data.users) ? (data.users as Json[]) : [];
  return (
    <section className="admin-card admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Пользователь</th>
            <th>Компании / роли</th>
            <th>Последняя сессия</th>
            <th>Статус</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              <td>
                <strong>{value(row, "name")}</strong>
                <small>{value(row, "email")}</small>
              </td>
              <td>
                {Array.isArray(row.memberships)
                  ? (row.memberships as Json[]).map((item) => {
                      const workspace = item.workspace as Json;
                      return (
                        <small key={String(workspace.id)}>
                          {value(workspace, "name")} ·{" "}
                          {humanMembershipRole(item)}
                        </small>
                      );
                    })
                  : "—"}
              </td>
              <td>
                {Array.isArray(row.sessions) && row.sessions[0]
                  ? formatDate((row.sessions[0] as Json).lastSeenAt)
                  : "—"}
              </td>
              <td>
                <Status status={value(row, "status")} />
              </td>
              <td>
                <button
                  className="secondary-button"
                  onClick={() =>
                    onChange(
                      String(row.id),
                      value(row, "status") === "active" ? "disabled" : "active",
                    )
                  }
                >
                  {value(row, "status") === "active"
                    ? "Заблокировать"
                    : "Восстановить"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <Empty text="Пользователи не найдены." />}
    </section>
  );
}

function Diagnostics({ data }: { data: Json }) {
  const connections = Array.isArray(data.connections)
    ? (data.connections as Json[])
    : [];
  const tokens = Array.isArray(data.tokens) ? (data.tokens as Json[]) : [];
  return (
    <div className="admin-stack">
      <section className="admin-card admin-table-wrap">
        <h2>Подключения рекламных платформ</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Компания</th>
              <th>Платформа</th>
              <th>Статус</th>
              <th>Кабинеты</th>
              <th>Последняя ошибка</th>
            </tr>
          </thead>
          <tbody>
            {connections.map((row) => {
              const workspace = row.workspace as Json;
              const count = row._count as Json;
              return (
                <tr key={String(row.id)}>
                  <td>{value(workspace, "name")}</td>
                  <td>{humanProvider(value(row, "provider"))}</td>
                  <td>
                    <Status status={value(row, "status")} />
                  </td>
                  <td>{value(count, "accounts")}</td>
                  <td className="admin-cell-text">
                    {humanError(value(row, "lastErrorCode"))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section className="admin-card admin-table-wrap">
        <h2>Ключи AI-клиента</h2>
        <p className="muted">
          Только lifecycle-метаданные; значения токенов не отображаются.
        </p>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Компания</th>
              <th>Имя</th>
              <th>Идентификатор</th>
              <th>Истекает</th>
              <th>Последнее использование</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((row) => {
              const identity = row.serviceIdentity as Json;
              const workspace = identity?.workspace as Json;
              return (
                <tr key={String(row.id)}>
                  <td>{workspace ? value(workspace, "name") : "—"}</td>
                  <td>{value(row, "name")}</td>
                  <td>{value(row, "tokenPrefix")}</td>
                  <td>{formatDate(row.expiresAt)}</td>
                  <td>{formatDate(row.lastUsedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Support({
  data,
  onChange,
  onFeedbackChange,
}: {
  data: Json;
  onChange: (id: string, status: string) => void;
  onFeedbackChange: (id: string, status: string) => void;
}) {
  const rows = Array.isArray(data.requests) ? (data.requests as Json[]) : [];
  const feedbackRows = Array.isArray(data.feedbackRequests)
    ? (data.feedbackRequests as Json[])
    : [];
  return (
    <>
      <section className="admin-card admin-table-wrap">
        <h2>Запросы на подключение</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Компания / пользователь</th>
              <th>Платформа</th>
              <th>Сообщение</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const workspace = row.workspace as Json;
              const user = row.user as Json;
              return (
                <tr key={String(row.id)}>
                  <td>
                    <strong>{value(workspace, "name")}</strong>
                    <small>{value(user, "email")}</small>
                  </td>
                  <td>{humanProvider(value(row, "provider"))}</td>
                  <td className="admin-cell-text">
                    {value(row, "clientNote")}
                  </td>
                  <td>
                    <ProjectSelect
                      ariaLabel="Статус запроса"
                      value={value(row, "status")}
                      onChange={(status) => onChange(String(row.id), status)}
                      options={[
                        { value: "NEW", label: "Новый" },
                        { value: "IN_PROGRESS", label: "В работе" },
                        { value: "WAITING_FOR_CLIENT", label: "Ждём клиента" },
                        {
                          value: "READY_FOR_CONNECTION",
                          label: "Готов к подключению",
                        },
                        { value: "COMPLETED", label: "Завершён" },
                        { value: "CANCELED", label: "Отменён" },
                      ]}
                    />
                  </td>
                  <td>{formatDate(row.updatedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <Empty text="Открытых обращений нет." />}
      </section>
      <section className="admin-card admin-table-wrap">
        <h2>Обратная связь с сайта</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Пользователь / компания</th>
              <th>Тема</th>
              <th>Сообщение</th>
              <th>Статус</th>
              <th>Telegram</th>
            </tr>
          </thead>
          <tbody>
            {feedbackRows.map((row) => {
              const workspace = row.workspace as Json;
              const user = row.user as Json;
              const history = Array.isArray(row.history)
                ? (row.history as Json[])
                : [];
              return (
                <tr key={String(row.id)}>
                  <td>{formatDate(row.createdAt)}</td>
                  <td>
                    <strong>{value(user, "name")}</strong>
                    <small>{value(user, "email")}</small>
                    <small>{value(workspace, "name")}</small>
                  </td>
                  <td>{feedbackCategory(value(row, "category"))}</td>
                  <td className="admin-cell-text">
                    <details className="support-details">
                      <summary>{preview(value(row, "message"))}</summary>
                      <p>{value(row, "message")}</p>
                      <p>Страница: {value(row, "sourceRoute")}</p>
                      <p>
                        Тариф:{" "}
                        {(() => {
                          const plan = tariffPresentation(
                            value(row, "planKey") || null,
                          );
                          return `${plan.full.ru} / ${plan.full.en}`;
                        })()}
                      </p>
                      {history.length > 0 && (
                        <p>
                          История:{" "}
                          {history
                            .map((event) => formatDate(event.createdAt))
                            .join(" · ")}
                        </p>
                      )}
                    </details>
                  </td>
                  <td>
                    <ProjectSelect
                      ariaLabel="Статус обращения"
                      value={value(row, "status")}
                      onChange={(status) =>
                        onFeedbackChange(String(row.id), status)
                      }
                      options={[
                        { value: "NEW", label: "Новая" },
                        { value: "IN_PROGRESS", label: "В работе" },
                        { value: "CLOSED", label: "Закрыта" },
                      ]}
                    />
                  </td>
                  <td>
                    {telegramStatus(value(row, "telegramDeliveryStatus"))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {feedbackRows.length === 0 && <Empty text="Заявок с сайта пока нет." />}
      </section>
    </>
  );
}

function feedbackCategory(value: string) {
  return (
    { SUGGESTION: "Пожелание", PROBLEM: "Проблема", QUESTION: "Вопрос" }[
      value
    ] ?? "Обращение"
  );
}

function telegramStatus(value: string) {
  return (
    {
      PENDING: "В очереди",
      SENDING: "Отправляется",
      SENT: "Доставлено",
      FAILED: "Не доставлено",
      NOT_CONFIGURED: "Не настроено",
    }[value] ?? "Статус неизвестен"
  );
}

function preview(value: string) {
  return value.length > 120 ? `${value.slice(0, 117)}…` : value;
}

function TariffRequests({
  data,
  onChange,
}: {
  data: Json;
  onChange: (id: string, status: string) => void;
}) {
  const rows = Array.isArray(data.requests) ? (data.requests as Json[]) : [];
  return (
    <section className="admin-card admin-table-wrap">
      <h2>Заявки пользователей на тариф</h2>
      <p className="muted">
        Одобрение заявки не меняет доступ автоматически: назначение тарифа
        остаётся отдельным действием администратора.
      </p>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Компания / пользователь</th>
            <th>Текущий тариф</th>
            <th>Запрошенный тариф</th>
            <th>Режим</th>
            <th>Дата</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const workspace = row.workspace as Json;
            const user = row.user as Json;
            const current = Array.isArray(workspace?.subscriptions)
              ? (workspace.subscriptions[0] as Json)
              : undefined;
            const currentPlan = current?.plan as Json;
            const requestedPlan = row.requestedPlan as Json;
            return (
              <tr key={String(row.id)}>
                <td>
                  <strong>{value(workspace, "name")}</strong>
                  <small>{value(user, "email")}</small>
                </td>
                <td>{currentPlan ? value(currentPlan, "name") : "—"}</td>
                <td>{value(requestedPlan, "name")}</td>
                <td>
                  {value(row, "requestedServiceLevel") === "HOLYMEDIA_SUPPORT"
                    ? "Расширенная поддержка"
                    : "Самостоятельно"}
                </td>
                <td>{formatDate(row.createdAt)}</td>
                <td>
                  <ProjectSelect
                    ariaLabel="Статус заявки на тариф"
                    value={value(row, "status")}
                    onChange={(status) => onChange(String(row.id), status)}
                    options={[
                      { value: "PENDING", label: "Новая" },
                      { value: "IN_REVIEW", label: "На рассмотрении" },
                      { value: "APPROVED", label: "Одобрена" },
                      { value: "DECLINED", label: "Отклонена" },
                      { value: "CANCELED", label: "Отменена" },
                    ]}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <Empty text="Заявок на тарифы пока нет." />}
    </section>
  );
}

function Audit({ data }: { data: Json }) {
  return (
    <section className="admin-card admin-table-wrap">
      <p className="muted">Всего событий: {value(data, "total")}</p>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Время</th>
            <th>Событие</th>
            <th>Компания</th>
            <th>Актор</th>
            <th>Результат</th>
          </tr>
        </thead>
        <tbody>
          {(Array.isArray(data.events) ? (data.events as Json[]) : []).map(
            (row) => {
              const workspace = row.workspace as Json;
              const actor = row.actorUser as Json;
              return (
                <tr key={String(row.id)}>
                  <td>{formatDate(row.createdAt)}</td>
                  <td>{humanEvent(value(row, "eventType"))}</td>
                  <td>{workspace ? value(workspace, "name") : "—"}</td>
                  <td>{actor ? value(actor, "email") : "admin"}</td>
                  <td>
                    <Status status={row.success === true ? "ok" : "failed"} />
                  </td>
                </tr>
              );
            },
          )}
        </tbody>
      </table>
    </section>
  );
}

function CompanyDrawer({
  company,
  onClose,
  onAccess,
  onPlan,
  onFullLifetimeAccess,
  onEntitlement,
  onInvitation,
}: {
  company: Json;
  onClose: () => void;
  onAccess: (id: string, status: "PENDING" | "ACTIVE" | "SUSPENDED") => void;
  onPlan: (id: string, planKey: string, mode: "TRIAL" | "ACTIVE") => void;
  onFullLifetimeAccess: (id: string, action: "assign" | "remove") => void;
  onEntitlement: (
    id: string,
    featureKey: string,
    value: boolean | number | string,
  ) => void;
  onInvitation: (id: string, action: "resend" | "cancel") => void;
}) {
  const id = String(company.id);
  const subscriptions = Array.isArray(company.subscriptions)
    ? (company.subscriptions as Json[])
    : [];
  const activePlan = subscriptions[0]?.plan as Json | undefined;
  const fullLifetimeAccess =
    value(activePlan ?? {}, "key") === FULL_ACCESS_LIFETIME_PLAN_KEY;
  const invitations = Array.isArray(company.invitations)
    ? (company.invitations as Json[])
    : [];
  const [plans, setPlans] = useState<Json[]>([]);
  const [selectedPlanKey, setSelectedPlanKey] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    void adminFetch("/plans")
      .then(async (response) =>
        response.ok ? ((await response.json()) as Json) : {},
      )
      .then((result) =>
        setPlans(Array.isArray(result.plans) ? (result.plans as Json[]) : []),
      )
      .catch(() => setPlans([]));
  }, []);
  useEffect(() => {
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  function submitEntitlement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const featureKey = String(form.get("featureKey") ?? "").trim();
    const rawValue = String(form.get("value") ?? "").trim();
    if (!featureKey || !rawValue) return;
    const entitlementValue =
      rawValue === "true"
        ? true
        : rawValue === "false"
          ? false
          : Number.isFinite(Number(rawValue))
            ? Number(rawValue)
            : rawValue;
    onEntitlement(id, featureKey, entitlementValue);
  }
  return (
    <aside
      className="admin-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="company-title"
    >
      <div className="admin-drawer__head">
        <div>
          <p className="eyebrow">КОМПАНИЯ</p>
          <h2 id="company-title">{value(company, "name")}</h2>
        </div>
        <button
          ref={closeButtonRef}
          className="icon-button"
          aria-label="Закрыть карточку компании"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="admin-drawer__body">
        <div className="admin-actions">
          <Status status={value(company, "accessStatus")} />
          <button
            className="primary-button"
            onClick={() => onAccess(id, "ACTIVE")}
          >
            Активировать
          </button>
          <button
            className="secondary-button"
            onClick={() => onAccess(id, "SUSPENDED")}
          >
            Приостановить
          </button>
          <button
            className="text-button"
            onClick={() => onAccess(id, "PENDING")}
          >
            Вернуть на проверку
          </button>
        </div>
        <Detail
          title="Реквизиты"
          values={[
            ["Юр. наименование", value(company, "legalName")],
            ["БИН / рег. номер", value(company, "registrationNumber")],
            ["Страна", value(company, "registrationCountry")],
            ["Адрес", value(company, "legalAddress")],
            ["Email", value(company, "companyEmail")],
            ["Телефон", value(company, "companyPhone")],
          ]}
        />
        <Detail
          title="Участники"
          values={(Array.isArray(company.memberships)
            ? (company.memberships as Json[])
            : []
          ).map((item) => {
            const user = item.user as Json;
            return [
              value(user, "name"),
              `${value(user, "email")} · ${humanMembershipRole(item)} · ${humanStatus(value(user, "status"))}`,
            ];
          })}
        />
        <section>
          <h3>Тариф и доступные возможности</h3>
          <p className="muted">
            Текущий тариф:{" "}
            {fullLifetimeAccess
              ? "Полный доступ / бессрочно"
              : activePlan
                ? value(activePlan, "name")
                : "не назначен"}
          </p>
          <div className="admin-inline">
            {fullLifetimeAccess ? (
              <button
                type="button"
                className="text-button"
                onClick={() => onFullLifetimeAccess(id, "remove")}
              >
                Снять полный бессрочный доступ
              </button>
            ) : (
              <button
                type="button"
                className="secondary-button"
                onClick={() => onFullLifetimeAccess(id, "assign")}
              >
                Назначить полный доступ / бессрочно
              </button>
            )}
          </div>
          <div className="admin-inline">
            <ProjectSelect
              ariaLabel="Тариф компании"
              value={selectedPlanKey}
              placeholder="Выберите тариф"
              onChange={setSelectedPlanKey}
              options={plans.map((plan) => ({
                value: value(plan, "key"),
                label: value(plan, "name"),
              }))}
            />
            <button
              className="secondary-button"
              disabled={!selectedPlanKey}
              onClick={() =>
                selectedPlanKey && onPlan(id, selectedPlanKey, "TRIAL")
              }
            >
              Запустить trial на 14 дней
            </button>
            <button
              className="secondary-button"
              disabled={!selectedPlanKey}
              onClick={() =>
                selectedPlanKey && onPlan(id, selectedPlanKey, "ACTIVE")
              }
            >
              Назначить тариф
            </button>
          </div>
          <ul className="admin-list">
            {(Array.isArray(company.entitlements)
              ? (company.entitlements as Json[])
              : []
            ).map((item) => (
              <li key={value(item, "featureKey")}>
                <code>{value(item, "featureKey")}</code> · {String(item.value)}
                <small>Источник: {value(item, "source")}</small>
              </li>
            ))}
          </ul>
          <form className="admin-entitlement-form" onSubmit={submitEntitlement}>
            <input
              name="featureKey"
              placeholder="Код возможности"
              aria-label="Код возможности"
              required
            />
            <input
              name="value"
              placeholder="Значение"
              aria-label="Значение возможности"
              required
            />
            <button className="secondary-button" type="submit">
              Сохранить возможность
            </button>
          </form>
        </section>
        <section>
          <h3>Подключения</h3>
          <ul className="admin-list">
            {(Array.isArray(company.connections)
              ? (company.connections as Json[])
              : []
            ).map((item) => (
              <li key={String(item.id)}>
                {humanProvider(value(item, "provider"))} ·{" "}
                <Status status={value(item, "status")} /> ·{" "}
                {value(item._count as Json, "accounts")} кабинетов
              </li>
            ))}
          </ul>
          <p className="muted">
            Выбранных кабинетов: {value(company, "selectedAccountCount")}.
            Действия админки не меняют provider bindings.
          </p>
        </section>
        <section>
          <h3>Приглашения</h3>
          <ul className="admin-list">
            {invitations.map((item) => (
              <li key={String(item.id)}>
                <strong>{value(item, "email")}</strong>
                <small>
                  {value(item, "role")} · до {formatDate(item.expiresAt)}
                </small>
                <span>
                  <button
                    className="text-button"
                    onClick={() => onInvitation(String(item.id), "resend")}
                  >
                    Повторить
                  </button>
                  <button
                    className="text-button"
                    onClick={() => onInvitation(String(item.id), "cancel")}
                  >
                    Отменить
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>История действий</h3>
          <SimpleEvents
            rows={
              Array.isArray(company.auditEvents)
                ? (company.auditEvents as Json[])
                : []
            }
          />
        </section>
      </div>
    </aside>
  );
}

function Detail({ title, values }: { title: string; values: string[][] }) {
  return (
    <section>
      <h3>{title}</h3>
      <dl className="admin-details">
        {values.map(([name, item]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{item}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
function SimpleEvents({ rows }: { rows: Json[] }) {
  return (
    <ul className="admin-list">
      {rows.map((row) => (
        <li key={String(row.id)}>
          <strong>{humanEvent(value(row, "eventType"))}</strong>
          <small>
            {formatDate(row.createdAt)} ·{" "}
            {row.success === false ? "ошибка" : "успешно"}
          </small>
        </li>
      ))}
      {rows.length === 0 && <li className="muted">Событий пока нет.</li>}
    </ul>
  );
}
function Status({ status }: { status: string }) {
  return (
    <span className={`admin-status admin-status--${status.toLowerCase()}`}>
      {humanStatus(status)}
    </span>
  );
}
function Empty({ text: empty }: { text: string }) {
  return <p className="admin-empty">{empty}</p>;
}
function ConfirmDialog({
  title,
  body,
  action,
  busy,
  onClose,
}: {
  title: string;
  body: string;
  action: () => Promise<void>;
  busy: boolean;
  onClose: () => void;
}) {
  return (
    <div className="admin-confirm-backdrop" role="presentation">
      <section
        className="admin-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <h2 id="confirm-title">{title}</h2>
        <p>{body}</p>
        <div>
          <button
            className="secondary-button"
            onClick={onClose}
            disabled={busy}
          >
            Отмена
          </button>
          <button
            className="primary-button"
            onClick={() => void action()}
            disabled={busy}
          >
            {busy ? "Сохраняем…" : "Подтвердить"}
          </button>
        </div>
      </section>
    </div>
  );
}
