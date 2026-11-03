/**
 * Alina Group — Отработка базы 2ГИС
 * Бэкенд для Google Таблицы. Вставьте этот файл в «Расширения → Apps Script».
 * Меню «Alina 2ГИС» в таблице: загрузка точек, геокодирование, код доступа.
 */

const POINTS_SHEET = 'Точки';
const PHOTO_ROOT = 'Alina 2GIS фото';
const TZ = 'Asia/Almaty';

// Колонки листа «Точки»
const P = {
  id: 0, route: 1, n: 2, name: 3, type: 4, address: 5,
  lat: 6, lon: 7, acc: 8, status: 9, agent: 10, claimed: 11, done: 12,
};
const POINTS_HEADER = ['id', 'Маршрут', '№', 'Точка', 'Тип', 'Адрес',
  'lat', 'lon', 'Точность', 'Статус', 'Агент', 'Взята', 'Выполнена'];

const ST_FREE = 'свободна';
const ST_WORK = 'в работе';
const ST_DONE = 'выполнена';

// Колонки листов «Маршрут N» (результаты)
const RESULT_FIELDS = [
  ['n', '№'], ['name', 'Точка'], ['type', 'Тип'], ['address', 'Адрес'],
  ['agent', 'Агент'], ['time', 'Дата и время'],
  ['contact', 'Контактное лицо'], ['position', 'Должность'],
  ['phone', 'Телефон'], ['whatsapp', 'WhatsApp'], ['instagram', 'Instagram / сайт'],
  ['assortment', 'Ассортимент'], ['competitors', 'Бренды конкурентов'],
  ['supplier', 'Поставщик'], ['alina', 'Работают с Alina'],
  ['interest', 'Интерес'], ['nextStep', 'Итог / следующий шаг'],
  ['comment', 'Комментарий'], ['photos', 'Фото'], ['id', 'id'],
];

/* ---------------- Меню ---------------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Alina 2ГИС')
    .addItem('1. Загрузить точки из routes.json', 'menuImport')
    .addItem('2. Геокодировать адреса', 'geocodeAll')
    .addItem('3. Задать код доступа', 'menuSetCode')
    .addSeparator()
    .addItem('Освободить точки «в работе» старше 24 ч', 'releaseStale')
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

function menuSetCode() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Код доступа', 'Код, который агенты вводят в приложении:', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  PropertiesService.getScriptProperties().setProperty('ACCESS_CODE', res.getResponseText().trim());
  ui.alert('Код сохранён');
}

/* ---------------- Загрузка и геокодирование ---------------- */

/** Добавляет точки, которых ещё нет в листе (статусы существующих не трогает). */
function importRoutes(url) {
  const data = JSON.parse(UrlFetchApp.fetch(url).getContentText('UTF-8'));
  const sh = pointsSheet_();
  const existing = new Set(sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(r => String(r[0])));
  const rows = [];
  data.routes.forEach(r => r.points.forEach(p => {
    if (existing.has(p.id)) return;
    rows.push([p.id, r.route, p.n, p.name, p.type, p.address, '', '', '', ST_FREE, '', '', '']);
  }));
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, POINTS_HEADER.length).setValues(rows);
  data.routes.forEach(r => resultSheet_(r.route));
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
  try { SpreadsheetApp.getActive().toast(msg, 'Alina 2ГИС', 10); } catch (e) {}
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
    SpreadsheetApp.getActive().toast('Освобождено точек: ' + n, 'Alina 2ГИС', 8);
  });
}

/* ---------------- Веб-приложение ---------------- */

function doGet(e) {
  return handle_(() => {
    const q = e.parameter || {};
    checkCode_(q.code);
    if (q.action === 'summary') return summary_();
    if (q.action === 'points') return { points: points_(Number(q.route)) };
    if (q.action === 'ping') return { ok: true };
    throw new Error('Неизвестное действие');
  });
}

function doPost(e) {
  return handle_(() => {
    const body = JSON.parse(e.postData.contents);
    checkCode_(body.code);
    const agent = String(body.agent || '').trim();
    if (!agent) throw new Error('Не указано имя агента');
    if (body.action === 'claim') return withLock_(() => claim_(body.id, agent));
    if (body.action === 'release') return withLock_(() => release_(body.id, agent));
    if (body.action === 'complete') return withLock_(() => complete_(body.id, agent, body.form || {}, body.photos || []));
    throw new Error('Неизвестное действие');
  });
}

