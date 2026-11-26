'use strict';

const $ = s => document.querySelector(s);
const main = $('#main');
const modal = $('#modal');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
const today = () => {
  const d = new Date();
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const CATEGORY_ICON_CHOICES = ['🍔','🛒','🚕','🚇','☕','🎓','🎬','💊','🏠','🎁','👕','💻','📚','🏋️','✈️','🐈','🧾','💡','📦','🧩'];
const defaultCategories = () => ([
  ['Продукты', '🛒'],
  ['Транспорт', '🚕'],
  ['Кафе', '☕'],
  ['Учёба', '🎓'],
  ['Развлечения', '🎬'],
  ['Другое', '🧩']
].map(([name, icon]) => ({ id: uid(), name, icon, enabled: true })));

const initial = () => ({
  version: 2,
  currency: 'RUB',
  categories: defaultCategories(),
  transactions: []
});

let db, state, tab = 'home', period = 'month', busy = false;

const money = n => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: state.currency, maximumFractionDigits: 2 }).format(n / 100);
const cents = v => Math.round(Number(String(v).replace(',', '.')) * 100);
const valid = n => Number.isSafeInteger(n) && n > 0 && n <= 1e14;
const datefmt = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('ru-RU') : 'Без срока';

function migrate(input) {
  const base = input && typeof input === 'object' ? structuredClone(input) : initial();
  if (!Array.isArray(base.categories)) base.categories = defaultCategories();
  if (!Array.isArray(base.transactions)) base.transactions = [];
  if (!base.currency) base.currency = 'RUB';

  base.categories = base.categories.map((c, i) => ({
    id: typeof c.id === 'string' && c.id ? c.id : uid(),
    name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : `Категория ${i + 1}`,
    icon: typeof c.icon === 'string' && c.icon.trim() ? c.icon.trim() : (c.name === 'Другое' ? '🧩' : CATEGORY_ICON_CHOICES[i % CATEGORY_ICON_CHOICES.length]),
    enabled: typeof c.enabled === 'boolean' ? c.enabled : true
  }));

  base.transactions = base.transactions.map(t => ({
    id: typeof t.id === 'string' && t.id ? t.id : uid(),
    created: Number.isFinite(t.created) ? t.created : Date.now(),
    type: t.type,
    amount: t.amount,
    date: t.date,
    category: typeof t.category === 'string' ? t.category : '',
    person: typeof t.person === 'string' ? t.person : '',
    due: typeof t.due === 'string' ? t.due : '',
    direction: typeof t.direction === 'string' ? t.direction : '',
    note: typeof t.note === 'string' ? t.note : '',
    adjustments: Array.isArray(t.adjustments) ? t.adjustments.map(a => ({
      id: typeof a.id === 'string' && a.id ? a.id : uid(),
      amount: a.amount,
      date: a.date
    })) : []
  }));

  base.version = 2;
  return base;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('my-finance', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('data');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function read() {
  return new Promise((resolve, reject) => {
    const r = db.transaction('data').objectStore('data').get('state');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function write(data) {
  return new Promise((resolve, reject) => {
    const t = db.transaction('data', 'readwrite');
    t.objectStore('data').put(data, 'state');
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function change(fn) {
  if (busy) return false;
  busy = true;
  try {
    const next = structuredClone(state);
    fn(next);
    next.version = 2;
    await write(next);
    state = next;
    render();
    return true;
  } catch (e) {
    alert('Не удалось сохранить: ' + e.message);
    return false;
  } finally {
    busy = false;
  }
}

const catObj = t => state.categories.find(c => c.id === t.category);
const catName = t => catObj(t)?.name || 'Без категории';
const catIcon = t => catObj(t)?.icon || '📁';
const catDisplay = t => `${catIcon(t)} ${catName(t)}`;
const rep = t => (t.adjustments || []).reduce((s, a) => s + a.amount, 0);
const remain = t => t.amount - rep(t);
const types = { expense: 'Расход', debt: 'Долг', income: 'Доход' };
const tabs = [['home', '⌂', 'Главная'], ['stats', '◔', 'Статистика'], ['debts', '♙', 'Долги'], ['settings', '⚙', 'Настройки']];

function expenseTitle(t) {
  return t.note ? `${catDisplay(t)} — ${t.note}` : catDisplay(t);
}

function item(t) {
  const label = t.type === 'expense' ? expenseTitle(t) : (t.person || types[t.type]);
  const sub = datefmt(t.date) + (
    t.type === 'debt'
      ? ' · ' + (remain(t) === 0 ? 'Закрыт' : t.direction === 'given' ? 'Мне должны' : 'Я должен') + (t.due && remain(t) > 0 ? ' · до ' + datefmt(t.due) : '')
      : t.type === 'expense' && rep(t)
        ? ' · ' + (remain(t) === 0 ? 'Скомпенсировано' : 'Частично возмещено')
        : ''
  );
  const sign = t.type === 'expense' || (t.type === 'debt' && t.direction === 'given') ? '−' : '+';
  return `<button class="item" data-detail="${esc(t.id)}"><span class="wrap"><strong>${esc(label)}</strong><small>${esc(sub)}</small></span><strong class="${sign === '+' ? 'positive' : ''}">${sign}${money(t.type === 'income' ? t.amount : remain(t))}</strong></button>`;
}

function inPeriod(d) {
  const now = today();
  if (period === 'all') return true;
  if (period === 'month') return d.slice(0, 7) === now.slice(0, 7);
  if (period === 'year') return d.slice(0, 4) === now.slice(0, 4);
  if (period === 'day') return d === now;
  const start = new Date(now + 'T12:00:00');
  start.setDate(start.getDate() - 6);
  const s = start.getFullYear() + '-' + String(start.getMonth() + 1).padStart(2, '0') + '-' + String(start.getDate()).padStart(2, '0');
  return d >= s && d <= now;
}

function totals(filter) {
  let exp = 0, comp = 0, inc = 0;
  for (const t of state.transactions) {
    if (t.type === 'expense') {
      if (filter(t.date)) exp += t.amount;
      for (const a of t.adjustments || []) if (filter(a.date)) comp += a.amount;
    } else if (t.type === 'income' && filter(t.date)) {
      inc += t.amount;
    }
  }
  return { exp, comp, inc };
}

function categoryOption(c, selected) {
  return `<option value="${esc(c.id)}" ${selected ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`;
}

function render() {
  const ts = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
  const debts = ts.filter(t => t.type === 'debt');
  const sum = dir => debts.filter(t => t.direction === dir).reduce((s, t) => s + remain(t), 0);
  $('#nav').innerHTML = tabs.map(([id, i, n]) => `<button data-tab="${id}" class="${tab === id ? 'active' : ''}"><span>${i}</span>${n}</button>`).join('');

  if (tab === 'home') {
    const { exp, comp, inc } = totals(d => d.slice(0, 7) === today().slice(0, 7));
    main.innerHTML = `<h1>Финансы</h1><div class="card hero"><div class="muted">Чистые расходы за месяц</div><div class="total">${money(exp - comp)}</div><div class="positive">Доходы: ${money(inc)}</div></div><div class="grid"><div class="card"><small>Мне должны</small><h3>${money(sum('given'))}</h3></div><div class="card"><small>Я должен</small><h3>${money(sum('taken'))}</h3></div></div><button class="plus" data-add aria-label="Добавить операцию">+</button><h2>Последние операции</h2><div class="card">${ts.map(item).join('') || '<div class="empty">Пока нет операций</div>'}</div>`;
  }

  if (tab === 'debts') {
    main.innerHTML = `<div class="row"><h1>Долги</h1><button data-add="debt">+ Добавить</button></div>` +
      ['given', 'taken'].map(d => `<h2>${d === 'given' ? 'Мне должны' : 'Я должен'} · ${money(sum(d))}</h2><div class="card">${debts.filter(t => t.direction === d && remain(t) > 0).map(t => item(t) + (t.due && t.due < today() ? '<small class="negative">Срок истёк</small>' : '')).join('') || '<div class="empty">Нет открытых долгов</div>'}</div>`).join('') +
      `<h2>Закрытые</h2><div class="card">${debts.filter(t => !remain(t)).map(item).join('') || '<div class="empty">Нет закрытых долгов</div>'}</div>`;
  }

  if (tab === 'stats') {
    const { exp, comp, inc } = totals(inPeriod);
    const by = Object.create(null);
    for (const t of ts.filter(t => t.type === 'expense' && inPeriod(t.date))) {
      const key = catDisplay(t);
      by[key] = (by[key] || 0) + t.amount;
    }
    main.innerHTML = `<h1>Статистика</h1><select id="period">${[['day', 'Сегодня'], ['week', 'Последние 7 дней'], ['month', 'Этот месяц'], ['year', 'Этот год'], ['all', 'Всё время']].map(([v, n]) => `<option value="${v}" ${period === v ? 'selected' : ''}>${n}</option>`).join('')}</select><div class="card"><small>Чистые расходы</small><div class="total">${money(exp - comp)}</div><p>Потрачено: ${money(exp)}</p><p class="positive">Возмещено: ${money(comp)}</p><p>Доходы: ${money(inc)}</p></div><h2>Расходы по категориям до компенсаций</h2><div class="card">${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([n, v]) => `<div class="row"><span>${esc(n)}</span><strong>${money(v)}</strong></div><div class="bar"><i style="width:${exp ? v / exp * 100 : 0}%"></i></div>`).join('') || '<div class="empty">Нет расходов</div>'}</div><p class="notice">Компенсации учитываются по дате фактического возврата. Долги не входят в доходы и расходы.</p>`;
  }

  if (tab === 'settings') {
    main.innerHTML = `<h1>Настройки</h1><h2>Категории расходов</h2><div class="card">${state.categories.map(c => `<div class="row" style="margin:8px 0"><button data-rename="${esc(c.id)}" style="text-align:left;flex:1;color:var(--text)">${esc(c.icon)} ${esc(c.name)} ✎</button><input aria-label="Показывать ${esc(c.name)}" type="checkbox" data-cat="${esc(c.id)}" ${c.enabled ? 'checked' : ''}></div>`).join('')}<button data-newcat>+ Создать категорию</button><p class="notice">Можешь задать свою иконку для каждой категории. Скрытые категории сохраняются в истории.</p></div><h2>Валюта</h2><div class="card"><select id="currency">${['RUB', 'USD', 'EUR', 'MDL', 'EGP', 'KZT', 'BYN', 'UAH'].map(c => `<option ${c === state.currency ? 'selected' : ''}>${c}</option>`).join('')}</select><p class="notice">Меняет обозначение валюты, не конвертирует суммы.</p></div><h2>Резервные копии</h2><div class="card"><button data-export>Экспорт JSON</button><button data-csv>Экспорт CSV</button><button data-import>Импорт JSON</button><input type="file" id="importfile" accept=".json,application/json" hidden><p class="notice">Данные хранятся на этом устройстве. Регулярно сохраняй резервную копию в «Файлы».</p></div>`;
  }
}

function show(html) {
  modal.innerHTML = html;
  if (!modal.open) modal.showModal();
}

function form(t = null, start = 'expense') {
  let type = t?.type || start;
  const draft = {
    amount: t ? (t.amount / 100).toString() : '',
    date: t?.date || today(),
    category: t?.category || '',
    person: t?.person || '',
    due: t?.due || '',
    direction: t?.direction || 'given',
    note: t?.note || ''
  };

  function capture() {
    for (const k of Object.keys(draft)) {
      const e = modal.querySelector('[name="' + k + '"]');
      if (e) draft[k] = e.value;
    }
  }

  function draw() {
    const cats = state.categories.filter(c => c.enabled || c.id === draft.category);
    show(`<div class="row"><h2>${t ? 'Редактировать' : 'Новая операция'}</h2><button data-close>✕</button></div><div class="segments" id="types">${Object.entries(types).map(([k, n]) => `<button type="button" data-type="${k}" ${t && k !== type ? 'disabled' : ''} class="${k === type ? 'active' : ''}">${n}</button>`).join('')}</div><form id="entry"><label>Сумма</label><input class="amount" name="amount" inputmode="decimal" placeholder="0" value="${esc(draft.amount)}" required><label>Дата</label><input type="date" name="date" value="${esc(draft.date)}" required>${type === 'expense' ? `<label>Категория</label><select name="category"><option value="">📁 Без категории</option>${cats.map(c => categoryOption(c, c.id === draft.category)).join('')}</select>` : type === 'debt' ? `<label>Направление</label><select name="direction"><option value="given" ${draft.direction === 'given' ? 'selected' : ''}>Я дал в долг</option><option value="taken" ${draft.direction === 'taken' ? 'selected' : ''}>Я взял в долг</option></select><label>Имя человека</label><input name="person" value="${esc(draft.person)}" required><label>Срок возврата (необязательно)</label><input type="date" name="due" value="${esc(draft.due)}">` : `<label>Источник дохода</label><input name="person" value="${esc(draft.person)}" placeholder="Зарплата, стипендия…">`}<label>Комментарий</label><input name="note" value="${esc(draft.note)}" placeholder="Например: обед, поездка, подписка"><div style="margin-top:20px"><button class="primary">Сохранить</button></div></form>`);

    function switchType(k) {
      if (t || k === type) return;
      capture();
      type = k;
      draw();
    }

    modal.querySelectorAll('[data-type]').forEach(b => b.onclick = () => switchType(b.dataset.type));
    let x, y;
    const swipe = modal.querySelector('#types');
    swipe.ontouchstart = e => { x = e.touches[0].clientX; y = e.touches[0].clientY; };
    swipe.ontouchend = e => {
      const dx = e.changedTouches[0].clientX - x;
      const dy = e.changedTouches[0].clientY - y;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        const keys = Object.keys(types);
        switchType(keys[Math.max(0, Math.min(2, keys.indexOf(type) + (dx < 0 ? 1 : -1)))]);
      }
    };

    $('#entry').onsubmit = async e => {
      e.preventDefault();
      capture();
      const amount = cents(draft.amount);
      if (!valid(amount) || amount < (t ? rep(t) : 0) || (t?.adjustments || []).some(a => a.date < draft.date)) {
        alert('Проверь сумму: она должна быть положительной и не меньше уже возвращённой.');
        return;
      }
      if (type === 'debt' && !draft.person.trim()) {
        alert('Укажи имя');
        return;
      }
      const obj = {
        id: t?.id || uid(),
        created: t?.created || Date.now(),
        type,
        amount,
        date: draft.date,
        category: type === 'expense' ? draft.category : '',
        person: type === 'expense' ? '' : draft.person.trim(),
        due: type === 'debt' ? draft.due : '',
        direction: type === 'debt' ? draft.direction : '',
        note: draft.note.trim(),
        adjustments: t?.adjustments || []
      };
      if (await change(s => {
        const i = s.transactions.findIndex(v => v.id === obj.id);
        if (i < 0) s.transactions.push(obj);
        else s.transactions[i] = obj;
      })) modal.close();
    };
  }

  draw();
}

function detail(id) {
  const t = state.transactions.find(x => x.id === id);
  if (!t) return;
  const title = t.type === 'expense' ? expenseTitle(t) : (t.person || 'Доход');
  show(`<div class="row"><h2>${esc(types[t.type])}</h2><button data-close>✕</button></div><div class="hero"><small>${esc(title)}</small><div class="total">${money(t.amount)}</div><small>${datefmt(t.date)}</small></div>${t.type === 'expense' ? `<p>Категория: <strong>${esc(catDisplay(t))}</strong></p>` : ''}${t.note && t.type !== 'expense' ? `<p class="wrap">${esc(t.note)}</p>` : ''}${t.type === 'debt' ? `<p>Срок возврата: ${datefmt(t.due)}</p><p>${t.direction === 'given' ? 'Мне должны' : 'Я должен'}</p>` : ''}${t.type !== 'income' ? `<p>Возвращено: ${money(rep(t))}</p><p><strong>Остаток: ${money(remain(t))}</strong></p>${(t.adjustments || []).map(a => `<div class="row"><small>${datefmt(a.date)} · ${money(a.amount)}</small><button data-undo="${esc(a.id)}">Отменить</button></div>`).join('')}${remain(t) ? `<button class="primary" data-full>${t.type === 'expense' ? 'Скомпенсировано' : 'Долг возвращён'}</button><button data-partial style="width:100%">Частичный возврат</button>` : ''}` : ''}<div class="actions"><button data-edit>Редактировать</button><button class="danger" data-delete>Удалить</button></div>`);

  const full = modal.querySelector('[data-full]');
  if (full) full.onclick = () => adjust(t, true);
  const part = modal.querySelector('[data-partial]');
  if (part) part.onclick = () => adjust(t, false);
  modal.querySelector('[data-edit]').onclick = () => form(t);
  modal.querySelector('[data-delete]').onclick = async () => {
    if (confirm('Удалить операцию и историю возвратов?') && await change(s => s.transactions = s.transactions.filter(x => x.id !== id))) modal.close();
  };
  modal.querySelectorAll('[data-undo]').forEach(b => b.onclick = async () => {
    if (confirm('Отменить этот возврат?') && await change(s => {
      const x = s.transactions.find(x => x.id === id);
      x.adjustments = x.adjustments.filter(a => a.id !== b.dataset.undo);
    })) detail(id);
  });
}

function adjust(t, full) {
  show(`<div class="row"><h2>${t.type === 'expense' ? 'Компенсация' : 'Возврат долга'}</h2><button data-close>✕</button></div><form id="adjust"><label>Сумма</label><input name="amount" inputmode="decimal" value="${full ? remain(t) / 100 : ''}" required><label>Дата возврата</label><input name="date" type="date" value="${today()}" required><button class="primary" style="margin-top:18px">Подтвердить</button></form><button id="back">Назад</button>`);
  $('#back').onclick = () => detail(t.id);
  $('#adjust').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const n = cents(f.get('amount'));
    const d = f.get('date');
    if (!valid(n) || n > remain(t) || d < t.date) {
      alert('Сумма не должна превышать остаток, а дата не может быть раньше операции.');
      return;
    }
    if (await change(s => s.transactions.find(x => x.id === t.id).adjustments.push({ id: uid(), amount: n, date: d }))) detail(t.id);
  };
}

function iconPicker(current) {
  return `<div class="icon-grid">${CATEGORY_ICON_CHOICES.map(icon => `<button type="button" class="iconbtn ${icon === current ? 'selected' : ''}" data-icon="${esc(icon)}">${esc(icon)}</button>`).join('')}</div>`;
}

function category(id) {
  const c = state.categories.find(x => x.id === id);
  let chosenIcon = c?.icon || '📁';
  show(`<div class="row"><h2>${c ? 'Редактировать категорию' : 'Новая категория'}</h2><button data-close>✕</button></div><form id="category"><label>Название</label><input name="name" value="${esc(c?.name || '')}" maxlength="60" required><label>Иконка</label><div id="currentIcon" class="notice" style="margin-bottom:8px">Выбрано: <strong>${esc(chosenIcon)}</strong></div>${iconPicker(chosenIcon)}<input type="hidden" name="icon" value="${esc(chosenIcon)}"><div class="actions"><button class="primary">Сохранить</button>${c ? '<button type="button" class="danger" id="deleteCategory">Удалить категорию</button>' : ''}</div></form><p class="notice">Если удалить категорию, старые траты останутся в истории как «Без категории».</p>`);

  modal.querySelectorAll('[data-icon]').forEach(b => b.onclick = () => {
    chosenIcon = b.dataset.icon;
    modal.querySelector('[name="icon"]').value = chosenIcon;
    modal.querySelector('#currentIcon strong').textContent = chosenIcon;
    modal.querySelectorAll('.iconbtn').forEach(x => x.classList.toggle('selected', x.dataset.icon === chosenIcon));
  });

  if (c) {
    const del = modal.querySelector('#deleteCategory');
    del.onclick = async () => {
      if (!confirm('Удалить категорию? У существующих трат она пропадёт из выбора.')) return;
      if (await change(s => {
        s.categories = s.categories.filter(x => x.id !== id);
        s.transactions.forEach(t => { if (t.category === id) t.category = ''; });
      })) modal.close();
    };
  }

  $('#category').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = String(fd.get('name')).trim();
    const icon = String(fd.get('icon') || '📁').trim() || '📁';
    if (!name || state.categories.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) {
      alert('Название пустое или уже используется');
      return;
    }
    if (await change(s => {
      if (c) {
        const target = s.categories.find(x => x.id === id);
        target.name = name;
        target.icon = icon;
      } else {
        s.categories.push({ id: uid(), name, icon, enabled: true });
      }
    })) modal.close();
  };
}

function download(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function csv() {
  const q = v => '"' + String(v ?? '').replace(/^[=+@-]/, "'$&").replace(/"/g, '""') + '"';
  const rows = [['Тип', 'Дата', 'Категория', 'Имя', 'Сумма', 'Возвращено', 'Остаток', 'Срок', 'Комментарий', 'Валюта']];
  for (const t of state.transactions) rows.push([types[t.type], t.date, t.type === 'expense' ? catDisplay(t) : '', t.person, t.amount / 100, rep(t) / 100, remain(t) / 100, t.due, t.note, state.currency]);
  download('finance-' + today() + '.csv', '\ufeff' + rows.map(r => r.map(q).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}

function validate(s) {
  const str = x => typeof x === 'string';
  const date = x => str(x) && /^\d{4}-\d{2}-\d{2}$/.test(x) && !isNaN(Date.parse(x));
  if (!s || ![1, 2].includes(s.version) || !['RUB', 'USD', 'EUR', 'MDL', 'EGP', 'KZT', 'BYN', 'UAH'].includes(s.currency) || !Array.isArray(s.categories) || !Array.isArray(s.transactions)) throw Error('Неверный формат');
  const migrated = migrate(s);
  const ids = new Set();
  for (const c of migrated.categories) {
    if (!str(c.id) || ids.has(c.id) || !str(c.name) || typeof c.enabled !== 'boolean' || !str(c.icon)) throw Error('Некорректная категория');
    ids.add(c.id);
  }
  ids.clear();
  for (const t of migrated.transactions) {
    if (!str(t.id) || ids.has(t.id) || !Object.hasOwn(types, t.type) || !valid(t.amount) || !date(t.date) || !Number.isFinite(t.created) || !['category', 'person', 'due', 'direction', 'note'].every(k => str(t[k])) || !Array.isArray(t.adjustments) || (t.type === 'debt' && !['given', 'taken'].includes(t.direction)) || (t.due && !date(t.due))) throw Error('Некорректная операция');
    ids.add(t.id);
    const ai = new Set();
    for (const a of t.adjustments) {
      if (!str(a.id) || ai.has(a.id) || !valid(a.amount) || !date(a.date) || a.date < t.date) throw Error('Некорректный возврат');
      ai.add(a.id);
    }
    if (rep(t) > t.amount || (t.type === 'income' && rep(t))) throw Error('Некорректная сумма возврата');
  }
  return migrated;
}

document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if ('close' in d) modal.close();
  if (d.tab) { tab = d.tab; render(); }
  if ('add' in d) form(null, d.add || 'expense');
  if (d.detail) detail(d.detail);
  if ('newcat' in d) category();
  if (d.rename) category(d.rename);
  if ('export' in d) download('finance-' + today() + '.json', JSON.stringify(state, null, 2), 'application/json');
  if ('csv' in d) csv();
  if ('import' in d) $('#importfile').click();
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.id === 'period') { period = el.value; render(); }
  if (el.id === 'currency') {
    const value = el.value;
    if (confirm('Изменить обозначение валюты без пересчёта сумм?')) await change(s => s.currency = value);
    else render();
  }
  if (el.dataset.cat) {
    const id = el.dataset.cat, checked = el.checked;
    await change(s => s.categories.find(c => c.id === id).enabled = checked);
  }
  if (el.id === 'importfile' && el.files[0]) {
    try {
      const s = validate(JSON.parse(await el.files[0].text()));
      if (confirm('Заменить все текущие данные резервной копией?')) await change(n => Object.assign(n, s));
    } catch (err) {
      alert('Импорт не выполнен: ' + err.message);
    }
    el.value = '';
  }
});

(async () => {
  try {
    db = await openDB();
    const loaded = await read();
    state = loaded ? migrate(loaded) : initial();
    await write(state);
    render();
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
  } catch (e) {
    main.textContent = 'Не удалось открыть локальную базу данных. Открой приложение через HTTPS в Safari. ' + e.message;
  }
})();
