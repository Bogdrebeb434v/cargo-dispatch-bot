# Cargo Dispatch Bot

Telegram-бот диспетчера грузоперевозок. Сайта нет: визитка, расчёт, заявки, тарифы и кабинет владельца — только в чате.

Считает подачу и пробег по карте, надбавки (грузчики, этаж, ожидание, ночь, срочность, несколько точек, туда-обратно), принимает заявки со слотом, шлёт их владельцу, ведёт статусы и отзывы.

HTTP нужен лишь как вход для Telegram: `POST /webhook` и `GET /health`.

## Что умеет

- **Клиент:** визитка (короткая/полная, фото авто), расчёт по адресам или геоточке, мастер условий, заявка с телефоном и окном подачи, «мои заявки», отзыв после выполнения, пересылка визитки, ИИ-помощник.
- **Владелец:** отдельные кнопки, заявки (принять / предоплата / выполнено / отклонить / ЧС), статистика, тарифы, слоты, режим «не принимаю», уведомления о расчётах, пост в канал, CSV-файл в чат.

Формула цены:

```
max(minimum,
  (base_fee + emptyKm × per_km_empty
   + max(0, loadedKm − included) × per_km_loaded
   + надбавки) × коэффициенты)
```

Округление вверх с шагом `round_step` (по умолчанию 50 ₽).

## Запуск на сервере

Смотрите `DEPLOY.md`. Кратко: Ubuntu VPS + HTTPS, затем:

```bash
unzip cargo-dispatch-bot.zip -d /var/www/cargo
cd /var/www/cargo
cp .env.example .env
nano .env          # BOT_TOKEN, OWNER_TELEGRAM_ID, WEBHOOK_SECRET, BOT_USERNAME
bash deploy/install.sh bot.вашафирма.ru
```

Локально (без ответа в Telegram, пока нет токена и вебхука):

```bash
cp .env.example .env
npm install
npm test
npm start
```

`PUBLIC_URL` в `.env` нужен только скрипту `deploy/set-webhook.sh`, чтобы вызвать `setWebhook`.

## Команды

Клиент: `/start` `/card` `/calc` `/assistant` `/orders` `/reviews` `/share` `/cancel`

Владелец плюс: `/admin` `/leads` `/stats` `/tariffs` `/edit` `/export` `/ban ID` `/unban ID`

После сметы: оставить заявку → контакт → комментарий → слот.

## Переменные

| Имя | Зачем |
|---|---|
| `BOT_TOKEN` | Telegram |
| `OWNER_TELEGRAM_ID` | кто видит админ-кнопки |
| `WEBHOOK_SECRET` | проверка вебхука |
| `PUBLIC_URL` | HTTPS-адрес для `setWebhook` |
| `BOT_USERNAME` | ссылка в постах канала |
| `OPENAI_API_KEY` | ИИ-помощник (необязательно) |
| `CHANNEL_ID` | пост «свободное окно» |
| `DATABASE_PATH` | SQLite локально |
