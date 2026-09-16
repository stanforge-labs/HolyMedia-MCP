"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { languageSwitchHref, localeFromPath } from "./locale-routing";
import { ThemeSwitcher } from "./theme-switcher";
import { adminTranslations } from "./admin-translations";

export type Language = "en" | "ru";

const LANGUAGE_CHANGE_EVENT = "holymedia-language-change";
const PAIRS: Array<[string, string]> = [
  ...adminTranslations,
  ["Вход в админ-панель", "Admin sign in"],
  [
    "Отдельная защищённая сессия. Обычный клиентский вход здесь не подходит.",
    "Separate secure session. Customer sign-in cannot be used here.",
  ],
  ["Операционная панель", "Operations panel"],
  ["Защищённый доступ владельца", "Secure administrator access"],
  ["Разделы администрирования", "Administration sections"],
  ["Компании", "Companies"],
  ["Пользователи", "Users"],
  ["Диагностика", "Diagnostics"],
  ["Поддержка", "Support"],
  ["Заявки на тарифы", "Plan requests"],
  ["Журнал действий", "Audit log"],
  ["Логин", "Username"],
  ["Проверяем…", "Checking…"],
  ["Проверяем защищённую сессию…", "Checking secure session…"],
  ["Принять приглашение", "Accept invitation"],
  ["Код приглашения", "Invitation code"],
  [
    "Войдите в аккаунт, которому предназначено приглашение, затем вставьте одноразовый код из письма.",
    "Sign in to the account invited, then paste the one-time code from the email.",
  ],
  ["Новый пароль", "New password"],
  [
    "Придумайте новый пароль для аккаунта.",
    "Choose a new password for your account.",
  ],
  ["Код из письма", "Code from email"],
  ["Сохранить пароль", "Save password"],
  ["← Назад ко входу", "← Back to sign in"],
  ["Подключите кабинеты", "Connect accounts"],
  [
    "AI-клиент увидит все подключённые кабинеты вашей компании.",
    "Your AI client will see every connected account in your company.",
  ],
  [
    "AI видит все подключённые рекламные кабинеты вашей компании.",
    "AI can see every connected advertising account in your company.",
  ],
  ["Кабинеты вашей компании", "Your company accounts"],
  [
    "Доступ ограничен текущей компанией и её участниками.",
    "Access is limited to the current company and its members.",
  ],
  [
    "Ключ получит доступ ко всем подключённым кабинетам из раздела «Подключения» текущей компании.",
    "The key will have access to every connected account in the current company.",
  ],
  ["Рекламная аналитика и MCP", "Advertising analytics and MCP"],
  ["HolyMedia MCP", "HolyMedia MCP"],
  ["Навигация", "Navigation"],
  ["Пример ответа AI", "Example AI answer"],
  ["Как это работает", "How it works"],
  ["Пример ответа", "Example answer"],
  ["Войти", "Sign in"],
  ["Создать аккаунт", "Create account"],
  ["Регистрация", "Sign up"],
  ["Вся ваша реклама — в одном AI-чате", "All your advertising in one AI chat"],
  [
    "Подключите Meta, Google Ads, TikTok и Яндекс Директ. Спрашивайте о кампаниях, расходах и результатах в Claude, ChatGPT или Codex.",
    "Connect Meta, Google Ads, TikTok, and Yandex Direct. Ask about campaigns, spend, and results in Claude, ChatGPT, or Codex.",
  ],
  ["Ваш AI-клиент", "Your AI client"],
  [
    "Какие кампании активны и сколько мы потратили за неделю?",
    "Which campaigns are active and how much did we spend this week?",
  ],
  [
    "Активны 3 кампании, расходы за 7 дней — 412 500 ₸.",
    "3 campaigns are active; spend over 7 days is 412,500 KZT.",
  ],
  ["Лидогенерация · Meta Ads", "Lead generation · Meta Ads"],
  ["Поиск · Google Ads", "Search · Google Ads"],
  ["Ретаргетинг · Яндекс Директ", "Retargeting · Yandex Direct"],
  ["Демонстрационные данные · только просмотр", "Demo data · read-only"],
  [
    "Данные из ваших подключённых кабинетов · только просмотр",
    "Data from your connected accounts · read-only",
  ],
  ["Три шага до первого ответа", "Three steps to your first answer"],
  [
    "Подключение проходит через официальный вход рекламной платформы.",
    "Connect through the advertising platform's official authorization flow.",
  ],
  [
    "Настройка занимает один вечер и не требует разработчика.",
    "Setup takes one evening and requires no developer.",
  ],
  ["Подключите платформу", "Connect a platform"],
  [
    "Войдите через Google, Meta, TikTok или Яндекс.",
    "Sign in with Google, Meta, TikTok, or Yandex.",
  ],
  ["Подключите кабинеты", "Connect accounts"],
  [
    "AI-клиент увидит все подключённые кабинеты вашей компании.",
    "Your AI client will see every connected account in your company.",
  ],
  ["Подключите MCP", "Connect MCP"],
  [
    "Скопируйте адрес и следуйте инструкции для вашего клиента.",
    "Copy the URL and follow the instructions for your client.",
  ],
  ["Что можно узнать", "What you can learn"],
  [
    "AI видит все подключённые рекламные кабинеты вашей компании.",
    "AI can see every connected advertising account in your company.",
  ],
  [
    "какие кампании активны и где есть проблемы;",
    "which campaigns are active and where problems exist;",
  ],
  [
    "сколько потрачено за выбранный период;",
    "how much was spent during the selected period;",
  ],
  [
    "как изменились показы, клики и конверсии;",
    "how impressions, clicks, and conversions changed;",
  ],
  ["какая кампания потратила больше всего.", "which campaign spent the most."],
  [
    "Какие рекламные кабинеты подключены?",
    "Which advertising accounts are connected?",
  ],
  ["Какие кампании сейчас активны?", "Which campaigns are active right now?"],
  ["Покажи расходы за последние 7 дней", "Show spend for the last 7 days"],
  [
    "Сравни текущий период с предыдущим",
    "Compare the current period with the previous one",
  ],
  ["Безопасность", "Security"],
  ["Изменения — только после подтверждения", "Changes require your approval"],
  [
    "По умолчанию HolyMedia MCP только читает данные. Любое доступное изменение сначала показывает предварительный результат и ждёт вашего подтверждения.",
    "HolyMedia MCP is read-only by default. Any available change is previewed first and waits for your approval.",
  ],
  ["Только выбранные кабинеты", "Only selected accounts"],
  ["Доступ ограничен вашим аккаунтом.", "Access is limited to your account."],
  ["Без передачи паролей", "No password sharing"],
  ["Подключение через официальный OAuth.", "Connection uses official OAuth."],
  ["Контроль действий", "Action control"],
  [
    "Без подтверждения ничего не меняется.",
    "Nothing changes without approval.",
  ],
  ["Подключите первый кабинет", "Connect your first account"],
  [
    "Создайте аккаунт и выберите рекламную платформу.",
    "Create an account and choose an advertising platform.",
  ],
  [
    "HolyMedia MCP — продукт агентства HolyMedia.",
    "HolyMedia MCP is a HolyMedia agency product.",
  ],
  ["Политика конфиденциальности", "Privacy policy"],
  ["Условия использования", "Terms of use"],
  ["← Вернуться на главную", "← Back to home"],
  [
    "Войдите, чтобы открыть рекламные кабинеты.",
    "Sign in to open your advertising accounts.",
  ],
  ["Создайте аккаунт HolyMedia MCP.", "Create your HolyMedia MCP account."],
  [
    "Укажите email, который использовали при регистрации.",
    "Enter the email you used to register.",
  ],
  ["Войти через Google", "Continue with Google"],
  ["Имя", "Name"],
  ["Email", "Email"],
  ["Пароль", "Password"],
  ["Ваше имя", "Your name"],
  ["Ваш пароль", "Your password"],
  ["Минимум 12 символов", "At least 12 characters"],
  ["Забыли пароль?", "Forgot password?"],
  ["Подождите…", "Please wait…"],
  ["Зарегистрироваться", "Create account"],
  ["Отправить ссылку", "Send link"],
  ["Новый аккаунт", "New account"],
  ["Восстановление пароля", "Password recovery"],
  [
    "Если такой аккаунт есть, мы отправили письмо со ссылкой для сброса пароля.",
    "If an account exists, we sent an email with a password reset link.",
  ],
  ["Обзор", "Overview"],
  ["Подключения", "Connections"],
  ["AI-клиент", "AI client"],
  ["Отчёты", "Reports"],
  ["Анализ сайта", "Website audit"],
  ["Анализ сайта скоро вернётся", "Website audit is coming back soon"],
  [
    "Мы временно приостановили запуск новых аудитов. Существующие данные и отчёты сохранены.",
    "We have temporarily paused new audits. Existing data and reports remain available.",
  ],
  ["Вернуться в обзор", "Back to overview"],
  ["SEO", "SEO"],
  ["Тарифы", "Plans"],
  ["Скоро", "Coming soon"],
  ["Профиль", "Profile"],
  ["Выйти", "Sign out"],
  ["Личный кабинет", "Workspace"],
  ["Реклама в вашем AI-чате", "Advertising in your AI chat"],
  [
    "Подключите рекламные платформы, выберите кабинеты и задавайте вопросы о кампаниях обычными словами.",
    "Connect advertising platforms, select accounts, and ask about campaigns in plain language.",
  ],
  ["Подключить платформу", "Connect platform"],
  ["Подключить AI-клиент", "Connect AI client"],
  ["Платформы", "Platforms"],
  ["Кабинеты", "Accounts"],
  ["подключено", "connected"],
  ["выбрано", "selected"],
  ["Готов", "Ready"],
  ["ключ доступа", "access key"],
  ["Ключи доступа", "Access keys"],
  ["активных ключей", "active keys"],
  ["Требуют внимания", "Need attention"],
  ["подключений", "connections"],
  ["за выбранный период", "for the selected period"],
  ["Как начать", "How to start"],
  ["Официальный OAuth", "Official OAuth"],
  [
    "Отметьте аккаунты, с которыми хотите работать.",
    "Select the accounts you want to work with.",
  ],
  [
    "Скопируйте MCP URL и следуйте инструкции.",
    "Copy the MCP URL and follow the instructions.",
  ],
  ["Рекламные платформы", "Advertising platforms"],
  [
    "Подключите платформу и выберите кабинеты для AI-клиента.",
    "Connect a platform and select accounts for your AI client.",
  ],
  ["Подключено", "Connected"],
  ["Нужно проверить", "Needs review"],
  ["Нужно войти снова", "Reconnect required"],
  ["Не подключено", "Not connected"],
  ["кабинетов", "accounts"],
  ["Кабинеты ещё не найдены", "No accounts found yet"],
  [
    "Подключите платформу заново, чтобы восстановить доступ к кабинетам.",
    "Reconnect the platform to restore access to the accounts.",
  ],
  ["Скрыть кабинеты", "Hide accounts"],
  ["Посмотреть кабинеты", "View accounts"],
  ["Обновить", "Refresh"],
  ["Подключить заново", "Reconnect"],
  ["Отключить", "Disconnect"],
  ["Выберите кабинеты", "Select accounts"],
  ["Выбрать все", "Select all"],
  ["Снять все", "Clear all"],
  ["Доступен", "Available"],
  ["Проверьте статус в платформе", "Check the status in the platform"],
  ["Кабинеты пока не найдены.", "No accounts found yet."],
  ["Найти кабинеты", "Find accounts"],
  ["Сохраняем…", "Saving…"],
  ["Сохранить выбор", "Save selection"],
  ["Платформа ещё не подключена.", "This platform is not connected yet."],
  ["Подключить", "Connect"],
  ["Нужна помощь с подключением Meta?", "Need help connecting Meta?"],
  ["Подключите HolyMedia MCP", "Connect HolyMedia MCP"],
  [
    "Скопируйте адрес, создайте личный ключ и выберите инструкцию.",
    "Copy the URL, create a personal key, and choose an instruction.",
  ],
  ["Выберите AI-клиент", "Choose an AI client"],
  ["Проверяем данные…", "Checking data…"],
  ["Скачать отчёт", "Download report"],
  ["Собрать отчёт", "Build report"],
  [
    "В отчёт попадут только данные выбранного кабинета и периода.",
    "The report includes only data from the selected account and period.",
  ],
  ["Рекламный кабинет", "Advertising account"],
  ["Период", "Period"],
  ["Формат", "Format"],
  ["Выберите кабинет", "Select an account"],
  ["Последние 7 дней", "Last 7 days"],
  ["Последние 14 дней", "Last 14 days"],
  ["Последние 30 дней", "Last 30 days"],
  ["Последние 90 дней", "Last 90 days"],
  ["Word (.docx)", "Word (.docx)"],
  ["PowerPoint (.pptx)", "PowerPoint (.pptx)"],
  ["Нет данных", "No data"],
  ["Реальные данные", "Live data"],
  ["Данные недоступны", "Data unavailable"],
  ["Расход", "Spend"],
  ["Показы", "Impressions"],
  ["Клики", "Clicks"],
  ["Конверсии", "Conversions"],
  [
    "В документ попадут показатели, сравнение периодов, кампании и выводы только из этого источника.",
    "The document contains metrics, period comparison, campaigns, and findings from this source only.",
  ],
  [
    "Для отчёта нужен подключённый и выбранный кабинет Meta Ads или Google Ads.",
    "Select a connected Meta Ads or Google Ads account to build a report.",
  ],
  ["Перейти к подключениям", "Go to connections"],
  ["Проверяем выбранный кабинет", "Checking the selected account"],
  ["Выберите кабинет и период", "Select an account and period"],
  [
    "Обложка · KPI · сравнение · кампании · выводы",
    "Cover · KPIs · comparison · campaigns · findings",
  ],
  ["Анализ сайта", "Website audit"],
  ["Адрес сайта", "Website URL"],
  ["Глубина проверки", "Audit depth"],
  ["Быстрая", "Quick"],
  ["Полный анализ", "Full"],
  ["Проанализировать сайт", "Analyze website"],
  ["Загружаем профиль...", "Loading profile..."],
  ["Сохранить профиль", "Save profile"],
  ["Сменить пароль", "Change password"],
  ["Сохранить новый пароль", "Save new password"],
  ["Сохранить", "Save"],
  ["Закрыть сообщение", "Close message"],
  ["Отключить платформу?", "Disconnect platform?"],
  [
    "Реальные изменения не выполняются без отдельного подтверждения.",
    "Real changes are not executed without separate approval.",
  ],
  ["Войдите через официальный OAuth.", "Sign in through official OAuth."],
  ["Добавьте AI-клиент", "Add an AI client"],
  ["Яндекс Директ", "Yandex Direct"],
  [
    "Кампании, расходы, клики и конверсии.",
    "Campaigns, spend, clicks, and conversions.",
  ],
  [
    "Клиенты и рекламные кабинеты Директа.",
    "Direct clients and advertising accounts.",
  ],
  [
    "Доступные рекламные аккаунты TikTok.",
    "Available TikTok advertising accounts.",
  ],
  [
    "Не удалось обновить список аккаунтов.",
    "Couldn't refresh the account list.",
  ],
  ["Скопируйте MCP URL", "Copy the MCP URL"],
  ["Скопировать", "Copy"],
  ["MCP URL скопирован.", "MCP URL copied."],
  ["Создайте ключ доступа", "Create an access key"],
  ["Название", "Name"],
  ["Например, Codex", "For example, Codex"],
  ["Срок действия", "Expiration"],
  ["30 дней", "30 days"],
  ["90 дней", "90 days"],
  ["1 год", "1 year"],
  ["Ключ получит доступ к", "The key will have access to"],
  [
    "выбранным кабинетам из раздела «Подключения».",
    "selected accounts in Connections.",
  ],
  ["Дополнительные настройки", "Additional settings"],
  ["Разрешить подтверждённые изменения", "Allow confirmed changes"],
  [
    "Любое изменение потребует предварительного просмотра и подтверждения.",
    "Every change requires a preview and confirmation.",
  ],
  ["Создать ключ", "Create key"],
  ["Сохраните ключ сейчас", "Save the key now"],
  [
    "После закрытия страницы полный ключ больше не показывается.",
    "The full key is not shown again after this page is closed.",
  ],
  ["Ключ скопирован.", "Key copied."],
  ["Скрыть", "Hide"],
  ["Ваши ключи", "Your keys"],
  ["Без названия", "Untitled"],
  ["Назвать", "Name key"],
  ["Переименовать", "Rename"],
  ["Название ключа", "Key name"],
  ["Сохранить название", "Save name"],
  ["Сохраняем…", "Saving…"],
  ["Отмена", "Cancel"],
  ["Активен", "Active"],
  ["Истёк", "Expired"],
  ["Бессрочно", "No expiration"],
  ["Отозван", "Revoked"],
  ["Отозвать", "Revoke"],
  ["Без срока", "No expiration"],
  ["Обновить ключ", "Rotate key"],
  ["Отозвать ключ", "Revoke key"],
  ["Название ключа сохранено.", "Key name saved."],
  ["Не удалось сохранить название ключа.", "Couldn't save the key name."],
  [
    "Новый ключ готов. Сохраните его сейчас.",
    "Your new key is ready. Save it now.",
  ],
  ["Не удалось обновить ключ.", "Couldn't rotate the key."],
  ["Не удалось отозвать ключ.", "Couldn't revoke the key."],
  [
    "Текущее значение сразу перестанет работать. Новый ключ будет показан один раз.",
    "The current value stops working immediately. The new key is shown once.",
  ],
  [
    "AI-клиент с этим ключом потеряет доступ. Вернуть этот ключ нельзя.",
    "The AI client will lose access. This key cannot be restored.",
  ],
  ["Выберите AI-клиент", "Choose an AI client"],
  ["AI-клиенты", "AI clients"],
  [
    "Откройте настройки Codex и раздел MCP Servers.",
    "Open Codex settings and go to MCP Servers.",
  ],
  ["Добавьте HTTP-сервер с адресом", "Add an HTTP server with the URL"],
  ["В заголовке Authorization укажите", "Set the Authorization header to"],
  ["ваш ключ", "your key"],
  ["Сохраните и откройте новый чат.", "Save and open a new chat."],
  ["Откройте Settings → Connectors.", "Open Settings → Connectors."],
  [
    "Добавьте custom connector «HolyMedia MCP».",
    "Add the custom connector “HolyMedia MCP”.",
  ],
  ["Укажите адрес", "Enter the URL"],
  [
    "Пройдите вход в HolyMedia MCP, когда Claude его откроет.",
    "Sign in to HolyMedia MCP when Claude opens it.",
  ],
  [
    "Откройте настройки подключений ChatGPT.",
    "Open ChatGPT connection settings.",
  ],
  [
    "Создайте connector с полным адресом",
    "Create a connector with the full URL",
  ],
  [
    "Выберите OAuth и автоматическую регистрацию клиента.",
    "Select OAuth and automatic client registration.",
  ],
  [
    "Войдите в HolyMedia MCP и подтвердите подключение.",
    "Sign in to HolyMedia MCP and confirm the connection.",
  ],
  ["Отчёт по рекламному кабинету", "Advertising account report"],
  ["Отчёт", "Report"],
  ["Основные разделы", "Main sections"],
  ["Открыть профиль", "Open profile"],
  ["HolyMedia MCP — обзор", "HolyMedia MCP — overview"],
  ["Выберите кабинет и период.", "Select an account and period."],
  ["Подготовим Word-документ или", "We'll prepare a Word document or"],
  [
    "презентацию с показателями, сравнением и кампаниями.",
    "a presentation with metrics, comparisons, and campaigns.",
  ],
  ["HOLYMEDIA MCP · ОТЧЁТ", "HOLYMEDIA MCP · REPORT"],
  ["Не удалось подготовить отчёт", "Couldn't prepare the report"],
  ["Повторить проверку", "Retry check"],
  [
    "Получаем реальные показатели выбранного кабинета…",
    "Loading live metrics for the selected account…",
  ],
  ["Основные показатели", "Key metrics"],
  [
    "нужно переподключить, чтобы получить данные для отчёта.",
    "needs reconnecting to retrieve report data.",
  ],
  ["Открыть подключения", "Open connections"],
  ["Отчёт по", "Report on"],
  ["рекламным кампаниям", "advertising campaigns"],
  ["дней", "days"],
];

