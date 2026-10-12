#!/usr/bin/env bash
# Ubuntu 22.04/24.04, запускать от root из папки проекта:
#   unzip cargo-dispatch-bot.zip -d /var/www/cargo
#   cd /var/www/cargo
#   bash deploy/install.sh bot.вашафирма.ru
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Запустите от root: sudo bash deploy/install.sh ваш.домен.ru"
  exit 1
fi

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Использование: bash deploy/install.sh bot.example.ru"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP=/var/www/cargo

echo "==> пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx unzip curl rsync \
  build-essential python3 make g++ ca-certificates

if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE 'v2[0-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "Node: $(node -v)"

echo "==> пользователь cargo"
if ! id cargo >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" cargo
fi

echo "==> проект в $APP"
mkdir -p "$APP"
if [[ "$ROOT" != "$APP" ]]; then
  rsync -a --delete --exclude node_modules --exclude data --exclude .env "$ROOT"/ "$APP"/
fi
mkdir -p "$APP/data"
chown -R cargo:cargo "$APP"

if [[ ! -f "$APP/.env" ]]; then
  sudo -u cargo cp "$APP/.env.example" "$APP/.env"
  sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=https://${DOMAIN}|" "$APP/.env"
  echo
  echo "Откройте и заполните токен/id:"
  echo "  nano $APP/.env"
  echo "Нужны BOT_TOKEN, OWNER_TELEGRAM_ID, WEBHOOK_SECRET, BOT_USERNAME."
  echo "Потом снова: bash deploy/install.sh $DOMAIN"
  exit 0
fi

if grep -q '^BOT_TOKEN=$' "$APP/.env" || grep -q '^OWNER_TELEGRAM_ID=$' "$APP/.env"; then
  echo "В $APP/.env пустые BOT_TOKEN или OWNER_TELEGRAM_ID. Заполните и повторите скрипт."
  exit 1
fi

# домен в PUBLIC_URL
if grep -q '^PUBLIC_URL=' "$APP/.env"; then
  sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=https://${DOMAIN}|" "$APP/.env"
else
  echo "PUBLIC_URL=https://${DOMAIN}" >> "$APP/.env"
fi

echo "==> npm install"
sudo -u cargo bash -lc "cd '$APP' && npm install --omit=dev"

echo "==> systemd"
sed "s|/var/www/cargo|$APP|g" "$APP/deploy/cargo-bot.service" >/etc/systemd/system/cargo-bot.service
systemctl daemon-reload
systemctl enable cargo-bot
systemctl restart cargo-bot
sleep 1
systemctl --no-pager --full status cargo-bot || true

echo "==> nginx"
sed "s/bot.example.ru/${DOMAIN}/g" "$APP/deploy/nginx.conf" >/etc/nginx/sites-available/cargo-bot
ln -sf /etc/nginx/sites-available/cargo-bot /etc/nginx/sites-enabled/cargo-bot
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> сертификат Let's Encrypt"
if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
  echo "HTTPS готов"
else
  echo "Certbot не выпустил сертификат. Проверьте A-запись домена на этот IP и порт 80."
  echo "Потом вручную: certbot --nginx -d $DOMAIN"
fi

echo "==> webhook"
if sudo -u cargo bash "$APP/deploy/set-webhook.sh"; then
  echo "Webhook поставлен"
else
  echo "Webhook не поставился — запустите позже: bash $APP/deploy/set-webhook.sh"
fi

echo
echo "Готово. Веб-сайта нет — всё в Telegram."
echo "  health  https://${DOMAIN}/health"
echo "  webhook https://${DOMAIN}/webhook"
echo "  логи    journalctl -u cargo-bot -f"
echo "Напишите боту /start со своего Telegram."