function handle_(fn) {
  let out;
  try { out = Object.assign({ ok: true }, fn()); }
  catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function checkCode_(code) {
  const expected = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE');
  if (expected && String(code || '').trim() !== expected) throw new Error('Неверный код доступа');
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function allPoints_() {
  const sh = pointsSheet_();
  const last = sh.getLastRow();
  if (last < 2) return { sh, values: [] };
  return { sh, values: sh.getRange(2, 1, last - 1, POINTS_HEADER.length).getValues() };
}

function toPoint_(row) {
  return {
    id: String(row[P.id]), route: Number(row[P.route]), n: Number(row[P.n]),
    name: String(row[P.name]), type: String(row[P.type]), address: String(row[P.address]),
    lat: row[P.lat] === '' ? null : Number(row[P.lat]),
    lon: row[P.lon] === '' ? null : Number(row[P.lon]),
    acc: String(row[P.acc] || ''),
    status: String(row[P.status] || ST_FREE), agent: String(row[P.agent] || ''),
  };
}

function summary_() {
  const by = {};
  allPoints_().values.forEach(row => {
    const r = Number(row[P.route]);
    by[r] = by[r] || { route: r, total: 0, free: 0, work: 0, done: 0 };
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
  return { point: toPoint_(row) };
}

function release_(id, agent) {
  const { sh, rowIndex, row } = findRow_(id);
  if (row[P.status] !== ST_WORK || row[P.agent] !== agent) throw new Error('Эта точка не у вас в работе');
  sh.getRange(rowIndex, P.status + 1, 1, 3).setValues([[ST_FREE, '', '']]);
  row[P.status] = ST_FREE; row[P.agent] = '';
  return { point: toPoint_(row) };
}

function complete_(id, agent, form, photos) {
  const { sh, rowIndex, row } = findRow_(id);
  const status = row[P.status] || ST_FREE;
  if (status === ST_DONE) throw new Error('Точка уже выполнена (' + row[P.agent] + ')');
  if (status === ST_WORK && row[P.agent] !== agent) throw new Error('Точку уже взял(а): ' + row[P.agent]);

  const route = Number(row[P.route]);
  const now = new Date();
  const photoLinks = savePhotos_(route, row, photos, now);
  const rec = Object.assign({}, form, {
    n: row[P.n], name: row[P.name], type: row[P.type], address: row[P.address],
    agent: agent, time: Utilities.formatDate(now, TZ, 'dd.MM.yyyy HH:mm'),
    photos: photoLinks.join('\n'), id: row[P.id],
  });
  ['assortment', 'competitors'].forEach(k => { if (Array.isArray(rec[k])) rec[k] = rec[k].join(', '); });

  const rs = resultSheet_(route);
  const values = RESULT_FIELDS.map(f => rec[f[0]] == null ? '' : String(rec[f[0]]));
  const target = rs.getRange(rs.getLastRow() + 1, 1, 1, values.length);
  target.setNumberFormat('@').setValues([values]);

  sh.getRange(rowIndex, P.status + 1, 1, 4).setValues([[ST_DONE, agent, row[P.claimed] || now, now]]);
  row[P.status] = ST_DONE; row[P.agent] = agent;
  return { point: toPoint_(row), photos: photoLinks.length };
}

function savePhotos_(route, row, photos, now) {
  if (!photos.length) return [];
  const folder = subFolder_(subFolder_(DriveApp.getRootFolder(), PHOTO_ROOT), 'Маршрут ' + route);
  const stamp = Utilities.formatDate(now, TZ, 'yyyyMMdd-HHmm');
  return photos.slice(0, 6).map((p, i) => {
    const base64 = String(p.data || '').replace(/^data:[^,]+,/, '');
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/jpeg',
      row[P.id] + ' ' + String(row[P.name]).slice(0, 40) + ' ' + stamp + '-' + (i + 1) + '.jpg');
    const file = folder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
    return file.getUrl();
  });
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
      .setFontWeight('bold').setBackground('#fde7d9');
    sh.setFrozenRows(1);
  }
  return sh;
}

function subFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
