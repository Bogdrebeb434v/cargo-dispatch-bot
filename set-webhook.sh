#!/usr/bin/env bash
# Ставит Telegram webhook из .env
# Запуск из корня проекта:  bash deploy/set-webhook.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Нет файла .env. Скопируйте .env.example и заполните."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [[ -z "${BOT_TOKEN:-}" || -z "${PUBLIC_URL:-}" || -z "${WEBHOOK_SECRET:-}" ]]; then
  echo "В .env должны быть BOT_TOKEN, PUBLIC_URL и WEBHOOK_SECRET"
  exit 1
fi

URL="${PUBLIC_URL%/}/webhook"
echo "Ставлю webhook → $URL"

curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=${URL}" \
  --data-urlencode "secret_token=${WEBHOOK_SECRET}" \
  --data-urlencode "drop_pending_updates=false"
echo
echo "Проверка:"
curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"
echo
