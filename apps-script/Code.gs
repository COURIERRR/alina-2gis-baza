/**
 * Alina Sales — приложение торговой команды Alina Group
 * Бэкенд для Google Таблицы. Вставьте этот файл в «Расширения → Apps Script».
 * Меню «Alina Sales» в таблице: загрузка точек, геокодирование, код руководителя.
 */

const MENU = 'Alina Sales';
const POINTS_SHEET = 'Точки';
const TASKS_SHEET = 'Задания';
const LOG_SHEET = 'Журнал';
const STAFF_SHEET = 'Сотрудники';
const DAY_SHEET = 'День';
const PHOTO_ROOT = 'Alina 2GIS фото';
const TZ = 'Asia/Almaty';
const FAR_METERS = 300; // визит дальше этого от точки — «далеко от точки» в статистике
const TOKEN_DAYS = 90;  // сколько дней телефон остаётся авторизованным без ввода PIN на сервере
const PIN_TRIES = 5;    // неверных PIN подряд до блокировки на 15 минут

// Колонки листа «Точки»
const P = {
  id: 0, route: 1, n: 2, name: 3, type: 4, address: 5,
  lat: 6, lon: 7, acc: 8, status: 9, agent: 10, claimed: 11, done: 12,
  phone: 13, whatsapp: 14, gis: 15, visits: 16, last: 17,
};
const POINTS_HEADER = ['id', 'Маршрут', '№', 'Точка', 'Тип', 'Адрес',
  'lat', 'lon', 'Точность', 'Статус', 'Агент', 'Взята', 'Выполнена',
  'Телефон', 'WhatsApp', 'Ссылка 2ГИС', 'Визитов', 'Последний визит'];

const ST_FREE = 'свободна';
const ST_WORK = 'в работе';
const ST_DONE = 'выполнена';

// Колонки листов «Маршрут N» (визиты, по строке на визит)
const RESULT_FIELDS = [
  ['n', '№'], ['name', 'Точка'], ['type', 'Тип'], ['address', 'Адрес'],
  ['agent', 'Агент'], ['time', 'Дата и время'],
  ['contact', 'Контактное лицо'], ['position', 'Должность'],
  ['phone', 'Телефон'], ['whatsapp', 'WhatsApp'], ['instagram', 'Instagram / сайт'],
  ['assortment', 'Ассортимент'], ['competitors', 'Бренды конкурентов'],
  ['supplier', 'Поставщик'], ['alina', 'Работают с Alina'], ['ourBrands', 'Наши бренды в точке'],
  ['interest', 'Интерес'], ['nextStep', 'Итог / следующий шаг'], ['nextDate', 'Дата след. шага'],
  ['comment', 'Комментарий'], ['photos', 'Фото'],
  ['visit', 'Визит №'], ['gps', 'GPS агента'], ['distance', 'До точки, м'],
  ['id', 'id'], ['uid', 'uid'],
];

// Колонки листа «Задания»
const T = {
  id: 0, point: 1, route: 2, name: 3, address: 4, type: 5, comment: 6, due: 7,
  author: 8, created: 9, status: 10, assignee: 11, taken: 12, done: 13, result: 14, photos: 15,
};
const TASKS_HEADER = ['id', 'id точки', 'Маршрут', 'Точка', 'Адрес', 'Задание', 'Комментарий', 'Срок',
  'Выдал', 'Выдано', 'Статус', 'Исполнитель', 'Взято', 'Выполнено', 'Результат', 'Фото'];
const TS_NEW = 'новое';
const TS_WORK = 'в работе';
const TS_DONE = 'выполнено';
const TS_CANCEL = 'отменено';

const LOG_HEADER = ['Время', 'Агент', 'Действие', 'id', 'Детали'];

// Колонки листа «Сотрудники»: PIN хранится только хэшем с солью
const S = { name: 0, hash: 1, salt: 2, role: 3, status: 4, created: 5, last: 6, ver: 7 };
const STAFF_HEADER = ['Имя', 'PIN-хэш', 'Соль', 'Роль', 'Статус', 'Создан', 'Последний вход', 'Версия PIN'];
const ROLE_AGENT = 'агент';
const ROLE_MANAGER = 'руководитель';
const ST_ACTIVE = 'активен';
const ST_BLOCKED = 'заблокирован';

// Колонки листа «День»: цель и рабочий день агента, строка на агента в день
const D = { date: 0, agent: 1, goal: 2, start: 3, startGps: 4, end: 5, endGps: 6 };
const DAY_HEADER = ['Дата', 'Агент', 'Цель (точек)', 'Начало', 'GPS начала', 'Конец', 'GPS конца'];

/* ---------------- Меню ---------------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu(MENU)
    .addItem('1. Загрузить точки из routes.json', 'menuImport')
    .addItem('2. Геокодировать адреса', 'geocodeAll')
    .addSeparator()
    .addItem('Освободить точки «в работе» старше 24 ч', 'releaseStale')
    .addItem('Код руководителя…', 'menuManagerCode')
    .addToUi();
}

function menuImport() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const res = ui.prompt('Загрузка точек',
    'Ссылка на routes.json, например\nhttps://ЛОГИН.github.io/alina-2gis-baza/data/routes.json\n\n' +
    'Текущая: ' + (props.getProperty('ROUTES_URL') || '—'), ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const url = res.getResponseText().trim() || props.getProperty('ROUTES_URL');
  if (!url) return ui.alert('Ссылка не указана');
  props.setProperty('ROUTES_URL', url);
  const added = importRoutes(url);
  ui.alert('Готово: добавлено новых точек — ' + added + '.\nТеперь запустите «2. Геокодировать адреса».');
}

/** Код входа руководителя хранится только здесь (Script Properties), не в репозитории. */
function menuManagerCode() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const res = ui.prompt('Код руководителя',
    'Код для входа «Руководитель» в приложении.\nСейчас: ' + (props.getProperty('MANAGER_CODE') ? 'задан' : 'не задан'),
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const code = res.getResponseText().trim();
  if (!code) return ui.alert('Код не изменён');
  props.setProperty('MANAGER_CODE', code);
  ui.alert('Код руководителя сохранён');
}

/** Повторная загрузка по сохранённой ссылке — можно запускать прямо из редактора. */
function importSaved() {
  const url = PropertiesService.getScriptProperties().getProperty('ROUTES_URL');
  if (!url) throw new Error('Сначала запустите «1. Загрузить точки» из меню таблицы');
  const added = importRoutes(url);
  Logger.log('Добавлено новых точек: ' + added);
  return added;
}

/* ---------------- Загрузка и геокодирование ---------------- */

/** Добавляет точки из routes.json, которых ещё нет в листе (статусы существующих не трогает). */
function importRoutes(url) {
  return addRoutes_(JSON.parse(UrlFetchApp.fetch(url).getContentText('UTF-8')).routes);
}

/**
 * Импорт маршрута из Google Таблицы формата «Точки продаж на карте КЗ» (доступ по ссылке):
 * №, Город, Название в 1С, Канал сбыта, Название точки, Адрес, Телефон, WhatsApp, Почта, Ссылка 2ГИС.
 * Данные клиентов идут сразу в эту таблицу и не попадают в публичный репозиторий.
 * coords — необязательно, { "№": [lon, lat] } из ссылок 2ГИС; точки без координат геокодируются.
 */
