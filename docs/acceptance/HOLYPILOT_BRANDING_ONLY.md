# HolyPilot: точечный ребрендинг существующей главной

Статус: **локальный кандидат; не опубликован**. Статическая страница из `infra/production-static-landing/` отклонена владельцем. Её разрешение на публикацию отозвано до изменения Nginx; пакет сохранён только как история и помечен `REJECTED / DO NOT PUBLISH` в прежней ветке.

## Production baseline и patch

За основу взят действительно работающий Web: OCI revision `a00817b746211a295bcb966f7fd7ef12cd6178fb`, image digest `sha256:09c08234278a6eee22c866bd260d5c6ddc66806a977afc2e6b51077c0677a833`. Метки образа и действующий контейнер проверены read-only. SHA-256 действующего Nginx-конфига остался `c711bb0b6f85390afa8482ed58611371c3648690a55f09f421254475e8fd1b91`; статический snippet отсутствует.

Ветка: `codex/holypilot-brand-only`, проверенный исходный SHA `bcb4a9f332d5b7e4ef92459d41f6e9f58bb6cca1`. Отдельный [минимальный patch приложения](holypilot-brand-only/branding-only.patch) применяется к этому production SHA и содержит только шесть файлов:

| Файл                                         | Изменение                                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `components/landing-header.tsx`              | Только импорт, содержимое фирменного блока и его брендовый aria-label                                                            |
| `components/site-footer.tsx`                 | Опциональный `holyPilot`, по умолчанию `false`; замена только первого фирменного блока при включении                             |
| `(public)/page.tsx`                          | Одна замена `<SiteFooter />` → `<SiteFooter holyPilot />`; весь остальной файл совпадает с baseline                              |
| `components/landing-brand-lockup.tsx`        | Изолированное переиспользование подготовленной композиции: официальный знак, HolyPilot, локализованный слоган                    |
| `components/landing-brand-lockup.module.css` | Стили только нового фирменного блока, в прежних размерах                                                                         |
| `public/assets/brand/holy-pilot-symbol.svg`  | Неизменённый официальный SVG из подготовленной ветки, SHA-256 `6001ff52f6ea2e1044c31a86bb3991c1e1783d0e9a6a14e940d5bea917b8c63e` |

Общий `BrandLockup`, `globals.css`, тексты, hero, демонстрационный чат, три шага, возможности, безопасность, тарифы, цены, CTA, меню, адаптивная сетка, favicon, metadata, OAuth и маршруты сохранены. Имя HolyMedia MCP в основном контенте намеренно осталось как в production: разрешены только два фирменных блока.

Новый компонент применяется только на главной RU/EN. Dashboard, admin, login, approval, подключение Claude, юридические страницы и их прежние фирменные блоки не получают новый логотип. Для остальных вызовов `SiteFooter` новый параметр по умолчанию выключен. Поддерево Astana Hub и все строки футера после него совпадают с baseline; обе версии SVG, ссылка `https://astanahub.com/`, размеры, положение, тема и юридические ссылки сохранены.

## Проверка сохранения сайта

1. Production baseline собран локально из точного SHA. Для RU/EN, desktop/mobile и двух тем сравнение с живым production дало **полное совпадение DOM вне фирменных блоков, геометрии, ссылок и 0 отличающихся пикселей на полном screenshot** — 8 сочетаний.
2. До/после проверены RU/EN × dark/light × ширины 1440, 768, 390 и 320 px — **16 сочетаний**. Нормализованный DOM, весь текст вне фирменных блоков, порядок секций, тарифы, ссылки, кнопки, видимость, вычисленные стили и координаты всех остальных элементов совпадают точно. Высота страницы и положение Astana Hub совпадают, горизонтального overflow нет. Оригинальная пропорция знака и размещение внутри прежних фирменных блоков проверяются отдельно.
3. Pixel-diff разрешает изменение только прямоугольников `.site-brand` и `.footer__identity`; координаты каждого размера записаны в [машинном отчёте](holypilot-brand-only/visual/comparison-report.json), на изображениях `*-allowed-regions.png` они обведены розовым. Основной контент и фон совпадают пиксель в пиксель.
4. Отдельно раскрыто ограничение raster comparison: в неизменённом полупрозрачном SVG Astana Hub Chromium отрисовал часть RGB-каналов с разницей **1–2 из 255**. Его исходные SVG, DOM, computed styles и геометрия совпадают. Только внутри этого SVG допускается такой шум растрирования; сырое число отличающихся пикселей сохранено в JSON. За пределами двух фирменных блоков и этой строго ограниченной погрешности SVG — **0 отличий**. Общей погрешности для остальных секций нет.
5. Локально проверены реальные переходы кнопок входа и регистрации на соответствующие RU/EN формы без отправки данных. Privacy, Terms, Support, admin, approval и Claude connection вернули 200 и сохранили прежнюю идентификацию. API в этих локальных проверках заменён ответом 401; provider LIVE и авторизованные production-сессии не запускались.

