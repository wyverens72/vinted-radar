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

2026-10-24 filter UI: searchable single-brand sheet with custom entry and multi-size checkboxes. Full 29-test run passed; additional API size round-trip test passes in the cloud suite (30 total tests). Build succeeds. No database migration or changes to existing owner searches. Deployed version 37454368-033c-49e2-ae3e-7ee0d776df3b. Live UI verification pending below.
Live UI verified: opened new-search form, selected both S and M (both checked, count 2), applied to draft, entered custom brand Arket and selected it. Closed draft without saving, leaving owner searches unchanged. Screenshot saved outside repository as outputs/radar-size-picker.jpg. Existing single-size API searches remain valid; multiple-size API save/reload/pause round trip verified in isolated SQLite.


2026-10-24 native filter update: 33 automated tests pass, including URL target/parameter validation, canonical IDs, paginated deduplication, failed-page atomicity, CRUD/pause/export persistence. Cloudflare additive migration 0004 and deployment verified. GitHub Check 40104820104 passed. Collector run 40104820813 completed successfully with zero due jobs (fresh cache); this run is not evidence of a fresh Vinted fetch. Live category picker searched Jeansy and selected category 183 in an unsaved draft. Exact category-dependent size labels/IDs observed in public Vinted UI for 183 (women jeans), 16 (women shoes), 1037 (women outerwear). No login or challenge bypass.

Live public HTTP check from the Mac: canonical women-jeans (183), COS (2029), sizes S (3) OR M (4), two pages yielded 190 deduplicated records. All observed brands were COS; size labels were S, M, EU 36, EU 38, M / 38 / 10. This is a direct collector-function test, not a new saved user search or a GitHub-origin fetch. Published UI import restored readable S/M labels and both checked sizes; draft closed without saving. Final Cloudflare version 734d23bb-c987-4ea7-82ae-cdfa193d28c9.

2026-10-24 hierarchical category/brand update: build passes. Public /brands index and its 25 linked alphabet pages returned HTTP 200 without login; 5,901 unique IDs/names extracted and validated. Live unsaved UI checked root-only categories, Women → Clothing child-level navigation, Back, selecting all Women, brand search ARKET (also White House Black Market substring result), and distinct method selection. Screenshot outputs show method choice and clothing level. No existing search was edited for these UI checks.

Telegram self-registration: full 35-test suite passed. New tests verify private webhook-only onboarding, member role, Telegram chat binding, one-use browser code, per-user isolation, admin denial, no duplicate account, ignored group messages, disabled-account denial and atomic 10-account limit. Public registration remains off in fixtures unless explicitly enabled.

Progressive scan update: full automated suite passes, including resumable page targets (1–5 then 1,6,7...), stop on empty/repeated pages, no partial import on failed page, saved cursor persistence, first-pass notifications, historical baseline backfill and persistent deduplication after outbox cleanup. Feed pagination verified with 650 same-timestamp records and exclusion of another user's data. Free D1 budget tests pass after paced delivery changes. UI source/technical copy simplified; owner connection controls moved into collapsed management section.

Live verification: GitHub Check 40108345253 passed; collector run 40108345278 imported 470 records from five pages. Owner state showed progressive coverage through page five. Authenticated /check returned {found:0,failed:0} after cron had processed the import; subsequent state contained 91 saved findings, 34 queued notifications and no search errors. Existing searches were not edited. Full suite count: 38 passing tests.