function importSalesSheet(spreadsheetId, sheetName, route, title, coords) {
  const url = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId +
    '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(sheetName);
  const clean = (s) => String(s || '').replace(/[​ ]/g, ' ')
    .replace(/\s*[\r\n]+\s*/g, ', ').replace(/\s{2,}/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '');
  const rows = Utilities.parseCsv(UrlFetchApp.fetch(url).getContentText('UTF-8')).slice(1)
    .filter(r => (String(r[4]) + String(r[5])).trim());
  const points = rows.map(r => {
    const n = Number(r[0]);
    const c = (coords || {})[n];
    const name1c = clean(r[2]).replace(/\*+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return {
      id: 'R' + route + '-' + ('00' + n).slice(-3), n, name: clean(r[4]),
      type: [clean(r[3]), name1c].filter(Boolean).join(' · '), address: clean(r[5]),
      phone: clean(r[6]), whatsapp: clean(r[7]), gis: clean(r[9]).replace(/\?.*$/, ''),
      lon: c ? c[0] : null, lat: c ? c[1] : null,
    };
  });
  return addRoutes_([{ route, title, points }]);
}

function addRoutes_(routes) {
  const sh = pointsSheet_();
  const existing = new Set(sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(r => String(r[0])));
  const rows = [];
  routes.forEach(r => r.points.forEach(p => {
    if (existing.has(p.id)) return;
    // Координаты из ссылки 2ГИС считаются точными, без них — геокодирование
    const has = p.lat != null && p.lon != null;
    rows.push([p.id, r.route, p.n, p.name, p.type, p.address,
      has ? p.lat : '', has ? p.lon : '', has ? 'точно' : '', ST_FREE, '', '', '',
      p.phone || '', p.whatsapp || '', p.gis || '', '', '']);
  }));
  if (rows.length) {
    const range = sh.getRange(sh.getLastRow() + 1, 1, rows.length, POINTS_HEADER.length);
    range.offset(0, P.phone, rows.length, 2).setNumberFormat('@');
    range.setValues(rows);
  }
  const props = PropertiesService.getScriptProperties();
  const titles = JSON.parse(props.getProperty('ROUTE_TITLES') || '{}');
  routes.forEach(r => { if (r.title) titles[r.route] = r.title; resultSheet_(r.route); });
  props.setProperty('ROUTE_TITLES', JSON.stringify(titles));
  return rows.length;
}

/**
 * Геокодирует адреса без координат. За один запуск — до ~5 минут,
 * если точек много, просто запустите ещё раз (продолжит с места остановки).
 */
function geocodeAll() {
  const started = Date.now();
  const sh = pointsSheet_();
  const last = sh.getLastRow();
  if (last < 2) return;
  const values = sh.getRange(2, 1, last - 1, POINTS_HEADER.length).getValues();
  const geocoder = Maps.newGeocoder().setLanguage('ru').setRegion('kz')
    .setBounds(42.9, 76.4, 43.6, 77.3);
  let done = 0, left = 0;
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (row[P.acc]) continue;
    if (Date.now() - started > 5 * 60 * 1000) { left++; continue; }
    let lat = '', lon = '', acc = 'нет';
    try {
      const r = geocoder.geocode(cleanAddress_(row[P.address]));
      const best = r.status === 'OK' && r.results[0];
      if (best) {
        const loc = best.geometry.location;
        const inArea = loc.lat > 42.9 && loc.lat < 43.6 && loc.lng > 76.4 && loc.lng < 77.3;
        const precise = ['ROOFTOP', 'RANGE_INTERPOLATED'].indexOf(best.geometry.location_type) >= 0 && !best.partial_match;
        if (inArea) {
          lat = loc.lat; lon = loc.lng;
          acc = precise ? 'точно' : 'примерно';
        }
      }
    } catch (err) {
      acc = '';
      left++;
      continue;
    }
    sh.getRange(i + 2, P.lat + 1, 1, 3).setValues([[lat, lon, acc]]);
    done++;
    Utilities.sleep(120);
  }
  const msg = 'Геокодировано: ' + done + (left ? '. Осталось: ' + left + ' — запустите ещё раз.' : '. Все адреса обработаны.');
  try { SpreadsheetApp.getActive().toast(msg, MENU, 10); } catch (e) {}
  Logger.log(msg);
}

function cleanAddress_(a) {
  return String(a)
    .replace(/\s*\d+\s*филиал\S*\s*$/i, '')
    .replace(/,?\s*Алматы\s*$/i, '')
    .trim() + ', Алматы, Казахстан';
}

function releaseStale() {
  withLock_(() => {
    const sh = pointsSheet_();
    const last = sh.getLastRow();
    if (last < 2) return;
    const range = sh.getRange(2, 1, last - 1, POINTS_HEADER.length);
    const values = range.getValues();
    const limit = Date.now() - 24 * 3600 * 1000;
    let n = 0;
    values.forEach((row, i) => {
      const t = row[P.claimed] instanceof Date ? row[P.claimed].getTime() : 0;
      if (row[P.status] === ST_WORK && t && t < limit) {
        sh.getRange(i + 2, P.status + 1, 1, 3).setValues([[ST_FREE, '', '']]);
        n++;
      }
    });
    SpreadsheetApp.getActive().toast('Освобождено точек: ' + n, MENU, 8);
  });
}

/* ---------------- Веб-приложение ---------------- */

// Каждый запрос, кроме входа, несёт токен; имя агента берётся из токена, а не из запроса
function doGet(e) {
  return handle_(() => {
    const q = e.parameter || {};
    if (q.action === 'ping') return {};
    auth_(q.token);
    if (q.action === 'summary') return cached_('summary', 600, summary_);
    if (q.action === 'points') return { points: cached_('points:' + Number(q.route), 600, () => points_(Number(q.route))) };
    if (q.action === 'result') return { result: result_(q.id) };
    if (q.action === 'history') return { visits: cached_('hist:' + q.id, 600, () => history_(q.id)) };
    if (q.action === 'tasks') return { tasks: allTasksCached_().filter(t => !q.point || t.point === String(q.point)) };
    throw new Error('Неизвестное действие');
  });
}

function doPost(e) {
  return handle_(() => {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'register') return withLock_(() => register_(body.name, body.pin, body.managerCode));
    if (body.action === 'login') return withLock_(() => login_(body.name, body.pin));
    const me = auth_(body.token);
    const agent = me.name;
    switch (body.action) {
      case 'claim': return withLock_(() => claim_(body.id, agent));
      case 'release': return withLock_(() => release_(body.id, agent));
      case 'complete': return withLock_(() => complete_(body.id, agent, body.form || {}, body.photos || []));
      case 'update': return withLock_(() => update_(body.id, agent, body.form || {}, body.photos || []));
      case 'remove': return withLock_(() => remove_(body.id, agent));
      case 'taskCreate': return withLock_(() => taskCreate_(agent, body.point, body.items || [], body.due));
      case 'taskTake': return withLock_(() => taskTake_(agent, body.id));
      case 'taskRelease': return withLock_(() => taskRelease_(agent, body.id));
      case 'taskDone': return withLock_(() => taskDone_(agent, body.id, body.result, body.photos || []));
      case 'taskCancel': return withLock_(() => taskCancel_(me, body.id));
      case 'pinChange': return withLock_(() => pinChange_(me, body.old, body.pin));
      case 'becomeManager': return withLock_(() => becomeManager_(me, body.code));
      case 'goalSet': return withLock_(() => goalSet_(agent, body.goal));
      case 'dayStart': return withLock_(() => dayStart_(agent, body.geo));
      case 'dayEnd': return withLock_(() => dayEnd_(agent, body.geo));
      case 'me': return { me: meCached_(me, Number(body.from) || 0, body.who) };
      case 'boot': return boot_(me, Number(body.from) || 0);
      case 'stats': requireManager_(me); return { stats: statsCached_(Number(body.from) || 0) };
      case 'staff': requireManager_(me); return { staff: cached_('staff', 600, staff_) };
      case 'staffReset': requireManager_(me); return withLock_(() => staffSet_(me, body.name, 'reset'));
      case 'staffBlock': requireManager_(me); return withLock_(() => staffSet_(me, body.name, body.blocked ? 'block' : 'unblock'));
      case 'staffRole': requireManager_(me); return withLock_(() => staffSet_(me, body.name, body.role === ROLE_MANAGER ? 'manager' : 'agent'));
    }
    throw new Error('Неизвестное действие');
  });
}

