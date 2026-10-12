# Как выложить бота и начать пользоваться

Нужны три вещи: бот в Telegram, ваш числовой id и сервер с HTTPS.
После выкладки откройте `FIRST-HOUR.md` — настройка визитки, тарифов и первого заказа.

## Быстрый путь (Ubuntu VPS)

На своём компьютере:

```bash
scp cargo-dispatch-bot.zip root@IP_СЕРВЕРА:/tmp/
```

На сервере:

```bash
apt update && apt install -y unzip
mkdir -p /var/www/cargo
unzip /tmp/cargo-dispatch-bot.zip -d /var/www/cargo
cd /var/www/cargo
nano .env.example   # просто посмотреть, какие поля будут
cp .env.example .env
nano .env           # вписать BOT_TOKEN, OWNER_TELEGRAM_ID, WEBHOOK_SECRET, BOT_USERNAME
bash deploy/install.sh bot.вашафирма.ru
```

Скрипт поставит Node, nginx, HTTPS, systemd и webhook. Дальше — `FIRST-HOUR.md`.

Ниже те же шаги вручную, если скрипт не хотите.

---

## 1. Telegram: бот и ваш id

1. Откройте [@BotFather](https://t.me/BotFather) → `/newbot` → имя и username (например `sever_kuzov_bot`).
2. Скопируйте **токен** вида `123456:AAH...`.
3. В BotFather: `/setprivacy` → Disable (чтобы бот видел текст в группах, если понадобится). `/setjoingroups` можно оставить как есть.
4. Напишите боту `/start` — пока он не ответит, это нормально.
5. Узнайте свой id: напишите [@userinfobot](https://t.me/userinfobot) или [@getmyid_bot](https://t.me/getmyid_bot). Это число, например `159123456`. Это **владелец**: только он правит визитку и тарифы.

ИИ-помощник необязателен. Без `OPENAI_API_KEY` расчёт и заявки работают, помощник отвечает короткими правилами.

---

## 2. Сервер

Подойдёт любой VPS с Ubuntu 22.04/24.04 и публичным IP: Timeweb, Selectel, Hetzner, REG.RU.
Минимум: 1 vCPU, 1 ГБ RAM, 10 ГБ диска.

Привяжите домен к IP (A-запись), например `bot.example.ru`. Telegram **не принимает** вебхук по голому HTTP — нужен HTTPS.

Подключитесь:

```bash
ssh root@IP_СЕРВЕРА
```

Пакеты:

```bash
apt update
apt install -y nginx certbot python3-certbot-nginx unzip curl build-essential python3 make g++
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v   # должно быть v20.x
```

Пользователь под бота:

```bash
adduser --disabled-password --gecos "" cargo
mkdir -p /var/www/cargo
chown cargo:cargo /var/www/cargo
```

---

## 3. Загрузить проект

С своего компьютера (где лежит `cargo-dispatch-bot.zip`):

```bash
scp cargo-dispatch-bot.zip root@IP_СЕРВЕРА:/tmp/
```

На сервере:

```bash
sudo -u cargo unzip /tmp/cargo-dispatch-bot.zip -d /var/www/cargo
cd /var/www/cargo
sudo -u cargo npm install
sudo -u cargo cp .env.example .env
sudo -u cargo nano .env
```

Заполните `.env` (подставьте свои значения):

```
BOT_TOKEN=123456:AAH....
BOT_USERNAME=sever_kuzov_bot
OWNER_TELEGRAM_ID=159123456
WEBHOOK_SECRET=придумайте-длинную-случайную-строку
PUBLIC_URL=https://bot.example.ru
PORT=8787
DATABASE_PATH=./data/cargo.db
OPENAI_API_KEY=
CHANNEL_ID=
```

`WEBHOOK_SECRET` — любая длинная строка, не из примера. `PUBLIC_URL` нужен только чтобы поставить webhook.

Проверка, что процесс стартует:

```bash
sudo -u cargo npm start
```

В другом окне: `curl http://127.0.0.1:8787/health` → `{"ok":true,...}`. Остановите Ctrl+C.

---

## 4. Автозапуск (systemd)

```bash
cat >/etc/systemd/system/cargo-bot.service <<'EOF'
[Unit]
Description=Cargo dispatch bot
After=network.target

[Service]
Type=simple
User=cargo
WorkingDirectory=/var/www/cargo
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now cargo-bot
systemctl status cargo-bot --no-pager
```

Логи: `journalctl -u cargo-bot -f`

---

## 5. HTTPS (nginx + Let's Encrypt)

```bash
cat >/etc/nginx/sites-available/cargo-bot <<'EOF'
server {
    listen 80;
    server_name bot.example.ru;

    client_max_body_size 8m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# замените bot.example.ru на ваш домен в файле выше
sed -i 's/bot.example.ru/ВАШ_ДОМЕН/' /etc/nginx/sites-available/cargo-bot

ln -sf /etc/nginx/sites-available/cargo-bot /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d ВАШ_ДОМЕН
```

Проверьте: `curl -sS https://ВАШ_ДОМЕН/health` → `{"ok":true,...}`.
Сайта нет: домен нужен только Telegram для вебхука.

---

## 6. Включить вебхук Telegram

Подставьте токен, домен и секрет из `.env`:

```bash
curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -d "url=https://ВАШ_ДОМЕН/webhook" \
  -d "secret_token=${WEBHOOK_SECRET}"
```

Должно ответить `"ok":true`. Проверка:

```bash
curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"
```

В `url` — ваш домен, `pending_update_count` скоро станет 0.

---

## 7. Первый запуск в Telegram

Откройте бота **со своего аккаунта** (тот самый `OWNER_TELEGRAM_ID`):

1. `/start` — должны быть кнопки «Заявки», «Управление», «Статистика».
2. **Управление → Визитка** — название, телефон, Telegram, зона, базовый адрес (от него считается подача).
3. **Управление → Тарифы** — подача, ₽/км, минимум, грузчики, этаж, ожидание.
4. **Управление → Фото авто** — пришлите снимок кузова.
5. **Визитка** — проверьте, как это видит клиент.
6. **Рассчитать стоимость** — два адреса в Москве, убедитесь, что смета считается.

Клиенту даёте ссылку `https://t.me/ВАШ_BOT_USERNAME`. Он жмёт «Рассчитать» → оставляет заявку. Вам приходит карточка: Принять / Предоплата / Выполнено.

---

## Обновление кода

```bash
scp cargo-dispatch-bot.zip root@IP:/tmp/
sudo -u cargo unzip -o /tmp/cargo-dispatch-bot.zip -d /var/www/cargo
cd /var/www/cargo && sudo -u cargo npm install
systemctl restart cargo-bot
```

База `data/cargo.db` при unzip не затирается, если в архиве её нет (так и задумано). `.env` тоже не из архива — не перезапишется, пока вы сами не скопируете.

Бэкап раз в день:

```bash
cp /var/www/cargo/data/cargo.db /root/backup-cargo-$(date +%F).db
```

---

## Если нет VPS: Cloudflare Workers

Это ближе к исходному воркеру, но нужна учётка Cloudflare и `npx wrangler`.

```bash
npm install
npx wrangler login
npx wrangler d1 create cargo-bot
# скопируйте database_id в wrangler.toml
npx wrangler d1 execute cargo-bot --remote --file=schema.sql

npx wrangler secret put BOT_TOKEN
npx wrangler secret put OWNER_TELEGRAM_ID
npx wrangler secret put WEBHOOK_SECRET

# в wrangler.toml раскомментируйте [vars]:
# BOT_USERNAME = "your_bot"

npx wrangler deploy
```

Тот же `setWebhook` на `https://....workers.dev/webhook`. Сайта и картинок нет — только бот.

Локальный `data/cargo.db` на Workers не используется — там D1.

---

## Частые сбои

| Симптом | Что проверить |
|---|---|
| Бот молчит | `getWebhookInfo`, `journalctl -u cargo-bot`, совпадает ли `WEBHOOK_SECRET` с `secret_token` |
| 403 на вебхуке | заголовок `X-Telegram-Bot-Api-Secret-Token` ≠ `WEBHOOK_SECRET` |
| «только владелец» на своих кнопках | `OWNER_TELEGRAM_ID` — это **id**, не username |
| Расчёт падает в ручной ввод км | Nominatim/OSRM недоступны с сервера; подождите или введите км руками |
| Не ставится `better-sqlite3` | не установлены `build-essential python3 make g++` |
| Certbot не выпускает сертификат | A-запись домена уже указывает на этот IP, порт 80 открыт |

Готово, когда: сайт открывается по HTTPS, `/start` отвечает в Telegram, расчёт даёт сумму, заявка приходит вам.
