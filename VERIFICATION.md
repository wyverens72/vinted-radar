# Проверка версии 2 — 24 октября 2026

Целевая среда: Cloudflare Workers Free + D1. Локально: Node.js 25.9.0, npm 11.12.1. GitHub Actions настроен для Node.js 24.

Проверено:

- Все 15 автоматических проверок прошли локально.

- GitHub Actions успешно проверил исходную облачную версию на Node.js 24.
- Production-сборка React/Vite успешна; Wrangler собрал и опубликовал Worker вместе с React/PWA.
- Создана постоянная база D1, применена миграция 0001_cloud.sql. Реальные вызовы планировщика подтверждены полем lastScheduled без ошибок.
- На реальном HTTPS-сайте выполнены вход владельца, создание поиска, ручная проверка и получение демонаходки.
- Избранное и сессия сохраняются после обновления страницы.
- Проверки покрывают подпись/срок Telegram, отсутствие самостоятельной регистрации, приглашение, изоляцию данных, запрет доступа к чужим поискам, отзыв доступа, одноразовый вход, секрет webhook, повтор update, получателя уведомления, повторную доставку и лимиты.
- SQL облачной версии тестируется с реальной SQLite и адаптером D1 batch; отдельно проверены реальный Worker и живая база D1.
- npm audit после обновления undici: 0 известных уязвимостей на момент установки; это не гарантия отсутствия дефектов.

Адрес: https://vinted-radar-wyverens72.sizayaptashka72-fd2.workers.dev

Реальный каталог и OAuth обычного аккаунта Vinted не подключены. Нужен отдельный разрешённый источник.

Приёмка настоящего Telegram-чата, аккаунта подруги, доставки по расписанию при закрытом приложении и установки на физический iPhone проводится после настройки бота. Автоматические тесты используют подставной Telegram API.


2026-10-24: Polish catalog preparation: 19 automated tests pass; frontend build and Worker dry run pass. Tests use synthetic authorized-feed records and mocked Telegram, not live Vinted access. Photo delivery, fallback, retry, PLN, country, condition, range and size matching verified in tests. Apify runtime integration removed. Production remains demo.


2026-10-24: Own public collector implemented. Local unauthenticated GET returned HTTP 200; parser extracted 96 Polish cards, including item price, size, condition, brand, photo and canonical URL. Empty-search HTML verified separately. Cloudflare owner-only diagnostic returned HTTP 429 and recorded an hourly cooldown. No successful live cloud ingestion or real Vinted photo notification claimed. Production DATA_SOURCE remains demo: activation rejected by automatic approval review pending explicit revocation of the earlier demo/authorized-source prerequisite. New tests cover parsing, HTTP blocks, redirects, no cookie replay, bounds, cache, baselines, deduplication, per-search errors and Free D1 budget.


2026-10-24 activation: owner explicitly revoked the demo/authorized-only prerequisite. Production now reports DATA_SOURCE=vinted-public (deployment 05be48f8-0908-4193-8be6-1532063ec95f). Existing cooldown preserved until 2026-10-24 16:01:57 Europe/Vilnius. Owner demo search paused; starter COS / M / Poland / max 60 PLN / 5 min created. Manual check confirmed the saved cooldown without requesting Vinted. No live cloud listings or real photo deliveries yet. UI status verified and screenshot saved outside repository. Frontend build succeeded; collector code unchanged from the 23-test passing version.


2026-10-24 diagnosis update: 26 tests pass. Fixed numeric Retry-After incorrectly competing with Date.parse as a year; this was a potential bug, not a proven cause of the observed refusal. Added bounded, redacted failure metadata and owner-only read endpoint. Cloudflare deployed d716f768-4ec0-44a4-b88d-68a0e90117fd, existing cooldown untouched. One Mac comparison using exactly the Worker URL and honest User-Agent returned 200, 96 parsed cards, 9 matching COS/M up to 60 PLN. No Mac results imported into production. GitHub one-request diagnostic prepared; result pending.


2026-10-24: GitHub connectivity diagnostic run 40093744802 returned HTTP 200, 96 records, 9 COS/M matches <=60 PLN. Added dedicated scoped collector, distributed lease, active-URL validation, timestamp validation, no-Cloudflare-fetch mode, persistent per-collector backoff and scheduled public Ubuntu workflow. 28 tests pass, build and Worker dry-run pass; final photo-return change covered by cloud tests. Production collection and photo delivery verification pending below.


2026-10-24 production verification: deployed 45d0cca8-b8d3-4cf0-8459-d506c1ae694e with CATALOG_FETCH_MODE=github. GitHub run 40094236006 imported 96 real records (one catalog); Worker monitoring produced 9 real owner matches with photos, no search errors and no Cloudflare source fetch. POST /api/telegram/test returned {ok:true,photo:true}, confirming a real photo message was accepted by Telegram. Live browser feed verified with nine listings and saved screenshot outputs/radar-real-catalog.jpg (outside repository). The workflow schedule is configured; initial end-to-end verification used a manual workflow dispatch. No permanent availability guarantee.