function handle_(fn) {
  let out;
  try { out = Object.assign({ ok: true }, fn()); }
  catch (err) { out = { ok: false, error: String(err && err.message || err), code: err && err.code || '' }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

const fail_ = (message, code) => { const e = new Error(message); if (code) e.code = code; throw e; };

const allTasksCached_ = () => cached_('tasks', 600, () => tasks_(''));
const meCached_ = (me, from, who) => cached_('me:' + nameKey_(me.name) + ':' + (me.role === ROLE_MANAGER ? nameKey_(who) : '') + ':' + from, 600,
  () => me_(me, from, who));
const statsCached_ = (from) => cached_('stats:' + from, 300, () => stats_(from));

/** Стартовый экран одним запросом: маршруты, задания, свой день; руководителю — ещё «Сегодня» по команде. */
function boot_(me, from) {
  return {
    routes: cached_('summary', 600, summary_).routes,
    tasks: allTasksCached_(),
    me: meCached_(me, from, ''),
    stats: me.role === ROLE_MANAGER ? statsCached_(from) : null,
  };
}

function requireManager_(me) {
  if (me.role !== ROLE_MANAGER) fail_('Только для руководителя');
}

// Все изменения идут через блокировку — после каждого меняется «версия данных», и кэш чтения устаревает
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { bumpData_(); lock.releaseLock(); }
}

/* ---------------- Кэш чтения (CacheService) ----------------
 * Каждый запрос к Apps Script и так стоит ~1 с, поэтому тяжёлые чтения (все точки, все визиты, статистика)
 * считаются один раз и держатся в кэше, пока кто-то что-то не изменит. */
const CACHE_MAX = 95000; // лимит CacheService — 100 КБ на значение
const cache_ = () => CacheService.getScriptCache();
function dataVer_() {
  let v = cache_().get('dv');
  if (!v) { v = String(Date.now()); cache_().put('dv', v, 21600); }
  return v;
}
function bumpData_() { try { cache_().put('dv', Utilities.getUuid().slice(0, 8), 21600); } catch (e) {} }
function cached_(key, ttl, fn) {
  const k = 'c:' + dataVer_() + ':' + key;
  try { const hit = cache_().get(k); if (hit) return JSON.parse(hit); } catch (e) {}
  const value = fn();
  try { const s = JSON.stringify(value); if (s.length < CACHE_MAX) cache_().put(k, s, ttl); } catch (e) {}
  return value;
}
// Отдельная версия для сотрудников: вход проверяется на каждом запросе, а меняются сотрудники редко
function staffVer_() {
  let v = cache_().get('sv');
  if (!v) { v = String(Date.now()); cache_().put('sv', v, 21600); }
  return v;
}
function bumpStaff_() { try { cache_().put('sv', Utilities.getUuid().slice(0, 8), 21600); } catch (e) {} }

function checkManager_(code) {
  const real = PropertiesService.getScriptProperties().getProperty('MANAGER_CODE');
  if (!real) throw new Error('Код руководителя не настроен (меню таблицы «' + MENU + ' → Код руководителя»)');
  if (String(code || '').trim() !== real) throw new Error('Неверный код руководителя');
}

const fmt_ = (d) => d instanceof Date ? Utilities.formatDate(d, TZ, 'dd.MM.yyyy HH:mm') : String(d || '');
const iso_ = (d) => d instanceof Date ? d.toISOString() : String(d || '');

/* ---------------- Точки и визиты ---------------- */

function allPoints_() {
  const sh = pointsSheet_();
  const last = sh.getLastRow();
  if (last < 2) return { sh, values: [] };
  return { sh, values: sh.getRange(2, 1, last - 1, POINTS_HEADER.length).getValues() };
}

// Точки, выполненные до появления колонки «Визитов», считаются как один визит
const visitsOf_ = (row) => Number(row[P.visits]) || (row[P.status] === ST_DONE ? 1 : 0);

function toPoint_(row) {
  return {
    id: String(row[P.id]), route: Number(row[P.route]), n: Number(row[P.n]),
    name: String(row[P.name]), type: String(row[P.type]), address: String(row[P.address]),
    lat: row[P.lat] === '' ? null : Number(row[P.lat]),
    lon: row[P.lon] === '' ? null : Number(row[P.lon]),
    acc: String(row[P.acc] || ''),
    status: String(row[P.status] || ST_FREE), agent: String(row[P.agent] || ''),
    phone: String(row[P.phone] || ''), whatsapp: String(row[P.whatsapp] || ''), gis: String(row[P.gis] || ''),
    visits: visitsOf_(row), lastVisit: fmt_(row[P.last] || row[P.done]),
  };
}

function summary_() {
  const by = {};
  const titles = JSON.parse(PropertiesService.getScriptProperties().getProperty('ROUTE_TITLES') || '{}');
  allPoints_().values.forEach(row => {
    const r = Number(row[P.route]);
    by[r] = by[r] || { route: r, title: titles[r] || '', total: 0, free: 0, work: 0, done: 0 };
    by[r].total++;
    const s = row[P.status] || ST_FREE;
    if (s === ST_DONE) by[r].done++; else if (s === ST_WORK) by[r].work++; else by[r].free++;
  });
  return { routes: Object.keys(by).sort((a, b) => a - b).map(k => by[k]) };
}

function points_(route) {
  return allPoints_().values.filter(row => Number(row[P.route]) === route).map(toPoint_);
}

function findRow_(id) {
  const { sh, values } = allPoints_();
  const i = values.findIndex(row => String(row[P.id]) === String(id));
  if (i < 0) throw new Error('Точка не найдена');
  return { sh, rowIndex: i + 2, row: values[i] };
}

function claim_(id, agent) {
  const { sh, rowIndex, row } = findRow_(id);
  const status = row[P.status] || ST_FREE;
  if (status === ST_DONE) throw new Error('Точка уже выполнена (' + row[P.agent] + ')');
  if (status === ST_WORK && row[P.agent] !== agent) throw new Error('Точку уже взял(а): ' + row[P.agent]);
  sh.getRange(rowIndex, P.status + 1, 1, 3).setValues([[ST_WORK, agent, new Date()]]);
  row[P.status] = ST_WORK; row[P.agent] = agent;
  log_(agent, 'взял точку', id, row[P.name]);
  return { point: toPoint_(row) };
}

function release_(id, agent) {
  const { sh, rowIndex, row } = findRow_(id);
  if (row[P.status] !== ST_WORK || row[P.agent] !== agent) throw new Error('Эта точка не у вас в работе');
  sh.getRange(rowIndex, P.status + 1, 1, 3).setValues([[ST_FREE, '', '']]);
  row[P.status] = ST_FREE; row[P.agent] = '';
  log_(agent, 'освободил точку', id, row[P.name]);
  return { point: toPoint_(row) };
}

/** Анкета визита. Выполненную точку можно посетить снова — добавится новый визит. */
function complete_(id, agent, form, photos) {
  const { sh, rowIndex, row } = findRow_(id);
  const status = row[P.status] || ST_FREE;
  if (status === ST_WORK && row[P.agent] !== agent) throw new Error('Точку уже взял(а): ' + row[P.agent]);

  const route = Number(row[P.route]);
  // Повторная отправка из очереди (ответ потерялся) — визит уже записан
  if (form.uid && findResult_(id, (v) => v.uid === String(form.uid))) return { point: toPoint_(row), photos: 0 };

  const now = new Date();
  const visit = visitsOf_(row) + 1;
  const geo = geoInfo_(row, form.geo);
  delete form.geo;
  const photoLinks = savePhotos_('Маршрут ' + route, row[P.id] + ' ' + String(row[P.name]).slice(0, 40), photos, now, 6);
  const rec = Object.assign({}, form, {
    n: row[P.n], name: row[P.name], type: row[P.type], address: row[P.address],
    agent: agent, time: fmt_(now), photos: photoLinks.join('\n'), id: row[P.id],
    visit: visit, gps: geo.gps, distance: geo.distance, uid: form.uid || '',
  });
  joinLists_(rec);

  const rs = resultSheet_(route);
  const values = RESULT_FIELDS.map(f => rec[f[0]] == null ? '' : String(rec[f[0]]));
  rs.getRange(rs.getLastRow() + 1, 1, 1, values.length).setNumberFormat('@').setValues([values]);

  const claimed = status === ST_DONE ? row[P.claimed] : (row[P.claimed] || now);
  sh.getRange(rowIndex, P.status + 1, 1, 4).setValues([[ST_DONE, agent, claimed, status === ST_DONE ? row[P.done] : now]]);
  sh.getRange(rowIndex, P.visits + 1, 1, 2).setValues([[visit, now]]);
  row[P.status] = ST_DONE; row[P.agent] = agent; row[P.visits] = visit; row[P.last] = now;
  log_(agent, visit > 1 ? 'повторный визит' : 'визит', id,
    row[P.name] + (geo.distance !== '' ? ' · ' + geo.distance + ' м от точки' : geo.gps ? ' · GPS отмечен' : ' · без GPS'));
  return { point: toPoint_(row), photos: photoLinks.length };
}

/** GPS агента при отправке анкеты и расстояние до координат точки. */
function geoInfo_(row, geo) {
  const gps = gpsText_(geo);
  if (!gps) return { gps: '', distance: '' };
  const has = row[P.lat] !== '' && row[P.lon] !== '' && row[P.acc] !== 'нет';
  return { gps, distance: has ? Math.round(meters_(Number(geo.lat), Number(geo.lon), Number(row[P.lat]), Number(row[P.lon]))) : '' };
}

/** GPS как текст для таблицы: «43.250000, 76.900000 (±12 м)»; parseGps_ читает его обратно для карты. */
function gpsText_(geo) {
  if (!geo || geo.lat == null || geo.lon == null) return '';
  return Number(geo.lat).toFixed(6) + ', ' + Number(geo.lon).toFixed(6) + (geo.acc ? ' (±' + Math.round(geo.acc) + ' м)' : '');
}

function parseGps_(s) {
  const m = String(s || '').match(/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
}

function meters_(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const x = Math.sin((lat2 - lat1) * r / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
}

const LIST_FIELDS = ['assortment', 'competitors', 'ourBrands'];
function joinLists_(rec) {
  LIST_FIELDS.forEach(k => { if (Array.isArray(rec[k])) rec[k] = rec[k].join(', '); });
}

function resultRows_(id) {
  const route = Number(String(id).replace(/^R(\d+)-.*$/, '$1'));
  const rs = resultSheet_(route);
  const last = rs.getLastRow();
  if (last < 2) return { rs, rows: [] };
  const values = rs.getRange(2, 1, last - 1, RESULT_FIELDS.length).getValues();
  const rows = [];
  values.forEach((v, i) => {
    const o = toResult_(v);
    if (o.id === String(id)) rows.push({ rowIndex: i + 2, values: v, rec: o });
  });
  return { rs, rows };
}

function toResult_(values) {
  const out = {};
  RESULT_FIELDS.forEach((f, i) => { out[f[0]] = String(values[i]); });
  return out;
}

/** Последний визит точки в листе «Маршрут N» (или последний, подходящий под условие). */
function findResult_(id, match) {
  const { rs, rows } = resultRows_(id);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!match || match(rows[i].rec)) return { rs, rowIndex: rows[i].rowIndex, values: rows[i].values };
  }
  return null;
}

/** Точка и её последняя анкета для изменения или удаления (приложение предупреждает, если анкета чужая). */
function ownResult_(id) {
  const point = findRow_(id);
  if (point.row[P.status] !== ST_DONE) throw new Error('Точка ещё не выполнена');
  const res = findResult_(id);
  if (!res) throw new Error('Анкета не найдена в таблице');
  return { point, res };
}

function result_(id) {
  const res = findResult_(id);
  return res ? toResult_(res.values) : null;
}

function history_(id) {
  return resultRows_(id).rows.map((r, i) => ({
    visit: Number(r.rec.visit) || i + 1, time: r.rec.time, agent: r.rec.agent,
    interest: r.rec.interest, nextStep: r.rec.nextStep, comment: r.rec.comment,
    distance: r.rec.distance, gps: !!r.rec.gps, photos: r.rec.photos.split(/\s+/).filter(Boolean).length,
  }));
}

function update_(id, agent, form, photos) {
  const { point, res } = ownResult_(id);
  const old = toResult_(res.values);
  const added = savePhotos_('Маршрут ' + Number(point.row[P.route]),
    point.row[P.id] + ' ' + String(point.row[P.name]).slice(0, 40), photos, new Date(), 6);
  delete form.geo;
  const rec = Object.assign({}, old, form, {
    n: old.n, name: old.name, type: old.type, address: old.address, agent: old.agent, time: old.time, id: old.id,
    visit: old.visit, gps: old.gps, distance: old.distance, uid: old.uid,
    photos: [old.photos].concat(added).filter(Boolean).join('\n'),
  });
  joinLists_(rec);
  const values = RESULT_FIELDS.map(f => rec[f[0]] == null ? '' : String(rec[f[0]]));
  res.rs.getRange(res.rowIndex, 1, 1, values.length).setNumberFormat('@').setValues([values]);
  log_(agent, 'изменил анкету', id, point.row[P.name]);
  return { point: toPoint_(point.row), photos: added.length };
}

/** Удаляет последний визит, фото уходят в корзину Google Drive. Без визитов точка снова свободна. */
function remove_(id, agent) {
  const { point, res } = ownResult_(id);
  const photoCol = RESULT_FIELDS.findIndex(f => f[0] === 'photos');
  String(res.values[photoCol]).split(/\s+/).forEach(url => {
    const m = url.match(/\/d\/([\w-]+)/);
    if (m) try { DriveApp.getFileById(m[1]).setTrashed(true); } catch (e) {}
  });
  res.rs.deleteRow(res.rowIndex);
  const prev = findResult_(id);
  const row = point.row;
  if (prev) {
    const p = toResult_(prev.values);
    const visits = Math.max(1, visitsOf_(row) - 1);
    point.sh.getRange(point.rowIndex, P.agent + 1).setValue(p.agent);
    point.sh.getRange(point.rowIndex, P.visits + 1).setValue(visits);
    row[P.agent] = p.agent; row[P.visits] = visits;
  } else {
    point.sh.getRange(point.rowIndex, P.status + 1, 1, 4).setValues([[ST_FREE, '', '', '']]);
    point.sh.getRange(point.rowIndex, P.visits + 1, 1, 2).setValues([['', '']]);
    row[P.status] = ST_FREE; row[P.agent] = ''; row[P.visits] = ''; row[P.last] = '';
  }
  log_(agent, 'удалил анкету', id, row[P.name]);
  return { point: toPoint_(row) };
}

/** Фото приходят как data:URL (строка) — сохраняются в папку на Google Диске. */
function savePhotos_(folderName, baseName, photos, now, max) {
  if (!photos.length) return [];
  const folder = subFolder_(subFolder_(DriveApp.getRootFolder(), PHOTO_ROOT), folderName);
  const stamp = Utilities.formatDate(now, TZ, 'yyyyMMdd-HHmm');
  return photos.slice(0, max).map((p, i) => {
    const data = typeof p === 'string' ? p : (p && p.data) || '';
    const base64 = String(data).replace(/^data:[^,]+,/, '');
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/jpeg',
      baseName + ' ' + stamp + '-' + (i + 1) + '.jpg');
    const file = folder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
    return file.getUrl();
  });
}

