"use client";

import { useEffect } from "react";
import { useLanguage } from "./language-switcher";
import { privacyCopy } from "./privacy-copy";

type LegalSection = {
  heading: string;
  paragraphs?: string[];
  items?: string[];
};

type LegalCopy = {
  eyebrow: string;
  title: string;
  updated: string;
  intro: string[];
  sections: LegalSection[];
  contact: string;
  site: string;
};

const terms: Record<"ru" | "en", LegalCopy> = {
  ru: {
    eyebrow: "Правовая информация",
    title: "Условия использования HolyMedia MCP",
    updated: "Последнее обновление: 22 июня 2026 года",
    intro: [
      "Эти условия регулируют доступ к HolyMedia MCP: сайту, рабочему пространству, подключениям рекламных платформ, аналитике и связанным AI-функциям.",
      "Используя HolyMedia MCP, вы соглашаетесь с этими условиями.",
    ],
    sections: [
      {
        heading: "1. Описание сервиса",
        paragraphs: [
          "HolyMedia MCP позволяет подключать рекламные кабинеты, просматривать кампании, статусы и основные показатели, готовить отчёты и задавать вопросы через совместимые AI-клиенты.",
          "Изменения в рекламных кабинетах не выполняются без отдельного подтверждения.",
        ],
      },
      {
        heading: "2. Право на использование",
        paragraphs: [
          "У вас должны быть законные полномочия на подключение и просмотр рекламных кабинетов, которые вы авторизуете в HolyMedia MCP.",
        ],
      },
      {
        heading: "3. Аккаунт пользователя",
        paragraphs: [
          "Вы отвечаете за безопасность email, пароля, ключей доступа и подключений. При подозрении на компрометацию смените пароль, отзовите ключ или обратитесь в поддержку.",
        ],
      },
      {
        heading: "4. Подключения рекламных платформ",
        paragraphs: [
          "Подключая платформу, вы разрешаете HolyMedia MCP получать данные в пределах разрешений, показанных на экране OAuth. Вы можете отозвать доступ в HolyMedia MCP или настройках платформы.",
        ],
      },
      {
        heading: "5. AI-клиенты",
        paragraphs: [
          "Вы самостоятельно выбираете AI-клиент и предоставляемый ему доступ. Использование Claude, ChatGPT, Codex и других сторонних клиентов также регулируется их собственными условиями.",
        ],
      },
      {
        heading: "6. Допустимое использование",
        paragraphs: [
          "Нельзя использовать сервис для незаконной деятельности, доступа к чужим кабинетам, обхода авторизации или ограничений, перегрузки сервиса, загрузки вредоносного кода или нарушения правил рекламных платформ.",
        ],
      },
      {
        heading: "7. Безопасность рекламных действий",
        paragraphs: [
          "Рекомендации и отчёты не гарантируют рекламный результат и должны быть проверены вами. Любое доступное изменение рекламного объекта требует предварительного просмотра и явного подтверждения.",
        ],
      },
      {
        heading: "8. Сторонние платформы",
        paragraphs: [
          "Мы не отвечаем за сбои, API-лимиты, изменения правил, блокировки или проверки со стороны Google, Meta, TikTok, Яндекс и других платформ.",
        ],
      },
      {
        heading: "9. Доступность и изменения",
        paragraphs: [
          "Функции могут обновляться или временно ограничиваться для повышения безопасности и качества сервиса.",
        ],
      },
      {
        heading: "10. Интеллектуальная собственность",
        paragraphs: [
          "Интерфейс, код, документация, бренд и материалы HolyMedia MCP принадлежат соответствующим правообладателям и не могут распространяться без письменного разрешения.",
        ],
      },
      {
        heading: "11. Отказ от гарантий",
        paragraphs: [
          "Сервис предоставляется «как есть» и «по мере доступности». Мы не гарантируем бесперебойную работу или конкретный рекламный результат.",
        ],
      },
      {
        heading: "12. Ограничение ответственности",
        paragraphs: [
          "В максимальной степени, разрешённой законом, HolyMedia MCP не несёт ответственности за косвенные убытки, упущенную выгоду, рекламные расходы или действия сторонних платформ.",
        ],
      },
      {
        heading: "13. Приостановка доступа",
        paragraphs: [
          "Мы можем ограничить доступ при нарушении условий, угрозе безопасности, злоупотреблении сервисом или требованиях закона.",
        ],
      },
      {
        heading: "14. Изменения условий",
        paragraphs: [
          "Мы можем обновлять эти условия. Продолжение использования после обновления означает принятие новой версии.",
        ],
      },
    ],
    contact: "15. Контакты",
    site: "Сайт",
  },
  en: {
    eyebrow: "Legal information",
    title: "HolyMedia MCP Terms of Use",
    updated: "Last updated: June 22, 2026",
    intro: [
      "These terms govern access to HolyMedia MCP: the website, workspace, advertising platform connections, analytics, and related AI features.",
      "By using HolyMedia MCP, you agree to these terms.",
    ],
    sections: [
      {
        heading: "1. Service description",
        paragraphs: [
          "HolyMedia MCP lets you connect advertising accounts, view campaigns, statuses, and core metrics, prepare reports, and ask questions through compatible AI clients.",
          "Real changes in advertising accounts are not performed without separate confirmation.",
        ],
      },
      {
        heading: "2. Right to use",
        paragraphs: [
          "You must have legal authority to connect and view the advertising accounts you authorize in HolyMedia MCP.",
        ],
      },
      {
        heading: "3. User account",
        paragraphs: [
          "You are responsible for the security of your email, password, access keys, and connections. If you suspect exposure, change your password, revoke the key, or contact support.",
        ],
      },
      {
        heading: "4. Advertising platform connections",
        paragraphs: [
          "By connecting a platform, you allow HolyMedia MCP to receive data within the permissions shown on the OAuth consent screen. You can revoke access in HolyMedia MCP or the platform settings.",
        ],
      },
      {
        heading: "5. AI clients",
        paragraphs: [
          "You choose the AI client and the access you provide to it. Your use of Claude, ChatGPT, Codex, and other third-party clients is also governed by their own terms.",
        ],
      },
      {
        heading: "6. Acceptable use",
        paragraphs: [
          "You may not use the service for illegal activity, access to accounts belonging to others, bypassing authorization or limits, overloading the service, uploading malicious code, or violating advertising platform rules.",
        ],
      },
      {
        heading: "7. Advertising action safety",
        paragraphs: [
          "Recommendations and reports do not guarantee advertising results and must be reviewed by you. Any available advertising object change requires a preview and explicit confirmation.",
        ],
      },
      {
        heading: "8. Third-party platforms",
        paragraphs: [
          "We are not responsible for outages, API limits, rule changes, suspensions, or reviews by Google, Meta, TikTok, Yandex, or other platforms.",
        ],
      },
      {
        heading: "9. Availability and changes",
        paragraphs: [
          "Features may be updated or temporarily limited to improve security and service quality.",
        ],
      },
      {
        heading: "10. Intellectual property",
        paragraphs: [
          "The HolyMedia MCP interface, code, documentation, brand, and materials belong to their rights holders and may not be distributed without written permission.",
        ],
      },
      {
        heading: "11. Disclaimer of warranties",
        paragraphs: [
          "The service is provided as is and as available. We do not guarantee uninterrupted operation or specific advertising results.",
        ],
      },
      {
        heading: "12. Limitation of liability",
        paragraphs: [
          "To the maximum extent permitted by law, HolyMedia MCP is not liable for indirect losses, lost profits, advertising expenses, or actions of third-party platforms.",
        ],
      },
      {
        heading: "13. Suspension",
        paragraphs: [
          "We may restrict access for a breach of these terms, a security threat, abuse of the service, or legal requirements.",
        ],
      },
      {
        heading: "14. Changes to these terms",
        paragraphs: [
          "We may update these terms. Continued use after an update means you accept the new version.",
        ],
      },
    ],
    contact: "15. Contact",
    site: "Website",
  },
};

