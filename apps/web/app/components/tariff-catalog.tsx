"use client";

import Link from "./locale-link";
import { useState } from "react";
import {
  SUPPORT_FEATURES,
  TARIFF_FEATURES,
  TARIFF_PLANS,
  type TariffServiceLevel,
} from "@holymedia/contracts";
import { useLanguage } from "./language-switcher";
import {
  SubscriptionInfo,
  type SubscriptionInfoValue,
} from "./subscription-info";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

const SUPPORT_GROUPS = [
  { key: "access", from: 0, to: 7 },
  { key: "reports", from: 7, to: 10 },
  { key: "team", from: 10, to: SUPPORT_FEATURES.length },
] as const;
const SERVICE_LEVELS: readonly TariffServiceLevel[] = [
  "SELF_SERVICE",
  "HOLYMEDIA_SUPPORT",
];

function money(value: number) {
  return `${new Intl.NumberFormat("ru-RU").format(value)} \u20b8`;
}

function planName(
  plan: (typeof TARIFF_PLANS)[number],
  level: TariffServiceLevel,
  language: "ru" | "en",
) {
  if (level === "SELF_SERVICE") return plan.name[language];
  return language === "ru"
    ? `${plan.name.ru} + поддержка`
    : `${plan.name.en} + support`;
}