/* ---------------- Задания ---------------- */

function allTasks_() {
  const sh = tasksSheet_();
  const last = sh.getLastRow();
  if (last < 2) return { sh, values: [] };
  return { sh, values: sh.getRange(2, 1, last - 1, TASKS_HEADER.length).getValues() };
}

function toTask_(row) {
  const due = row[T.due] instanceof Date ? Utilities.formatDate(row[T.due], TZ, 'yyyy-MM-dd') : String(row[T.due] || '');
  return {
    id: String(row[T.id]), point: String(row[T.point]), route: Number(row[T.route]),
    name: String(row[T.name]), address: String(row[T.address]),
    type: String(row[T.type]), comment: String(row[T.comment]), due: due,
    author: String(row[T.author]), created: iso_(row[T.created]),
    status: String(row[T.status] || TS_NEW), assignee: String(row[T.assignee] || ''),
    taken: iso_(row[T.taken]), done: iso_(row[T.done]),
    result: String(row[T.result] || ''), photos: String(row[T.photos] || ''),
  };
}

function tasks_(point) {
  return allTasks_().values
    .filter(row => !point || String(row[T.point]) === String(point))
    .map(toTask_);
}

function findTask_(id) {
  const { sh, values } = allTasks_();
  const i = values.findIndex(row => String(row[T.id]) === String(id));
  if (i < 0) throw new Error('Задание не найдено');
  return { sh, rowIndex: i + 2, row: values[i] };
}