export function LegalContent({ kind }: { kind: "privacy" | "terms" }) {
  const language = useLanguage();
  const copy = terms[language];

  useEffect(() => {
    document.title =
      kind === "privacy"
        ? privacyCopy[language].split("\n")[0]!.slice(2)
        : `${copy.title} | HolyMedia MCP`;
  }, [copy.title, kind, language]);

  if (kind === "privacy")
    return (
      <article className="legal-card" data-language-static>
        {privacyCopy[language].split(/\n\n+/).map((block, index) => {
          if (block.startsWith("### "))
            return <h3 key={index}>{block.slice(4)}</h3>;
          if (block.startsWith("## "))
            return <h2 key={index}>{block.slice(3)}</h2>;
          if (block.startsWith("# "))
            return <h1 key={index}>{block.slice(2)}</h1>;
          if (block.startsWith("- "))
            return (
              <ul key={index}>
                {block.split("\n").map((item) => (
                  <li key={item}>{item.slice(2)}</li>
                ))}
              </ul>
            );
          if (block.startsWith("https://"))
            return (
              <p key={index}>
                <a href={block}>{block}</a>
              </p>
            );
          if (block === "mcp@holymedia.kz")
            return (
              <p key={index}>
                <a href={`mailto:${block}`}>{block}</a>
              </p>
            );
          return <p key={index}>{block}</p>;
        })}
      </article>
    );

  return (
    <article className="legal-card" data-language-static>
      <p className="eyebrow">{copy.eyebrow}</p>
      <h1>{copy.title}</h1>
      <p className="legal-updated">{copy.updated}</p>
      {copy.intro.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {copy.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.items && (
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <section>
        <h2>{copy.contact}</h2>
        <p>
          <strong>HolyMedia MCP</strong>
          <br />
          Email: <a href="mailto:mcp@holymedia.kz">mcp@holymedia.kz</a>
          <br />
          {copy.site}: <a href="https://mcp.holymedia.kz">mcp.holymedia.kz</a>
        </p>
      </section>
    </article>
  );
}
