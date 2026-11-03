/**
 * Alina Sales — приложение торговой команды Alina Group
 * Бэкенд для Google Таблицы. Вставьте этот файл в «Расширения → Apps Script».
 * Меню «Alina Sales» в таблице: загрузка точек, геокодирование, код руководителя.
 */

const MENU = 'Alina Sales';
const POINTS_SHEET = 'Точки';
const TASKS_SHEET = 'Задания';
const LOG_SHEET = 'Журнал';
const PHOTO_ROOT = 'Alina 2GIS фото';
const TZ = 'Asia/Almaty';
const FAR_METERS = 300; // визит дальше этого от точки — «далеко от точки» в статистике

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
  ['interest', 'Интерес'], ['nextStep', 'Итог / следующий шаг'],
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

function doGet(e) {
  return handle_(() => {
    const q = e.parameter || {};
    if (q.action === 'summary') return summary_();
    if (q.action === 'points') return { points: points_(Number(q.route)) };
    if (q.action === 'result') return { result: result_(q.id) };
    if (q.action === 'history') return { visits: history_(q.id) };
    if (q.action === 'tasks') return { tasks: tasks_(q.point) };
    if (q.action === 'ping') return { ok: true };
    throw new Error('Неизвестное действие');
  });
}

function doPost(e) {
  return handle_(() => {
    const body = JSON.parse(e.postData.contents);
    const agent = String(body.agent || '').trim();
    if (!agent) throw new Error('Не указано имя агента');
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
      case 'taskCancel': return withLock_(() => taskCancel_(agent, body.id, body.code));
      case 'managerLogin': checkManager_(body.code); return {};
      case 'stats': checkManager_(body.code); return { stats: stats_(Number(body.from) || 0) };
    }
    throw new Error('Неизвестное действие');
  });
}

function handle_(fn) {
  let out;
  try { out = Object.assign({ ok: true }, fn()); }
  catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

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
  if (!geo || geo.lat == null || geo.lon == null) return { gps: '', distance: '' };
  const lat = Number(geo.lat), lon = Number(geo.lon);
  const gps = lat.toFixed(6) + ', ' + lon.toFixed(6) + (geo.acc ? ' (±' + Math.round(geo.acc) + ' м)' : '');
  const has = row[P.lat] !== '' && row[P.lon] !== '' && row[P.acc] !== 'нет';
  return { gps, distance: has ? Math.round(meters_(lat, lon, Number(row[P.lat]), Number(row[P.lon]))) : '' };
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
  const stamp = Utilities.formatDate(now, TZ, 'yyMMdd-HHmmss');
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

function taskCancel_(agent, id, code) {
  const t = findTask_(id);
  if (t.row[T.author] !== agent) checkManager_(code);
  if (t.row[T.status] === TS_DONE) throw new Error('Задание уже выполнено');
  setTask_(t, { status: TS_CANCEL });
  log_(agent, 'отменил задание', id, t.row[T.type] + ' — ' + t.row[T.name]);
  return { task: toTask_(t.row) };
}

/* ---------------- Журнал и статистика ---------------- */

function log_(agent, action, id, details) {
  try { logSheet_().appendRow([new Date(), agent, action, String(id || ''), String(details || '')]); } catch (e) {}
}

/** Статистика для руководителя: визиты (листы «Маршрут N»), задания, лента из «Журнала». from — мс, 0 = всё время. */
function stats_(from) {
  const ss = SpreadsheetApp.getActive();
  const now = new Date();
  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const by = {};
  const ag = (name) => by[name] || (by[name] = { name, visits: 0, newPoints: 0, far: 0, noGps: 0,
    issued: 0, taken: 0, done: 0, inWork: 0, overdue: 0, last: 0 });
  const seen = (a, t) => { if (t > a.last) a.last = t; };
  const inPeriod = (t) => t && t >= from;

  ss.getSheets().filter(sh => /^Маршрут \d+$/.test(sh.getName())).forEach(sh => {
    const last = sh.getLastRow();
    if (last < 2) return;
    ensureResultColumns_(sh);
    sh.getRange(2, 1, last - 1, RESULT_FIELDS.length).getValues().forEach(v => {
      const r = toResult_(v);
      let t = 0;
      try { t = Utilities.parseDate(r.time, TZ, 'dd.MM.yyyy HH:mm').getTime(); } catch (e) {}
      if (!r.agent || !inPeriod(t)) return;
      const a = ag(r.agent);
      a.visits++;
      if (!(Number(r.visit) > 1)) a.newPoints++;
      if (!r.gps) a.noGps++;
      else if (r.distance !== '' && Number(r.distance) > FAR_METERS) a.far++;
      seen(a, t);
    });
  });

  let issued = 0, takenN = 0, doneN = 0, open = 0, overdue = 0, hours = 0, hoursN = 0;
  allTasks_().values.forEach(row => {
    const task = toTask_(row);
    const tc = row[T.created] instanceof Date ? row[T.created].getTime() : 0;
    const tt = row[T.taken] instanceof Date ? row[T.taken].getTime() : 0;
    const td = row[T.done] instanceof Date ? row[T.done].getTime() : 0;
    if (inPeriod(tc) && task.author) { issued++; const a = ag(task.author); a.issued++; seen(a, tc); }
    if (inPeriod(tt) && task.assignee) { takenN++; const a = ag(task.assignee); a.taken++; seen(a, tt); }
    if (task.status === TS_DONE && inPeriod(td) && task.assignee) {
      doneN++; const a = ag(task.assignee); a.done++; seen(a, td);
      if (tt) { hours += (td - tt) / 3600000; hoursN++; }
    }
    if (task.status === TS_NEW || task.status === TS_WORK) {
      open++;
      if (task.status === TS_WORK && task.assignee) ag(task.assignee).inWork++;
      if (task.due && task.due < today) { overdue++; if (task.assignee) ag(task.assignee).overdue++; }
    }
  });

  const feed = [];
  const lsh = logSheet_();
  const lastLog = lsh.getLastRow();
  if (lastLog >= 2) {
    const n = Math.min(lastLog - 1, 2000);
    const rows = lsh.getRange(lastLog - n + 1, 1, n, LOG_HEADER.length).getValues();
    for (let i = rows.length - 1; i >= 0 && feed.length < 100; i--) {
      const t = rows[i][0] instanceof Date ? rows[i][0].getTime() : 0;
      if (!inPeriod(t)) continue;
      feed.push({ time: new Date(t).toISOString(), agent: String(rows[i][1]), action: String(rows[i][2]),
        id: String(rows[i][3]), details: String(rows[i][4]) });
    }
  }

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
    agents, feed, farMeters: FAR_METERS,
  };
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
