# Vinted Radar

Сайт: https://app.vinted-radar.workers.dev

Личный радар находок: React PWA, Telegram Mini App и Telegram-бот. Облачная версия работает на Cloudflare Workers + D1 + Cron Triggers; ориентирована на бесплатный тариф и небольшую группу приглашённых пользователей.

**Собственный сборщик публичного Vinted.pl включён по подтверждению владельца. Текущая схема: GitHub Actions собирает, Cloudflare хранит и уведомляет; Mac не нужен.** Он читает первую страницу HTML без входа и отправки cookies. С компьютера получен HTTP 200 и разобраны 96 карточек; предыдущая проверка с Cloudflare получила HTTP 429. Сохранённая пауза после отказа доступа не сбрасывается при публикации. Текущий статус показан в приложении. Наличие технического доступа не означает разрешения Vinted. Проект не связан с Vinted.

## Возможности

- Личные поиски, фильтры, пауза, избранное и экспорт JSON.
- Отдельные данные для каждого пользователя; до 5 поисков на человека и до 10 аккаунтов на установку.
- Вход через проверенную подпись Telegram или одноразовую ссылку /login. Пароль владельца — резервный вход только для владельца.
- Приглашение подруги на 24 часа с однократной регистрацией её Telegram ID. Отзыв неиспользованного приглашения, отключение/включение доступа участника.
- Планировщик Cloudflare запускается каждую минуту. Интервал поисков от 5 минут. Не более 5 поисков за один запуск; при очереди проверки могут запаздывать.
- Новые совпадения собираются в одно Telegram-сообщение на поиск с первыми пятью находками; вся лента доступна в приложении.
- Дедупликация находок и очередь повторной доставки. До одного сообщения на чат за один запуск расписания.
- Telegram webhook с секретным заголовком; /start, /login, /status, /stop.
- Установка PWA на iPhone/Mac и экран отсутствия сети. Для просмотра личных данных нужен интернет.

## Разработка

Нужен Node.js 24+.

```bash
npm ci
npm test
npm run build
npm run cloud:db:local
```

Создайте локальный файл `.dev.vars` (не публикуется):

```dotenv
APP_PASSWORD=your-long-random-owner-password-at-least-24-chars
TELEGRAM_WEBHOOK_SECRET=your-long-random-webhook-secret
```

```bash
npm run cloud:dev
```

Откройте http://localhost:8787. Локальная база D1 отделена от облачной. Для разработки React можно пересобирать `npm run build` и обновлять страницу.

Проверка планировщика локально: откройте `http://localhost:8787/cdn-cgi/handler/scheduled` при запуске с `--test-scheduled` (включён в cloud:dev). С настоящим BOT_TOKEN этот вызов может отправить сообщения; для теста используйте тестового бота.

## Бесплатное размещение

Подробно: [FREE_HOSTING.md](FREE_HOSTING.md).

```bash
npm run cloud:login
npx wrangler d1 create vinted-radar
```

Укажите возвращённый `database_id` в `wrangler.jsonc` (при развёртывании своей копии замените существующий ID):

```bash
npm run cloud:db:remote
npm run cloud:deploy
```

Добавьте `APP_PASSWORD` длиной минимум 24 символа и `TELEGRAM_WEBHOOK_SECRET` как секреты Cloudflare. Не коммитьте `.env`, `.dev.vars`, `.cloudflare-secrets.json` или базу. `PUBLIC_URL` задаётся равным выданному HTTPS-адресу без завершающего `/`.

GitHub Actions проверяет исходники на push; автоматическая публикация с GitHub не включена. Обновления публикуются через `npm run cloud:deploy` после входа Wrangler.

## Подключение Telegram

1. Создайте бота через официальный @BotFather (`/newbot`).
2. В Cloudflare откройте ваш Worker → Settings → Variables and Secrets.
3. Добавьте секреты `BOT_TOKEN` и `TELEGRAM_OWNER_ID` (числовой ID владельца); строки `BOT_USERNAME` (без @) и `PUBLIC_URL`. `TELEGRAM_WEBHOOK_SECRET` — отдельный случайный секрет, минимум 24 символа.
4. Разверните изменение настроек. Войдите на сайт по паролю владельца.
5. Подключение → **Подключить Telegram webhook**. Кнопка регистрирует webhook, команды и меню Mini App. После неё локальный старый polling с тем же токеном запускать нельзя.
6. Отправьте боту /start, затем проверьте тестовое сообщение в приложении.
7. Чтобы войти в Safari, отправьте /login и откройте выданную ссылку. Перед входом подтвердите отображённое имя. Ссылка действует 5 минут, одноразовая и не предназначена для пересылки.