function setTask_(t, cols) {
  Object.keys(cols).forEach(k => {
    t.sh.getRange(t.rowIndex, T[k] + 1).setValue(cols[k]);
    t.row[T[k]] = cols[k];
  });
}

function taskCreate_(agent, pointId, items, due) {
  const { row } = findRow_(pointId);
  items = items.filter(it => it && String(it.type || '').trim());
  if (!items.length) throw new Error('Выберите хотя бы одно задание');
  const now = new Date();
  // Случайный хвост: два задания в одну секунду не должны получить одинаковый id
  const stamp = Utilities.formatDate(now, TZ, 'yyMMdd-HHmmss') + Utilities.getUuid().slice(0, 4);
  const dueStr = /^\d{4}-\d{2}-\d{2}$/.test(String(due || '')) ? String(due) : '';
  const rows = items.map((it, i) => ['T' + stamp + '-' + (i + 1), row[P.id], row[P.route], row[P.name], row[P.address],
    String(it.type).trim(), String(it.comment || '').trim(), dueStr, agent, now, TS_NEW, '', '', '', '', '']);
  const sh = tasksSheet_();
  const range = sh.getRange(sh.getLastRow() + 1, 1, rows.length, TASKS_HEADER.length);
  range.offset(0, T.due, rows.length, 1).setNumberFormat('@');
  range.setValues(rows);
  rows.forEach(r => log_(agent, 'выдал задание', r[T.id], r[T.type] + ' — ' + r[T.name] + (dueStr ? ' · срок ' + dueStr : '')));
  return { tasks: tasks_(pointId) };
}

function taskTake_(agent, id) {
  const t = findTask_(id);
  const s = t.row[T.status] || TS_NEW;
  if (s === TS_WORK && t.row[T.assignee] !== agent) throw new Error('Задание уже взял(а): ' + t.row[T.assignee]);
  if (s !== TS_NEW && s !== TS_WORK) throw new Error('Задание уже ' + s);
  setTask_(t, { status: TS_WORK, assignee: agent, taken: new Date() });
  log_(agent, 'взял задание', id, t.row[T.type] + ' — ' + t.row[T.name]);
  return { task: toTask_(t.row) };
}

function taskRelease_(agent, id) {
  const t = findTask_(id);
  if (t.row[T.status] !== TS_WORK || t.row[T.assignee] !== agent) throw new Error('Это задание не у вас в работе');
  setTask_(t, { status: TS_NEW, assignee: '', taken: '' });
  log_(agent, 'отказался от задания', id, t.row[T.type] + ' — ' + t.row[T.name]);
  return { task: toTask_(t.row) };
}

/** Закрыть задание. Свободное задание можно сразу закрыть — оно закрепится за агентом. */
function taskDone_(agent, id, result, photos) {
  const t = findTask_(id);
  const s = t.row[T.status] || TS_NEW;
  if (s === TS_WORK && t.row[T.assignee] !== agent) throw new Error('Задание выполняет: ' + t.row[T.assignee]);
  if (s !== TS_NEW && s !== TS_WORK) throw new Error('Задание уже ' + s);
  const now = new Date();
  const links = savePhotos_('Задания', t.row[T.id] + ' ' + String(t.row[T.name]).slice(0, 40), photos, now, 3);
  setTask_(t, {
    status: TS_DONE, assignee: agent, taken: t.row[T.taken] || now, done: now,
    result: String(result || '').trim(), photos: links.join('\n'),
  });
  log_(agent, 'выполнил задание', id, t.row[T.type] + ' — ' + t.row[T.name] + (links.length ? ' · фото ' + links.length : ''));
  return { task: toTask_(t.row) };
}

function taskCancel_(me, id) {
  const t = findTask_(id);
  if (t.row[T.author] !== me.name && me.role !== ROLE_MANAGER) fail_('Отменить может автор задания или руководитель');
  if (t.row[T.status] === TS_DONE) throw new Error('Задание уже выполнено');
  setTask_(t, { status: TS_CANCEL });
  log_(me.name, 'отменил задание', id, t.row[T.type] + ' — ' + t.row[T.name]);
  return { task: toTask_(t.row) };
}

/* ---------------- Журнал и статистика ---------------- */

function log_(agent, action, id, details) {
  try { logSheet_().appendRow([new Date(), agent, action, String(id || ''), String(details || '')]); } catch (e) {}
}

/** Все визиты из листов «Маршрут N» (в порядке строк) с временем t в мс. */
function allVisits_() {
  const out = [];
  SpreadsheetApp.getActive().getSheets().filter(sh => /^Маршрут \d+$/.test(sh.getName())).forEach(sh => {
    const last = sh.getLastRow();
    if (last < 2) return;
    ensureResultColumns_(sh);
    sh.getRange(2, 1, last - 1, RESULT_FIELDS.length).getValues().forEach(v => {
      const r = toResult_(v);
      r.t = 0;
      try { r.t = Utilities.parseDate(r.time, TZ, 'dd.MM.yyyy HH:mm').getTime(); } catch (e) {}
      out.push(r);
    });
  });
  return out;
}

