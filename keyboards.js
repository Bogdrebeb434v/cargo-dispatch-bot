export function clientKeyboard() {
  return {
    keyboard: [
      [{ text: "🚚 Визитка" }, { text: "🧮 Рассчитать стоимость" }],
      [{ text: "🤖 ИИ-помощник" }, { text: "📝 Мои заявки" }],
      [{ text: "⭐ Отзывы" }, { text: "📤 Поделиться" }]
    ],
    resize_keyboard: true
  };
}

export function ownerKeyboard() {
  return {
    keyboard: [
      [{ text: "🚚 Визитка" }, { text: "🧮 Рассчитать стоимость" }],
      [{ text: "📋 Заявки" }, { text: "📊 Статистика" }],
      [{ text: "⚙️ Управление" }, { text: "🤖 ИИ-помощник" }],
      [{ text: "📝 Мои заявки" }, { text: "⭐ Отзывы" }]
    ],
    resize_keyboard: true
  };
}

export function keyboardFor(env, userId) {
  return String(userId) === String(env.OWNER_TELEGRAM_ID || "") ? ownerKeyboard() : clientKeyboard();
}

export function cancelKb(extraRows = []) {
  return {
    keyboard: [...extraRows, [{ text: "❌ Отмена" }]],
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

export function addressKeyboard(recent = []) {
  const rows = [[{ text: "📍 Отправить геолокацию", request_location: true }]];
  for (const addr of recent.slice(0, 5)) {
    rows.push([{ text: addr.slice(0, 64) }]);
  }
  rows.push([{ text: "❌ Отмена" }]);
  return { keyboard: rows, resize_keyboard: true };
}

export function contactKeyboard() {
  return {
    keyboard: [
      [{ text: "📱 Отправить телефон", request_contact: true }],
      [{ text: "❌ Отмена" }]
    ],
    resize_keyboard: true
  };
}

export function adminInline(p) {
  const acc = p.accepting_orders ? "🟢 Приём заявок: вкл" : "🔴 Приём заявок: выкл";
  return {
    inline_keyboard: [
      [{ text: "✏️ Визитка", callback_data: "admin:edit" }, { text: "⚙️ Тарифы", callback_data: "admin:tariffs" }],
      [{ text: "🚚 Автопарк", callback_data: "admin:vehicles" }, { text: "📅 Слоты", callback_data: "admin:slots" }],
      [{ text: "📷 Фото авто", callback_data: "admin:photo" }, { text: "⛔ Чёрный список", callback_data: "admin:bl" }],
      [{ text: acc, callback_data: "admin:toggle" }],
      [{ text: "📣 Свободное окно", callback_data: "admin:channel" }, { text: "📤 CSV", callback_data: "admin:export" }],
      [{ text: "🔔 Уведомления о расчётах: " + (p.notify_quotes ? "да" : "нет"), callback_data: "admin:notify" }]
    ]
  };
}

export function extrasKeyboard(state) {
  const e = state.extras || {};
  const mark = (cond, text) => (cond ? "✓ " : "") + text;
  return {
    inline_keyboard: [
      [
        { text: mark(e.loaders === 0, "Без грузчиков"), callback_data: "x:ld:0" },
        { text: mark(e.loaders === 1, "1 грузчик"), callback_data: "x:ld:1" },
        { text: mark(e.loaders === 2, "2 грузчика"), callback_data: "x:ld:2" }
      ],
      [
        { text: "Этаж 1", callback_data: "x:fl:1" },
        { text: "2", callback_data: "x:fl:2" },
        { text: "3", callback_data: "x:fl:3" },
        { text: "4", callback_data: "x:fl:4" },
        { text: "5+", callback_data: "x:fl:5" }
      ],
      [
        { text: mark(e.elevator, "Лифт есть"), callback_data: "x:el:1" },
        { text: mark(!e.elevator, "Без лифта"), callback_data: "x:el:0" }
      ],
      [
        { text: mark(e.waitHours === 0, "Без ожидания"), callback_data: "x:wt:0" },
        { text: mark(e.waitHours === 1, "1 ч"), callback_data: "x:wt:1" },
        { text: mark(e.waitHours === 2, "2 ч"), callback_data: "x:wt:2" }
      ],
      [
        { text: mark(e.when === "today", "Сегодня"), callback_data: "x:wh:today" },
        { text: mark(e.when === "tomorrow", "Завтра"), callback_data: "x:wh:tomorrow" },
        { text: mark(e.when === "later", "Другой день"), callback_data: "x:wh:later" }
      ],
      [
        { text: "📦 Коробки", callback_data: "x:cg:boxes" },
        { text: "🪑 Мебель", callback_data: "x:cg:furniture" },
        { text: "📺 Техника", callback_data: "x:cg:appliances" }
      ],
      [
        { text: "🧱 Стройка", callback_data: "x:cg:construction" },
        { text: "🎹 Пианино", callback_data: "x:cg:piano" },
        { text: "🔐 Сейф", callback_data: "x:cg:safe" }
      ],
      [
        { text: mark(e.roundTrip, "Туда-обратно"), callback_data: "x:rt" },
        { text: mark(e.urgent, "Срочно"), callback_data: "x:ug" }
      ],
      [{ text: "➕ Добавить адрес по пути", callback_data: "x:st" }],
      [{ text: "🧮 Рассчитать", callback_data: "x:go" }]
    ]
  };
}

export function quoteActions(quoteId, canBook) {
  const rows = [];
  if (canBook) rows.push([{ text: "📝 Оставить заявку", callback_data: `q:${quoteId}:book` }]);
  rows.push([
    { text: "🔄 Другие адреса", callback_data: "q:redo" },
    { text: "♻️ Повторить", callback_data: "q:again" }
  ]);
  return { inline_keyboard: rows };
}

export function leadOwnerKb(id) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Принять", callback_data: `l:${id}:ok` },
        { text: "💳 Предоплата", callback_data: `l:${id}:pay` }
      ],
      [
        { text: "✅ Выполнено", callback_data: `l:${id}:done` },
        { text: "✖️ Отклонить", callback_data: `l:${id}:no` }
      ],
      [
        { text: "📄 Карточка", callback_data: `l:${id}:info` },
        { text: "⛔ В ЧС", callback_data: `l:${id}:bl` }
      ]
    ]
  };
}

export function reviewKb(quoteId) {
  return {
    inline_keyboard: [[
      { text: "1", callback_data: `rev:${quoteId}:1` },
      { text: "2", callback_data: `rev:${quoteId}:2` },
      { text: "3", callback_data: `rev:${quoteId}:3` },
      { text: "4", callback_data: `rev:${quoteId}:4` },
      { text: "5", callback_data: `rev:${quoteId}:5` }
    ]]
  };
}

export function statusFilterKb() {
  return {
    inline_keyboard: [
      [
        { text: "Новые", callback_data: "leads:new" },
        { text: "Подтверждённые", callback_data: "leads:confirmed" },
        { text: "Оплата", callback_data: "leads:awaiting_payment" }
      ],
      [
        { text: "Выполненные", callback_data: "leads:done" },
        { text: "Отменённые", callback_data: "leads:cancelled" },
        { text: "Все", callback_data: "leads:all" }
      ]
    ]
  };
}
