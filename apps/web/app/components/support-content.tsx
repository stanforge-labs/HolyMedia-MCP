"use client";

import Link from "./locale-link";
import { useLanguage } from "./language-switcher";

export function SupportContent() {
  const language = useLanguage();
  const copy =
    language === "ru"
      ? {
          title: "Поддержка HolyMedia MCP",
          intro:
            "HolyMedia MCP позволяет подключать рекламные и аналитические источники к AI-клиентам для анализа данных и подготовки отчётов.",
          help: "Как получить помощь",
          helpText:
            "Напишите, с какой платформой и AI-клиентом вы работаете, что хотели сделать и какое сообщение об ошибке получили. Укажите время возникновения проблемы.",
          connections: "Проблемы с подключением",
          connectionsText:
            "Проверьте, что источник подключён в HolyMedia MCP и нужный рекламный кабинет или ресурс доступен вашему аккаунту. Если подключение истекло, повторите авторизацию в разделе подключений.",
          access: "Доступ к данным и OAuth",
          accessText:
            "HolyMedia MCP работает только с ресурсами, к которым у вашей компании есть доступ. Первая публичная версия предоставляет чтение данных; изменение рекламных кампаний недоступно. Подключение можно отключить в HolyMedia MCP или отозвать доступ в настройках соответствующей платформы.",
          security: "Безопасность и конфиденциальность",
          securityText:
            "Не отправляйте в поддержку пароли, токены, ключи доступа или коды авторизации. Перед отправкой сообщения или снимка экрана удалите секреты и лишние персональные данные.",
          privacy: "Политика конфиденциальности",
          terms: "Условия использования",
          contact: "Связаться с поддержкой",
          contactText:
            "По вопросам сервиса, подключённых платформ и обработки данных:",
        }
      : {
          title: "HolyMedia MCP Support",
          intro:
            "HolyMedia MCP connects advertising and analytics sources to AI clients for data analysis and reporting.",
          help: "How to get help",
          helpText:
            "Tell us which platform and AI client you use, what you were trying to do, and the error message you received. Include when the problem occurred.",
          connections: "Connection problems",
          connectionsText:
            "Check that the source is connected in HolyMedia MCP and that your account can access the required advertising account or resource. If the connection has expired, authorize it again in the connections section.",
          access: "Data access and OAuth",
          accessText:
            "HolyMedia MCP works only with resources available to your company. The first public release provides read access; changing advertising campaigns is unavailable. You can disconnect a source in HolyMedia MCP or revoke access in the platform's settings.",
          security: "Security and privacy",
          securityText:
            "Do not send passwords, tokens, access keys, or authorization codes to support. Remove secrets and unnecessary personal data from messages and screenshots before sending them.",
          privacy: "Privacy policy",
          terms: "Terms of use",
          contact: "Contact support",
          contactText:
            "For questions about the service, connected platforms, and data processing:",
        };

  return (
    <article className="legal-card" data-language-static>
      <h1>{copy.title}</h1>
      <p>{copy.intro}</p>
      <section>
        <h2>{copy.help}</h2>
        <p>{copy.helpText}</p>
      </section>
      <section>
        <h2>{copy.connections}</h2>
        <p>{copy.connectionsText}</p>
      </section>
      <section>
        <h2>{copy.access}</h2>
        <p>{copy.accessText}</p>
      </section>
      <section>
        <h2>{copy.security}</h2>
        <p>{copy.securityText}</p>
        <p>
          <Link href="/privacy">{copy.privacy}</Link>
          {" · "}
          <Link href="/terms">{copy.terms}</Link>
        </p>
      </section>
      <section>
        <h2>{copy.contact}</h2>
        <p>{copy.contactText}</p>
        <p>
          <a href="mailto:mcp@holymedia.kz">mcp@holymedia.kz</a>
        </p>
      </section>
    </article>
  );
}