const translations = new Map(PAIRS);
const reverseTranslations = new Map(
  PAIRS.map(([russian, english]) => [english, russian]),
);
const orderedPairs = [...PAIRS].sort(
  (left, right) => right[0].length - left[0].length,
);
const reversePairs = [...PAIRS]
  .map(([russian, english]) => [english, russian] as const)
  .sort((left, right) => right[0].length - left[0].length);
const originals = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Record<string, string>>();
let activeLanguage: Language = "ru";
let applyingLanguage = false;

function translate(value: string, language: Language): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const normalizedTranslation =
    language === "en"
      ? translations.get(normalized)
      : reverseTranslations.get(normalized);
  if (normalizedTranslation)
    return value.replace(/\S[\s\S]*\S|\S/, normalizedTranslation);
  const exact =
    language === "ru"
      ? reverseTranslations.get(value)
      : translations.get(value);
  if (exact) return exact;
  const pairs = language === "ru" ? reversePairs : orderedPairs;
  return pairs.reduce(
    (current, [source, target]) => current.split(source).join(target),
    value,
  );
}

function isUiNode(node: Node): boolean {
  const parent = node.parentElement;
  return Boolean(
    parent?.closest(
      "[data-language-switcher], [data-language-static], script, style, noscript",
    ),
  );
}

