import Link from "../components/locale-link";
import { LandingHeader } from "../components/landing-header";
import { SiteFooter } from "../components/site-footer";
import { TariffCatalog } from "../components/tariff-catalog";
import { publicPageMetadata } from "../components/page-metadata";

export function generateMetadata() {
  return publicPageMetadata("/", {
    ru: "HolyMedia MCP — AI-доступ к рекламным кабинетам",
    en: "HolyMedia MCP — AI access to advertising accounts",
  });
}

const baseUrl =
  process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ?? "https://mcp.holymedia.kz";

export default function PublicHomePage() {
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "HolyMedia MCP",
      url: baseUrl,
      inLanguage: "ru-KZ",
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "HolyMedia MCP",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: baseUrl,
      description:
        "AI-доступ к подключённым рекламным кабинетам для аналитики и отчётов.",
      publisher: {
        "@type": "Organization",
        name: "HolyMedia",
        url: "https://holymedia.kz",
      },
    },
  ];

  return (
    <main className="landing">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <LandingHeader />

      <div className="landing-main">
        <section className="hero">
          <div className="hero__copy">
            <p className="eyebrow">Рекламная аналитика и MCP</p>
            <h1>Вся ваша реклама — в одном AI-чате</h1>
            <p>
              Подключите Meta, Google Ads, TikTok и Яндекс Директ. Спрашивайте о
              кампаниях, расходах и результатах в Claude, ChatGPT или Codex.
            </p>
            <div className="hero__actions">
              <Link className="btn btn--primary" href="/auth?mode=signup">
                Создать аккаунт
              </Link>
              <Link className="btn btn--secondary" href="/auth">
                Войти
              </Link>
            </div>
          </div>
          <div className="hero-chat" aria-label="Пример ответа AI">
            <div className="hero-chat__title">
              <span>Пример ответа</span>
              <span>Claude · ChatGPT · Codex</span>
            </div>
            <div className="hero-chat__q">
              Какие кампании активны и сколько мы потратили за неделю?
            </div>
            <div className="hero-chat__a">
              <strong>
                Активны 3 кампании, расходы за 7 дней — 412 500 ₸.
              </strong>
              <span className="hero-chat__row">
                <span>Лидогенерация · Meta Ads</span>
                <b>184 300 ₸</b>
              </span>
              <span className="hero-chat__row">
                <span>Поиск · Google Ads</span>
                <b>141 900 ₸</b>
              </span>
              <span className="hero-chat__row">
                <span>Ретаргетинг · Яндекс Директ</span>
                <b>86 300 ₸</b>
              </span>
              <span className="hero-chat__src">
                Демонстрационные данные · только просмотр
              </span>
            </div>
          </div>
        </section>

        <section id="steps" className="how" aria-labelledby="steps-title">
          <h2 id="steps-title">Три шага до первого ответа</h2>
          <p className="how__intro">
            Подключение проходит через официальный вход рекламной платформы.
          </p>
          <ol className="how-steps">
            <li className="how-step">
              <div className="how-step__num">1</div>
              <div className="how-step__body">
                <h3>Подключите платформу</h3>
                <p>Войдите через Google, Meta, TikTok или Яндекс.</p>
              </div>
            </li>
            <li className="how-arrow" aria-hidden="true">
              →
            </li>
            <li className="how-step">
              <div className="how-step__num">2</div>
              <div className="how-step__body">
                <h3>Подключите кабинеты</h3>
                <p>
                  AI-клиент увидит все подключённые кабинеты вашей компании.
                </p>
              </div>
            </li>
            <li className="how-arrow" aria-hidden="true">
              →
            </li>
            <li className="how-step">
              <div className="how-step__num">3</div>
              <div className="how-step__body">
                <h3>Подключите MCP</h3>
                <p>
                  Скопируйте адрес и следуйте инструкции для вашего клиента.
                </p>
              </div>
            </li>
          </ol>
        </section>

        <section className="capabilities" aria-labelledby="capabilities-title">
          <div className="capabilities__copy">
            <h2 id="capabilities-title">Что можно узнать</h2>
            <p>AI видит все подключённые рекламные кабинеты вашей компании.</p>
            <ul className="capabilities__list">
              <li>какие кампании активны и где есть проблемы;</li>
              <li>сколько потрачено за выбранный период;</li>
              <li>как изменились показы, клики и конверсии;</li>
              <li>какая кампания потратила больше всего.</li>
            </ul>
          </div>
          <div className="question-list" aria-label="Примеры вопросов">
            <span>Какие рекламные кабинеты подключены?</span>
            <span>Какие кампании сейчас активны?</span>
            <span>Покажи расходы за последние 7 дней</span>
            <span>Сравни текущий период с предыдущим</span>
          </div>
        </section>

        <section className="control" aria-labelledby="control-title">
          <div className="control__panel">
            <div className="control__lead">
              <span className="control__eyebrow">Безопасность</span>
              <h2 id="control-title">Изменения — только после подтверждения</h2>
              <p>
                По умолчанию HolyMedia MCP только читает данные. Любое доступное
                изменение сначала показывает предварительный результат и ждёт
                вашего подтверждения.
              </p>
            </div>
            <ul className="control__points">
              <li>
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>Кабинеты вашей компании</strong>
                  <span>
                    Доступ ограничен текущей компанией и её участниками.
                  </span>
                </div>
              </li>
              <li>
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>Без передачи паролей</strong>
                  <span>Подключение через официальный OAuth.</span>
                </div>
              </li>
              <li>
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>Контроль действий</strong>
                  <span>Без подтверждения ничего не меняется.</span>
                </div>
              </li>
            </ul>
          </div>
        </section>

        <TariffCatalog />

        <section className="cta-band">
          <h2>Подключите первый кабинет</h2>
          <p>Создайте аккаунт и выберите рекламную платформу.</p>
          <Link className="btn btn--primary" href="/auth?mode=signup">
            Создать аккаунт
          </Link>
        </section>
      </div>
      <SiteFooter />
    </main>
  );
}