Первый проход выявил различие высоты прежних светлого и тёмного логотипов (ширина исходных SVG 371 и 379 при высоте 107). Новый фирменный блок сохраняет обе исходные высоты отдельно, поэтому Astana Hub и другие элементы не смещаются ни в одной теме.

## BEFORE / AFTER

Слева — текущий production, воспроизведённый локально и независимо сверенный с живым сайтом. Справа — локальный patch. Это **не screenshots опубликованного обновления**.

| Сравнение                   | Русский                                                                         | English                                                                      |
| --------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Desktop: верх               | [Открыть](holypilot-brand-only/visual/ru-dark-desktop-top-before-after.png)     | [Open](holypilot-brand-only/visual/en-dark-desktop-top-before-after.png)     |
| Desktop: футер              | [Открыть](holypilot-brand-only/visual/ru-dark-desktop-footer-before-after.png)  | [Open](holypilot-brand-only/visual/en-dark-desktop-footer-before-after.png)  |
| Mobile: верх                | [Открыть](holypilot-brand-only/visual/ru-dark-mobile-top-before-after.png)      | [Open](holypilot-brand-only/visual/en-dark-mobile-top-before-after.png)      |
| Mobile: футер               | [Открыть](holypilot-brand-only/visual/ru-dark-mobile-footer-before-after.png)   | [Open](holypilot-brand-only/visual/en-dark-mobile-footer-before-after.png)   |
| Desktop: полная страница    | [Открыть](holypilot-brand-only/visual/ru-dark-desktop-full-before-after.png)    | [Open](holypilot-brand-only/visual/en-dark-desktop-full-before-after.png)    |
| Mobile: полная страница     | [Открыть](holypilot-brand-only/visual/ru-dark-mobile-full-before-after.png)     | [Open](holypilot-brand-only/visual/en-dark-mobile-full-before-after.png)     |
| Светлая тема: desktop-футер | [Открыть](holypilot-brand-only/visual/ru-light-desktop-footer-before-after.png) | [Open](holypilot-brand-only/visual/en-light-desktop-footer-before-after.png) |
| Светлая тема: mobile-футер  | [Открыть](holypilot-brand-only/visual/ru-light-mobile-footer-before-after.png)  | [Open](holypilot-brand-only/visual/en-light-mobile-footer-before-after.png)  |

## Проверки и границы результата

- Local Web build, lint, typecheck, форматирование и `git diff --check`: PASS.
- `source-scope.mjs`: PASS; проверяет ограниченный список файлов, байтовую неизменность основной страницы, общих компонентов/CSS и Astana Hub.
- `capture.mjs` и `compare.py`: PASS для локального baseline/candidate и независимого read-only live baseline; полные отчёты и пары изображений приложены.
- `verify-routes.mjs`: PASS для RU/EN локально.
- [Linux CI 38938223080](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/38938223080), source `bcb4a9f332d5b7e4ef92459d41f6e9f58bb6cca1`: **PASS**. Он независимо собрал baseline и candidate на disposable runner, выполнил build/lint/typecheck, source-scope, 16 структурных/визуальных сравнений и RU/EN route checks. Артефакт `holypilot-brand-only-comparison`, ID `12061888145`, содержит полные screenshots и отчёт. Production URL, credentials, vault и БД в CI не используются; live baseline проверялся отдельно read-only с локальной машины.

Production Nginx, Web, API, Worker, PostgreSQL, Redis, OAuth, TEST и main не изменялись. [Повторная read-only проверка](holypilot-brand-only/production-readonly.txt): прежний Nginx checksum, snippet отсутствует, Web сохранил ID/image/start time, все девять контейнеров healthy; `/`, `/en`, `/health`, `/ready`, `/auth`, `/mcp/approve` вернули 200. Новой production-публикации, image pull или Google Ads mutations не было. Patch готов для проверки владельцем; прежние разрешения на Nginx/замену Web к нему не применяются.