const nameKey_ = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');
const todayStr_ = () => Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
const dayStartMs_ = () => Utilities.parseDate(todayStr_() + ' 00:00', TZ, 'yyyy-MM-dd HH:mm').getTime();

/** Статистика для руководителя: визиты, задания, лента, «Сегодня» по команде. from — мс, 0 = всё время. */
function stats_(from) {
  const visits = allVisits_();
  const out = computeStats_(from, visits, '');
  out.feed = feed_(from, '');
  out.today = teamToday_(visits);
  return out;
}

/** Счётчики по агентам за период; only — имя одного агента (для личного кабинета). */
function computeStats_(from, visits, only) {
  const today = todayStr_();
  const by = {};
  const ag = (name) => by[name] || (by[name] = { name, visits: 0, newPoints: 0, far: 0, noGps: 0,
    issued: 0, taken: 0, done: 0, inWork: 0, overdue: 0, last: 0 });
  const seen = (a, t) => { if (t > a.last) a.last = t; };
  const inPeriod = (t) => t && t >= from;
  const mine = (name) => !only || nameKey_(name) === nameKey_(only);

  visits.forEach(r => {
    if (!r.agent || !inPeriod(r.t) || !mine(r.agent)) return;
    const a = ag(r.agent);
    a.visits++;
    if (!(Number(r.visit) > 1)) a.newPoints++;
    if (!r.gps) a.noGps++;
    else if (r.distance !== '' && Number(r.distance) > FAR_METERS) a.far++;
    seen(a, r.t);
  });

  let issued = 0, takenN = 0, doneN = 0, open = 0, overdue = 0, hours = 0, hoursN = 0;
  allTasks_().values.forEach(row => {
    const task = toTask_(row);
    if (only && !mine(task.author) && !mine(task.assignee)) return;
    const tc = row[T.created] instanceof Date ? row[T.created].getTime() : 0;
    const tt = row[T.taken] instanceof Date ? row[T.taken].getTime() : 0;
    const td = row[T.done] instanceof Date ? row[T.done].getTime() : 0;
    if (inPeriod(tc) && task.author && mine(task.author)) { issued++; const a = ag(task.author); a.issued++; seen(a, tc); }
    if (inPeriod(tt) && task.assignee && mine(task.assignee)) { takenN++; const a = ag(task.assignee); a.taken++; seen(a, tt); }
    if (task.status === TS_DONE && inPeriod(td) && task.assignee && mine(task.assignee)) {
      doneN++; const a = ag(task.assignee); a.done++; seen(a, td);
      if (tt) { hours += (td - tt) / 3600000; hoursN++; }
    }
    if ((task.status === TS_NEW || task.status === TS_WORK) && (!only || mine(task.assignee))) {
      open++;
      if (task.status === TS_WORK && task.assignee) ag(task.assignee).inWork++;
      if (task.due && task.due < today) { overdue++; if (task.assignee) ag(task.assignee).overdue++; }
    }
  });

  const agents = Object.keys(by).map(k => {
    const a = by[k];
    return Object.assign({}, a, { last: a.last ? new Date(a.last).toISOString() : '' });
  }).sort((a, b) => (b.visits + b.done) - (a.visits + a.done) || a.name.localeCompare(b.name));
  const sum = (k) => agents.reduce((s, a) => s + a[k], 0);
  return {
    totals: {
      visits: sum('visits'), newPoints: sum('newPoints'), far: sum('far'), noGps: sum('noGps'),
      issued, taken: takenN, done: doneN, open, overdue,
      avgHours: hoursN ? Math.round(hours / hoursN * 10) / 10 : null,
    },
    agents, farMeters: FAR_METERS,
  };
}

/** Последние 100 действий из «Журнала» за период (only — одного агента). */
function feed_(from, only) {
  const feed = [];
  const lsh = logSheet_();
  const lastLog = lsh.getLastRow();
  if (lastLog < 2) return feed;
  const n = Math.min(lastLog - 1, 1500);
  const rows = lsh.getRange(lastLog - n + 1, 1, n, LOG_HEADER.length).getValues();
  for (let i = rows.length - 1; i >= 0 && feed.length < 100; i--) {
    const t = rows[i][0] instanceof Date ? rows[i][0].getTime() : 0;
    if (!t || t < from) continue;
    if (only && nameKey_(rows[i][1]) !== nameKey_(only)) continue;
    feed.push({ time: new Date(t).toISOString(), agent: String(rows[i][1]), action: String(rows[i][2]),
      id: String(rows[i][3]), details: String(rows[i][4]) });
  }
  return feed;
}

/* ---------------- Вход: PIN и токены ---------------- */

function hashPin_(salt, pin) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    salt + ':' + pin, Utilities.Charset.UTF_8));
}

function tokenSecret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('TOKEN_SECRET', s); }
  return s;
}

const sign_ = (payload) => Utilities.base64EncodeWebSafe(
  Utilities.computeHmacSha256Signature(payload, tokenSecret_(), Utilities.Charset.UTF_8));

/** Токен: имя.время.версияPIN.подпись — хранить не нужно, сброс PIN меняет версию и гасит старые токены. */
function makeToken_(name, ver) {
  const payload = Utilities.base64EncodeWebSafe(name, Utilities.Charset.UTF_8) + '.' + Date.now().toString(36) + '.' + ver;
  return payload + '.' + sign_(payload);
}

function auth_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4) fail_('Войдите в приложение', 'auth');
  const payload = parts.slice(0, 3).join('.');
  if (sign_(payload) !== parts[3]) fail_('Войдите заново', 'auth');
  if (Date.now() - parseInt(parts[1], 36) > TOKEN_DAYS * 86400000) fail_('Сессия истекла — войдите заново', 'auth');
  const name = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8');
  const st = staffInfo_(name);
  if (!st || !st.hasPin || String(st.ver) !== parts[2]) fail_('Войдите заново', 'auth');
  if (st.status === ST_BLOCKED) fail_('Доступ закрыт — обратитесь к руководителю', 'auth');
  return { name: st.name, role: st.role };
}

/** Сотрудник для проверки входа — из кэша, пока список сотрудников не менялся. */
function staffInfo_(name) {
  const k = 'si:' + staffVer_() + ':' + Utilities.base64EncodeWebSafe(nameKey_(name), Utilities.Charset.UTF_8);
  try { const hit = cache_().get(k); if (hit) return JSON.parse(hit); } catch (e) {}
  const st = findStaff_(name);
  const info = st ? { name: String(st.row[S.name]), hasPin: !!st.row[S.hash], ver: Number(st.row[S.ver]) || 1,
    role: String(st.row[S.role] || ROLE_AGENT), status: String(st.row[S.status] || ST_ACTIVE) } : null;
  try { cache_().put(k, JSON.stringify(info), 600); } catch (e) {}
  return info;
}

const session_ = (name, role, ver) => ({ token: makeToken_(name, ver), name, role });
const checkPin_ = (pin) => { if (!/^\d{4}$/.test(String(pin || ''))) fail_('PIN — 4 цифры'); return String(pin); };