function applyLanguage(language: Language): void {
  if (applyingLanguage) return;
  applyingLanguage = true;
  try {
    document.documentElement.lang = language;
    document.documentElement.dataset.language = language;
    document.querySelectorAll("[data-language-switcher]").forEach((root) => {
      root
        .querySelectorAll<HTMLButtonElement>("button[data-language]")
        .forEach((button) => {
          const active = button.dataset.language === language;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", String(active));
        });
    });
    document
      .querySelectorAll<HTMLElement>("[data-language-title]")
      .forEach((element) => {
        const title = element.dataset.languageTitle;
        if (title) document.title = translate(title, language);
      });
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE && !isUiNode(node))
        textNodes.push(node as Text);
    }
    textNodes.forEach((textNode) => {
      const current = textNode.nodeValue ?? "";
      const stored = originals.get(textNode);
      const base =
        stored === undefined ||
        (current !== translate(stored, "ru") &&
          current !== translate(stored, "en"))
          ? current
          : stored;
      originals.set(textNode, base);
      const next = translate(base, language);
      if (current !== next) textNode.nodeValue = next;
    });
    document
      .querySelectorAll<HTMLElement>("[placeholder], [title], [aria-label]")
      .forEach((element) => {
        if (element.closest("[data-language-static]")) return;
        const saved = originalAttributes.get(element) ?? {};
        (["placeholder", "title", "aria-label"] as const).forEach(
          (attribute) => {
            const current = element.getAttribute(attribute);
            if (!current) return;
            const base =
              saved[attribute] === undefined ||
              (current !== translate(saved[attribute], "ru") &&
                current !== translate(saved[attribute], "en"))
                ? current
                : saved[attribute];
            saved[attribute] = base;
            const next = translate(base, language);
            if (current !== next) element.setAttribute(attribute, next);
          },
        );
        originalAttributes.set(element, saved);
      });
    window.dispatchEvent(
      new CustomEvent<Language>(LANGUAGE_CHANGE_EVENT, { detail: language }),
    );
  } finally {
    applyingLanguage = false;
  }
}

export function useLanguage(): Language {
  return localeFromPath(usePathname());
}

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const language = useLanguage();
  useEffect(() => {
    activeLanguage = language;
    const apply = () => applyLanguage(activeLanguage);
    const observer = new MutationObserver(() => apply());
    apply();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [language]);

  function select(language: Language) {
    window.location.assign(languageSwitchHref(window.location.href, language));
  }

  return (
    <div className="header-preferences" data-language-static>
      <div
        className={
          compact
            ? "language-switcher language-switcher--compact"
            : "language-switcher"
        }
        data-language-switcher
      >
        <button
          type="button"
          data-language="en"
          aria-label="English"
          onClick={() => select("en")}
        >
          EN
        </button>
        <button
          type="button"
          data-language="ru"
          aria-label="Русский"
          onClick={() => select("ru")}
        >
          RU
        </button>
      </div>
      <ThemeSwitcher compact={compact} />
    </div>
  );
}