Если числовой Telegram ID неизвестен, временно можно узнать его через getUpdates в локальной инструкции [README_NODE_LEGACY.md](README_NODE_LEGACY.md) до подключения webhook. Либо установите webhook без TELEGRAM_OWNER_ID: отправитель /start, ещё не зарегистрированный в радаре, получит от бота свой Telegram ID. После этого владелец задаёт TELEGRAM_OWNER_ID в настройках Cloudflare. Никакие аккаунты автоматически владельцами не становятся.

## Приглашение подруги

Отправьте подруге обычную ссылку сайта или https://t.me/SNvintedradarbot. На сайте она выбирает «Зарегистрироваться / войти через Telegram», в боте нажимает Start. Бот создаёт отдельный аккаунт, подключает личные уведомления и предлагает Mini App либо одноразовую ссылку в браузер. Ссылку входа нельзя пересылать; она действует 5 минут. Пароль владельца не нужен. Приглашения владельца остаются дополнительным вариантом.

Отключение участника завершает его сессии, блокирует подпись Telegram и удаляет ожидающую очередь его уведомлений. Поиски сохраняются; при восстановлении доступа снова доступны. /stop останавливает только уведомления пользователя, не его поиски.

## Разрешённый источник данных

Облачная версия поддерживает разрешённый каталог до 100 товаров в D1. Это импорт, а не скрейпер. Установите `DATA_SOURCE=authorized-feed` и `AUTHORIZED_FEED_CONFIRMED=true` только при наличии реального разрешения. Владелец может отправить PUT `/api/admin/feed` с JSON `{ "permissionConfirmed": true, "items": [...] }`, cookie входа и заголовком `X-Radar-Client: 1`. Формат товаров — `authorized-feed.example.json`. Увеличение каталога потребует пересмотра бесплатных квот и лимитов.

## Приватность и ограничения

- Общий источник товаров, но личные поиски и избранное изолированы API по пользователю. Владелец сервера технически контролирует базу и инфраструктуру.
- Авторизация Telegram проверяет подпись и время initData (до часа). Если сессия истекла в открытой Mini App, закройте и откройте её заново.
- Старые демонаходки без избранного очищаются через 7 дней; избранное сохраняется. Отправленная очередь очищается через 7 дней. История реального источника автоматически не удаляется.
- При выключении уведомлений и последующем включении старые находки повторно не отправляются.
- Повтор сообщения возможен при аварии между подтверждением Telegram и фиксацией результата в D1. Доставка «ровно один раз» не гарантируется.
- Планировщик и отправка ограничены квотами, сетью и очередью; это не сервис мгновенных уведомлений с SLA.
- Используйте только Workers Free; платные сервисы и домен не нужны. Превышение бесплатных квот может временно остановить работу.
- Домен workers.dev, аккаунт Cloudflare и база принадлежат владельцу установки. Для портфолио исходники опубликованы открыто; секреты исключены.
- Приложение на Mac в папке `server/` — прежняя персональная Node.js/SQLite-версия. Она не поддерживает новые отдельные аккаунты. Для облачной версии используйте только `cloudflare/` и инструкции выше.

## Резервные копии

```bash
npx wrangler d1 export DB --remote --output=./backups/cloudflare.sql
```

Папка backups исключена из Git. Сохраняйте копии вне Cloudflare. Они содержат приватные данные, сессии и хеши приглашений. Для восстановления используйте новую базу и проверяйте импорт отдельно; не перезаписывайте рабочую базу без копии.

## Официальная документация