function register_(name, pin, managerCode) {
  name = String(name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2) fail_('Укажите имя и фамилию');
  pin = checkPin_(pin);
  if (managerCode) checkManager_(managerCode);
  const salt = Utilities.getUuid();
  const now = new Date();
  const st = findStaff_(name);
  let role = managerCode ? ROLE_MANAGER : ROLE_AGENT;
  let ver = 1;
  if (st) {
    if (st.row[S.status] === ST_BLOCKED) fail_('Доступ закрыт — обратитесь к руководителю');
    if (st.row[S.hash]) fail_('Это имя уже зарегистрировано — войдите своим PIN или попросите руководителя сбросить PIN', 'exists');
    // PIN сброшен руководителем: человек задаёт новый, роль сохраняется
    name = String(st.row[S.name]);
    if (st.row[S.role] === ROLE_MANAGER) role = ROLE_MANAGER;
    ver = (Number(st.row[S.ver]) || 1) + 1;
    st.sh.getRange(st.rowIndex, 1, 1, STAFF_HEADER.length)
      .setValues([[name, hashPin_(salt, pin), salt, role, ST_ACTIVE, st.row[S.created] || now, now, ver]]);
  } else {
    staffSheet_().appendRow([name, hashPin_(salt, pin), salt, role, ST_ACTIVE, now, now, ver]);
  }
  bumpStaff_();
  log_(name, 'зарегистрировался', '', role);
  return session_(name, role, ver);
}

function login_(name, pin) {
  const st = findStaff_(name);
  if (!st || !st.row[S.hash]) fail_('Вы входите впервые — придумайте PIN', 'not_registered');
  if (st.row[S.status] === ST_BLOCKED) fail_('Доступ закрыт — обратитесь к руководителю');
  const cache = CacheService.getScriptCache();
  const key = 'pinfail:' + Utilities.base64EncodeWebSafe(nameKey_(name), Utilities.Charset.UTF_8);
  const fails = Number(cache.get(key)) || 0;
  if (fails >= PIN_TRIES) fail_('Слишком много попыток. Подождите 15 минут');
  if (hashPin_(st.row[S.salt], String(pin || '')) !== st.row[S.hash]) {
    cache.put(key, String(fails + 1), 900);
    const left = PIN_TRIES - fails - 1;
    fail_(left > 0 ? 'Неверный PIN. Осталось попыток: ' + left : 'Неверный PIN. Вход заблокирован на 15 минут', 'bad_pin');
  }
  cache.remove(key);
  st.sh.getRange(st.rowIndex, S.last + 1).setValue(new Date());
  return session_(String(st.row[S.name]), String(st.row[S.role] || ROLE_AGENT), Number(st.row[S.ver]) || 1);
}

function pinChange_(me, oldPin, pin) {
  const st = findStaff_(me.name);
  if (hashPin_(st.row[S.salt], String(oldPin || '')) !== st.row[S.hash]) fail_('Неверный текущий PIN');
  pin = checkPin_(pin);
  const salt = Utilities.getUuid();
  const ver = (Number(st.row[S.ver]) || 1) + 1;
  st.sh.getRange(st.rowIndex, S.hash + 1, 1, 2).setValues([[hashPin_(salt, pin), salt]]);
  st.sh.getRange(st.rowIndex, S.ver + 1).setValue(ver);
  bumpStaff_();
  log_(me.name, 'сменил PIN', '', '');
  return session_(me.name, me.role, ver);
}

function becomeManager_(me, code) {
  checkManager_(code);
  const st = findStaff_(me.name);
  st.sh.getRange(st.rowIndex, S.role + 1).setValue(ROLE_MANAGER);
  bumpStaff_();
  log_(me.name, 'стал руководителем', '', '');
  return session_(me.name, ROLE_MANAGER, Number(st.row[S.ver]) || 1);
}

function findStaff_(name) {
  const sh = staffSheet_();
  const last = sh.getLastRow();
  if (last < 2 || !String(name || '').trim()) return null;
  const values = sh.getRange(2, 1, last - 1, STAFF_HEADER.length).getValues();
  const i = values.findIndex(row => nameKey_(row[S.name]) === nameKey_(name));
  return i < 0 ? null : { sh, rowIndex: i + 2, row: values[i] };
}

function staff_() {
  const sh = staffSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, STAFF_HEADER.length).getValues().filter(r => r[S.name]).map(r => ({
    name: String(r[S.name]), role: String(r[S.role] || ROLE_AGENT), status: String(r[S.status] || ST_ACTIVE),
    hasPin: !!r[S.hash], created: iso_(r[S.created]), last: iso_(r[S.last]),
  }));
}

/** Руководитель: сброс PIN, блокировка, роль. Любое изменение гасит токены сотрудника. */
function staffSet_(me, name, what) {
  const st = findStaff_(name);
  if (!st) fail_('Сотрудник не найден');
  if (nameKey_(st.row[S.name]) === nameKey_(me.name) && what !== 'reset') fail_('Нельзя изменить себя');
  const ver = (Number(st.row[S.ver]) || 1) + 1;
  if (what === 'reset') st.sh.getRange(st.rowIndex, S.hash + 1, 1, 2).setValues([['', '']]);
  if (what === 'block' || what === 'unblock') st.sh.getRange(st.rowIndex, S.status + 1).setValue(what === 'block' ? ST_BLOCKED : ST_ACTIVE);
  if (what === 'manager' || what === 'agent') st.sh.getRange(st.rowIndex, S.role + 1).setValue(what === 'manager' ? ROLE_MANAGER : ROLE_AGENT);
  st.sh.getRange(st.rowIndex, S.ver + 1).setValue(ver);
  bumpStaff_();
  const labels = { reset: 'сбросил PIN', block: 'заблокировал', unblock: 'разблокировал', manager: 'назначил руководителем', agent: 'назначил агентом' };
  log_(me.name, labels[what], '', String(st.row[S.name]));
  return { staff: staff_() };
}

/* ---------------- Рабочий день, цель, личный кабинет ---------------- */

function dayRow_(agent, date) {
  const sh = daySheet_();
  const last = sh.getLastRow();
  const values = last < 2 ? [] : sh.getRange(2, 1, last - 1, DAY_HEADER.length).getValues();
  const i = values.findIndex(r => String(r[D.date]) === date && nameKey_(r[D.agent]) === nameKey_(agent));
  if (i >= 0) return { sh, rowIndex: i + 2, row: values[i] };
  const row = [date, agent, '', '', '', '', ''];
  sh.getRange(last + 1, 1, 1, DAY_HEADER.length).setNumberFormat('@').setValues([row]);
  return { sh, rowIndex: last + 1, row };
}

function setDay_(d, cols) {
  Object.keys(cols).forEach(k => {
    d.sh.getRange(d.rowIndex, D[k] + 1).setValue(cols[k]);
    d.row[D[k]] = cols[k];
  });
}

const dayOut_ = (row) => ({
  goal: Number(row[D.goal]) || 0, start: String(row[D.start] || ''), end: String(row[D.end] || ''),
});
// Время дня хранится текстом ISO, чтобы таблица не меняла формат
const nowIso_ = () => new Date().toISOString();

function goalSet_(agent, goal) {
  const n = Math.round(Number(goal));
  if (!(n >= 1 && n <= 200)) fail_('Цель — от 1 до 200 точек');
  const d = dayRow_(agent, todayStr_());
  setDay_(d, { goal: n });
  log_(agent, 'цель дня', '', n + ' точек');
  return { day: dayOut_(d.row) };
}

function dayStart_(agent, geo) {
  const d = dayRow_(agent, todayStr_());
  if (d.row[D.start] && !d.row[D.end]) fail_('Рабочий день уже начат');
  // Повторное начало после окончания — продолжение того же дня
  if (d.row[D.start]) setDay_(d, { end: '', endGps: '' });
  else setDay_(d, { start: nowIso_(), startGps: gpsText_(geo) });
  log_(agent, 'начал день', '', gpsText_(geo) ? 'GPS отмечен' : 'без GPS');
  return { day: dayOut_(d.row) };
}