export function TariffCatalog({
  subscription,
  workspaceId,
}: {
  subscription?: SubscriptionInfoValue | null;
  workspaceId?: string | undefined;
}) {
  const language = useLanguage();
  const ru = language === "ru";
  const [level, setLevel] = useState<TariffServiceLevel>("SELF_SERVICE");
  const [requestedPlan, setRequestedPlan] = useState<string | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const currentKey = subscription?.plan?.key;
  const supportMode = level === "HOLYMEDIA_SUPPORT";
  const modeCopy = supportMode
    ? ru
      ? "Команда Holy Media берёт на себя настройку, контроль и приоритетную поддержку."
      : "The Holy Media team handles setup, control, and priority support."
    : ru
      ? "Управляйте подключениями и работой самостоятельно в рамках выбранного тарифа."
      : "Manage connections and day-to-day work independently within your plan.";

  async function requestPlan(planKey: string) {
    if (!workspaceId) return;
    setPendingPlan(planKey);
    setRequestError(null);
    try {
      const response = await fetch(
        `${API}/api/v1/workspaces/${workspaceId}/billing/tariff-requests`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ planKey }),
        },
      );
      if (!response.ok) throw new Error("request_failed");
      setRequestedPlan(null);
      setRequestSent(true);
    } catch {
      setRequestError(
        ru
          ? "Не удалось отправить запрос. Попробуйте ещё раз."
          : "The request could not be sent. Please try again.",
      );
    } finally {
      setPendingPlan(null);
    }
  }

  function moveServiceLevel(current: TariffServiceLevel, direction: 1 | -1) {
    const currentIndex = SERVICE_LEVELS.indexOf(current);
    const next =
      SERVICE_LEVELS[
        (currentIndex + direction + SERVICE_LEVELS.length) %
          SERVICE_LEVELS.length
      ];
    if (next) setLevel(next);
    return next;
  }

  return (
    <section className="tariffs" id="tariffs" aria-labelledby="tariffs-title">
      <div className="tariffs__head">
        <div>
          <p className="eyebrow">
            {ru ? "ТАРИФЫ HOLYMEDIA" : "HOLYMEDIA PLANS"}
          </p>
          <h2 id="tariffs-title">
            {ru ? "Выберите формат работы" : "Choose how you work"}
          </h2>
          <p>{ru ? "Пробный период — 14 дней." : "14-day trial period."}</p>
        </div>
        <div
          className="tariffs__switch"
          role="radiogroup"
          aria-label={ru ? "Уровень обслуживания" : "Service level"}
        >
          {(
            [
              ["SELF_SERVICE", ru ? "Самостоятельно" : "Self-service"],
              [
                "HOLYMEDIA_SUPPORT",
                ru ? "Расширенная поддержка" : "Extended support",
              ],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              data-service-level={value}
              aria-checked={level === value}
              className={level === value ? "is-active" : ""}
              onClick={() => setLevel(value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                  event.preventDefault();
                  const next = moveServiceLevel(value, 1);
                  event.currentTarget.parentElement
                    ?.querySelector<HTMLButtonElement>(
                      `[data-service-level="${next}"]`,
                    )
                    ?.focus();
                }
                if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const next = moveServiceLevel(value, -1);
                  event.currentTarget.parentElement
                    ?.querySelector<HTMLButtonElement>(
                      `[data-service-level="${next}"]`,
                    )
                    ?.focus();
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="tariffs__mode-copy" aria-live="polite">
        {modeCopy}
      </p>

      {subscription && <SubscriptionInfo subscription={subscription} compact />}
      {requestError && (
        <p className="tariffs__request-error" role="alert">
          {requestError}
        </p>
      )}

      <div className="tariffs__plans">
        {TARIFF_PLANS.map((plan) => {
          const planKey = plan.dbKey[level];
          const selected = currentKey === planKey;
          return (
            <article
              className={
                plan.code === "marketing"
                  ? "tariff-plan tariff-plan--featured"
                  : "tariff-plan"
              }
              key={plan.code}
            >
              <div>
                <span>{plan.direction[language]}</span>
                <h3>{planName(plan, level, language)}</h3>
              </div>
              <strong>
                {money(plan.priceKzt[level])}
                <small>{ru ? " / мес." : " / mo."}</small>
              </strong>
              <p>
                {supportMode
                  ? ru
                    ? "Увеличенный лимит AI-токенов"
                    : "Increased AI token limit"
                  : `${plan.tokens.toLocaleString("ru-RU")} ${
                      ru ? "AI-токенов в месяц" : "AI tokens per month"
                    }`}
              </p>
              {selected ? (
                <b>{ru ? "Ваш тариф" : "Your plan"}</b>
              ) : workspaceId ? (
                <button
                  className="btn btn--secondary btn--small"
                  type="button"
                  onClick={() => {
                    setRequestSent(false);
                    setRequestedPlan(planKey);
                  }}
                >
                  {ru ? "Выбрать тариф" : "Choose plan"}
                </button>
              ) : (
                <Link
                  className="btn btn--secondary btn--small"
                  href="/auth?mode=signup"
                >
                  {ru ? "Начать пробный период" : "Start trial"}
                </Link>
              )}
            </article>
          );
        })}
      </div>

      {supportMode ? (
        <section
          className="tariffs__support-groups"
          aria-labelledby="support-benefits-title"
        >
          <div className="tariffs__support-head">
            <p className="eyebrow">
              {ru ? "С ПОДДЕРЖКОЙ HOLY MEDIA" : "WITH HOLY MEDIA SUPPORT"}
            </p>
            <h3 id="support-benefits-title">
              {ru
                ? "Что добавляет расширенная поддержка"
                : "What extended support adds"}
            </h3>
          </div>
          <div className="tariffs__support-grid">
            {SUPPORT_GROUPS.map((group) => {
              const rows = SUPPORT_FEATURES.slice(group.from, group.to);
              const title =
                group.key === "access"
                  ? ru
                    ? "Доступ и аналитика"
                    : "Access and analytics"
                  : group.key === "reports"
                    ? ru
                      ? "Отчёты"
                      : "Reports"
                    : ru
                      ? "Работа команды Holy Media"
                      : "Holy Media team";
              return (
                <article key={group.key}>
                  <h4>{title}</h4>
                  <ul>
                    {rows.map(([russian, english, , supported]) => (
                      <li key={russian}>
                        <span>{ru ? russian : english}</span>
                        <b>{supported}</b>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <div
          className="tariffs__table-wrap"
          tabIndex={0}
          role="region"
          aria-label={
            ru
              ? "Таблица сравнения тарифов. Прокручивается по горизонтали."
              : "Plan comparison table. Scroll horizontally."
          }
        >
          <table className="tariffs__table">
            <thead>
              <tr>
                <th>{ru ? "Возможности" : "Features"}</th>
                {TARIFF_PLANS.map((plan) => (
                  <th key={plan.code}>{plan.name[language]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TARIFF_FEATURES.map((feature) => (
                <tr key={feature.key}>
                  <th>{feature.label[language]}</th>
                  {TARIFF_PLANS.map((plan) => (
                    <td key={plan.code}>{feature.values[plan.code]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {requestedPlan && (
        <div
          className="tariffs__request-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tariff-request-title"
        >
          <div>
            <h3 id="tariff-request-title">
              {ru ? "Подтвердить запрос" : "Confirm request"}
            </h3>
            <p>
              {ru
                ? "Запрос будет отправлен администратору Holy Media. Тариф не изменится до его подтверждения."
                : "The request will be sent to a Holy Media administrator. Your plan will not change until it is approved."}
            </p>
            <div className="tariffs__request-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setRequestedPlan(null)}
              >
                {ru ? "Отмена" : "Cancel"}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={pendingPlan === requestedPlan}
                onClick={() => void requestPlan(requestedPlan)}
              >
                {pendingPlan === requestedPlan
                  ? ru
                    ? "Отправляем…"
                    : "Sending…"
                  : ru
                    ? "Отправить запрос"
                    : "Send request"}
              </button>
            </div>
          </div>
        </div>
      )}
      {requestSent && (
        <p className="tariffs__request-confirmation" role="status">
          {ru
            ? "Запрос отправлен администратору. Текущий тариф не изменён."
            : "Your request has been sent. Your current plan has not changed."}
        </p>
      )}
    </section>
  );
}