- [Cloudflare Workers Free](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 Free](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
- [Vinted Pro Integrations](https://pro-docs.svc.vinted.com/)


### Польский каталог и фотографии

Новые облачные поиски по умолчанию используют Польшу и PLN. Старые поиски остаются в EUR: автоматической конвертации нет. Можно задать минимальную и максимальную цену, бренд, размер и точное название состояния на языке каталога. Все слова запроса должны присутствовать в названии или бренде; размер M соответствует также M / 38. Отсутствующее поле не проходит заданный фильтр.

Для разрешённого источника каждое новое совпадение ставится в отдельную очередь Telegram: фото, цена, поля объявления и кнопка с исходной ссылкой. При недоступной фотографии Telegram получает текст со ссылкой. Повторно найденный товар не отправляется повторно в рамках того же поиска.

Apify не используется. `cloudflare/vinted.js` строит адрес поиска, разбирает карточки и использует общий кэш D1 на пять минут. `DATA_SOURCE=vinted-public` включает этот сборщик; `demo` сохраняет демонстрационный режим. Старый `authorized-feed` остаётся отдельным вариантом импорта. Публичный сборщик поддерживает только Польшу; старые EUR-поиски нужно отредактировать или поставить на паузу.

Проверяется одна страница (до 100 карточек), максимум три поиска за минутный запуск, минимальный интервал поиска — пять минут. Одинаковые страницы используются из кэша. Первый успешный проход и изменения фильтров создают начальную подборку без рассылки; последующие новые совпадения попадают в Telegram. Это не гарантия обнаружения всех объявлений: публикации могут вытеснить друг друга с первой страницы между проверками. Время находки означает время обнаружения, а не публикации.

При 401/403/429 или нераспознаваемом HTML запросы приостанавливаются минимум на час (дольше при указании Retry-After). Редиректы, CAPTCHA и проверки входа не обходятся. Сайт показывает паузу и ошибки поисков. После паузы планировщик может попробовать снова. Заголовки Set-Cookie не сохраняются и не отправляются.

Владелец может выполнить POST `/api/admin/catalog/check` с сессией и заголовком `X-Radar-Client: 1`: проверка COS до 100 PLN без создания поисков и уведомлений, не чаще раза в минуту, с общим кэшем и той же паузой. Ответ не содержит cookies Vinted.

`cloudflare/catalog-records.js` проверяет ID, ссылки, валюту и CDN фотографий. Тестовая HTML-карточка получена из публичной выдачи 24 октября 2026 года; формат может измениться.


### Connectivity diagnostics

Failure responses now retain only bounded, redacted error evidence and an allowlist of headers (never Set-Cookie or full HTML). The owner can read GET /api/admin/catalog/diagnostic without issuing another Vinted request. Retry-After numeric seconds and HTTP dates are parsed separately. The manual GitHub workflow Catalog connectivity diagnostic makes exactly one transparent public request, with no session, proxy, retries, import or monitoring schedule. Standard Linux runners in this public repository are used; no paid runner or artifact upload is configured.


### Free collection without an always-on Mac

`CATALOG_FETCH_MODE=github` makes Cloudflare read the shared catalog cache only. It never requests Vinted or falls back to another network in this mode. A separate standard Ubuntu GitHub Actions runner invokes the same transparent collector every 15 minutes (minutes 7, 22, 37, 52). A one-request diagnostic returned HTTP 200 with 96 parsed cards. No login, proxy, CAPTCHA solution or identity spoofing is used. Availability is not guaranteed; GitHub scheduled runs can be delayed or dropped, and public-repository schedules can be disabled after 60 days of inactivity. Standard runners are free in public repositories; no larger runners, artifacts or paid services are configured.

Up to three distinct active Polish catalog URLs are selected per run, oldest cache first. With more than three URLs the effective refresh interval increases. The dedicated CATALOG_COLLECTOR_TOKEN secret is stored only in Cloudflare and GitHub Actions. Its endpoints accept only fresh, validated records for currently active catalog URLs and cannot access owner sessions, invitations, Telegram credentials or account settings. The local .collector-secrets.json is ignored and must never be committed or shared.

Workflow: .github/workflows/collect-catalog.yml; collector: scripts/collect-catalog.js. The workflow is manual or scheduled, never triggered from untrusted pull requests. A distributed lease prevents overlapping imports. HTTP 401/403/429 or unrecognised markup causes a shared pause of at least one hour, respecting longer Retry-After values. No retries within a run and no automatic network switching occur. Existing Cloudflare cooldown is retained separately.

The first successful result fills the feed without sending old inventory to Telegram. Later new matches are queued separately with a photo and link. The existing Telegram test button uses a real photo from the signed-in user's matches when available, and reports whether Telegram actually returned a photo.

### Brand and size selection

Search forms use a searchable single-brand dialog and a multi-size sheet. Brand suggestions come from the signed-in user's loaded matches and saved searches; this is not the complete official Vinted brand taxonomy. Any other brand name can be entered explicitly. Comparison ignores case and normalizes whitespace but does not translate spelling or aliases.

Sizes are stored in the existing size field as comma-separated choices (up to 10). Any selected size may match; an empty selection means all sizes. Letter case is ignored. Composite listing labels such as M / 38 match M or 38; regional labels such as EU 38 and UK 10 are not automatically equated. Existing single-size searches remain valid. The picker offers letter sizes and exact labels in the user's listings; custom labels can be added.


## Native Vinted filters (Poland)

The search form includes a searchable snapshot of 2,920 category nodes, five conditions, 29 colors and a verified starter brand list. Labels preserve Polish Vinted names. This is a dated public catalog snapshot (2026-10-24), not a continuously synchronized complete brand registry.

Paste an ordinary Vinted.pl catalog search URL to preserve any supported brand and category-specific size IDs, colors, materials, query and budget. Canonicalization accepts only the public Polish catalog, rejects unknown parameters and external targets, strips page/time and preserves the supported sort order. Native searches rely on Vinted's filter semantics, without stale local brand/size/title post-filters. Changing category clears size IDs. Category-dependent size selection is verified for women’s jeans, outerwear and shoes (including their subcategories). Other categories use URL import; complete brand autocomplete is not yet implemented.

The collector checks the newest page plus up to four older pages per run, saves a durable continuation cursor, and resumes on the next run until an empty/repeated page (or safety ceiling of 10,000 pages). After completion it checks the first two pages for new listings. IDs are deduplicated. A failed scan does not advance the cursor. All finds, including the first scan, are persisted and queued for Telegram; unsent historical baseline records are also queued once. This cannot guarantee exhaustive Vinted coverage or zero missed listings. Additive migration `0004_native_filters.sql` preserves old searches; exported searches include the canonical URL.


Category browsing now shows one level at a time, with Russian labels for main sections, Polish source labels, back navigation and “select all in this group”. New searches explicitly choose URL import or manual keywords/filters. The published Vinted brand index and all 25 linked alphabetical pages were read on 2026-10-24, yielding 5,901 unique brand IDs/names. These are selectable and searchable; the initial 150 matches are rendered to keep the sheet responsive. The source manifest is in `web/src/catalog-brands-source.json`. This replaces the starter list; it does not claim complete coverage of Vinted’s internal brand database.


## Telegram registration

`PUBLIC_REGISTRATION=true` enables registration only through private `/start` messages accepted by the secret-validated Telegram webhook. Browser-submitted Telegram IDs cannot create accounts. New accounts are members, capped atomically at 10 total accounts including the owner, with 5 searches per user. Existing disabled accounts are not re-enabled by `/start`. Registration has a global hourly limit. `/start` binds notifications to that same Telegram chat and supplies a five-minute, one-use browser login plus a Mini App button. The user explicitly confirms browser login after seeing the account name. Set `PUBLIC_REGISTRATION=false` and deploy to return to invite-only onboarding.

Cloudflare serves the app, D1 persists per-user data, and GitHub Actions runs collection while the owner's laptop is off. Collector scheduling is approximate, searches are queued (up to three unique due catalogs per run), and no exact 15-minute per-search delivery SLA is implied.


## Progressive inventory scan and delivery

Migration 0005 adds durable catalog progress and a per-match notification marker. Schedule is now every five minutes (GitHub may delay), up to three unique searches per run. A scan imports at most 500 items after all requested pages succeed; older records remain in `matches` and can be paginated via authenticated `/api/items`. The new UI supports loading earlier finds beyond the initial 500. Incremental runs can revisit moving inventory; ID deduplication prevents duplicate notifications. Delivery handles up to five queued cards total per invocation with fair per-chat ordering and 1.1-second spacing within a chat; Telegram 429 pauses that chat for the invocation and applies retry backoff. Delivery is asynchronous, not simultaneous with page rendering. Existing first-pass finds not previously queued are backfilled in batches of 100 per checked search; `notified` prevents repeats after outbox retention cleanup. No Vinted protection bypass or login was added.


## Notification priority and listing age

Migration 0006 adds queue priority and scan order. Catalog imports now retain `catalogPage` provenance (first occurrence wins across duplicate/promoted cards). Newly discovered first-page results of an established search receive priority 2; first-page baseline results priority 1; deeper inventory/history priority 0. Delivery ranks this priority before FIFO within each chat and retains fair chat ordering. Telegram captions say “Найдено в начале выдачи” or “Подборка по вашему поиску”; neither means a verified publication timestamp. Existing pending messages with unknown origin are labelled as selections at priority 0; they are not deleted. No publication-age filter is claimed. Public item page timestamps can be old even for a card near the top of a filtered/promoted catalog.


Search ordering: the form offers “Самые новые” (`order=newest_first`) and “Рекомендованные Vinted” (`order=relevance`). Both values are verified against the public Polish Vinted sorting UI (“Od najnowszych” and “Trafność”). Relevance is not represented as a verified popularity/most-liked ranking. Imported URLs preserve an explicit supported order; UI import with no order uses Vinted's relevance default, while new manually configured searches default to newest-first. Changing a search URL demotes pending prior-search messages to background priority without deleting them. The canonical URL (including order) keys the catalog cache and saved scan cursor.