function dayEnd_(agent, geo) {
  const d = dayRow_(agent, todayStr_());
  if (!d.row[D.start]) fail_('Рабочий день ещё не начат');
  setDay_(d, { end: nowIso_(), endGps: gpsText_(geo) });
  log_(agent, 'закончил день', '', gpsText_(geo) ? 'GPS отмечен' : 'без GPS');
  return { day: dayOut_(d.row) };
}

/** Личный кабинет: свои цифры за период, сегодня (цель, рабочий день), дела. Руководитель может смотреть любого (who). */
function me_(me, from, who) {
  const name = who && me.role === ROLE_MANAGER ? String(who) : me.name;
  const visits = allVisits_();
  const period = computeStats_(from, visits, name).totals;
  const todayVisits = visits.filter(v => v.t >= dayStartMs_() && nameKey_(v.agent) === nameKey_(name)).length;
  const sh = daySheet_();
  const last = sh.getLastRow();
  const today = todayStr_();
  const row = (last < 2 ? [] : sh.getRange(2, 1, last - 1, DAY_HEADER.length).getValues())
    .find(r => String(r[D.date]) === today && nameKey_(r[D.agent]) === nameKey_(name));
  const st = findStaff_(name);
  return {
    name, role: st ? String(st.row[S.role] || ROLE_AGENT) : ROLE_AGENT,
    period, today: Object.assign({ visits: todayVisits }, row ? dayOut_(row) : { goal: 0, start: '', end: '' }),
    // Лента нужна только руководителю в чужом кабинете — свой кабинет не читает «Журнал»
    todo: todo_(name, visits), feed: name !== me.name ? feed_(from, name).slice(0, 30) : [],
  };
}

/** Дела: последний визит точки сделан мной и в нём стоит дата следующего шага. */
function todo_(name, visits) {
  const lastById = {};
  visits.forEach(v => { if (v.id) lastById[v.id] = v; });
  return Object.keys(lastById).map(k => lastById[k])
    .filter(v => v.nextDate && nameKey_(v.agent) === nameKey_(name))
    .map(v => ({ id: v.id, name: v.name, address: v.address, nextDate: v.nextDate, nextStep: v.nextStep }))
    .sort((a, b) => a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : 0);
}

/** «Сегодня» для руководителя: цель, рабочий день, визиты и последнее место каждого агента. */
function teamToday_(visits) {
  const start = dayStartMs_();
  const today = todayStr_();
  const by = {};
  const ag = (name) => {
    const k = nameKey_(name);
    return by[k] || (by[k] = { name: String(name), goal: 0, visits: 0, start: '', end: '', startPos: null, lastPos: null, last: '' });
  };
  staff_().filter(s => s.status !== ST_BLOCKED).forEach(s => ag(s.name));
  const sh = daySheet_();
  const lastRow = sh.getLastRow();
  (lastRow < 2 ? [] : sh.getRange(2, 1, lastRow - 1, DAY_HEADER.length).getValues())
    .filter(r => String(r[D.date]) === today).forEach(r => {
      const a = ag(r[D.agent]);
      Object.assign(a, dayOut_(r), { startPos: parseGps_(r[D.startGps]) });
    });
  visits.forEach(v => {
    if (!v.agent || v.t < start) return;
    const a = ag(v.agent);
    a.visits++;
    const pos = parseGps_(v.gps);
    if (pos) a.lastPos = Object.assign(pos, { time: new Date(v.t).toISOString(), point: v.name, id: v.id });
    a.last = new Date(v.t).toISOString();
  });
  return Object.keys(by).map(k => by[k])
    .sort((a, b) => (b.goal ? b.visits / b.goal : 0) - (a.goal ? a.visits / a.goal : 0) || b.visits - a.visits || a.name.localeCompare(b.name));
}

/* ---------------- Листы и папки ---------------- */

function pointsSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(POINTS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(POINTS_SHEET, 0);
    sh.getRange(1, 1, 1, POINTS_HEADER.length).setValues([POINTS_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(P.name + 1, 220);
    sh.setColumnWidth(P.address + 1, 360);
  } else if (sh.getLastColumn() < POINTS_HEADER.length) {
    sh.getRange(1, 1, 1, POINTS_HEADER.length).setValues([POINTS_HEADER]).setFontWeight('bold');
  }
  return sh;
}

function tasksSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(TASKS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TASKS_SHEET, 1);
    sh.getRange(1, 1, 1, TASKS_HEADER.length).setValues([TASKS_HEADER])
      .setFontWeight('bold').setBackground('#dbe7f5');
    sh.setFrozenRows(1);
    sh.setColumnWidth(T.name + 1, 200);
    sh.setColumnWidth(T.type + 1, 280);
    sh.setColumnWidth(T.comment + 1, 260);
  }
  return sh;
}

function staffSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(STAFF_SHEET);
  if (!sh) {
    sh = ss.insertSheet(STAFF_SHEET);
    sh.getRange(1, 1, 1, STAFF_HEADER.length).setValues([STAFF_HEADER]).setFontWeight('bold').setBackground('#dbe7f5');
    sh.setFrozenRows(1);
    sh.setColumnWidth(S.name + 1, 220);
  }
  return sh;
}

function daySheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(DAY_SHEET);
  if (!sh) {
    sh = ss.insertSheet(DAY_SHEET);
    sh.getRange(1, 1, 1, DAY_HEADER.length).setValues([DAY_HEADER]).setFontWeight('bold').setBackground('#dbe7f5');
    sh.setFrozenRows(1);
    sh.setColumnWidth(D.agent + 1, 200);
  }
  return sh;
}

function logSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET);
    sh.getRange(1, 1, 1, LOG_HEADER.length).setValues([LOG_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(5, 420);
  }
  return sh;
}

function resultSheet_(route) {
  const ss = SpreadsheetApp.getActive();
  const name = 'Маршрут ' + route;
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, RESULT_FIELDS.length).setValues([RESULT_FIELDS.map(f => f[1])])
      .setFontWeight('bold').setBackground('#dbe7f5');
    sh.setFrozenRows(1);
  } else {
    ensureResultColumns_(sh);
  }
  return sh;
}

/** Новые поля анкеты вставляются колонкой на своё место — старые строки не сдвигаются. */
function ensureResultColumns_(sh) {
  // Проверка заголовка — лишнее чтение листа на каждом запросе; после первой проверки помним 6 часов
  const flag = 'cols:' + sh.getName() + ':' + RESULT_FIELDS.length;
  if (cache_().get(flag)) return;
  ensureResultColumnsNow_(sh);
  cache_().put(flag, '1', 21600);
}

function ensureResultColumnsNow_(sh) {
  const width = Math.max(sh.getLastColumn(), 1);
  const header = sh.getRange(1, 1, 1, width).getValues()[0].map(String);
  RESULT_FIELDS.forEach((f, i) => {
    if (header[i] === f[1]) return;
    if (header.indexOf(f[1]) >= 0) return;
    if (i >= header.length) {
      // Колонка в конце: добавить место на листе, если его нет
      if (sh.getMaxColumns() < i + 1) sh.insertColumnsAfter(sh.getMaxColumns(), i + 1 - sh.getMaxColumns());
    } else {
      sh.insertColumnBefore(i + 1);
    }
    sh.getRange(1, i + 1).setValue(f[1]).setFontWeight('bold').setBackground('#dbe7f5');
    header.splice(i, 0, f[1]);
  });
}

function subFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
