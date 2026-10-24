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
