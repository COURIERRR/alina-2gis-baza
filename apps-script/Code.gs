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
  phone: 13, whatsapp: 14, gis: 15, visits: 16, last: 17, added: 18,
  closedReason: 19, closedNote: 20, closedBy: 21, closedAt: 22, closedGps: 23, addedAt: 24,
  zone: 25, zoneN: 26,
};
const POINTS_HEADER = ['id', 'Маршрут', '№', 'Точка', 'Тип', 'Адрес',
  'lat', 'lon', 'Точность', 'Статус', 'Агент', 'Взята', 'Выполнена',
  'Телефон', 'WhatsApp', 'Ссылка 2ГИС', 'Визитов', 'Последний визит', 'Добавил',
  'Причина закрытия', 'Комментарий к закрытию', 'Кто отметил', 'Когда отметили', 'GPS отметки', 'Добавлена', 'Зона', '№ в зоне'];
const NEW_POINTS_TITLE = 'Новые точки'; // маршрут для точек, которые агенты добавляют с места

const ST_FREE = 'свободна';
const ST_WORK = 'в работе';
const ST_DONE = 'выполнена';
const ST_CLOSED = 'закрыта'; // точка не работает: в отдельном списке, в расчёт АКБ не входит
const CLOSED_COLOR = '#f8d7da';

// Ежедневный отчёт на почту. Адрес получателя — в свойствах скрипта (меню таблицы), не в репозитории
const REPORT_SUBJECT = 'Отчёт МТ с приложения';
const REPORT_HOUR = 16;
const REPORT_FOLDER = 'Отчёты МТ';

// Колонки листов «Маршрут N» (визиты, по строке на визит)
const RESULT_FIELDS = [
  ['n', '№'], ['name', 'Точка'], ['type', 'Тип'], ['address', 'Адрес'],
  ['agent', 'Агент'], ['time', 'Дата и время'],
  ['contact', 'Контактное лицо'], ['position', 'Должность'],
  ['phone', 'Телефон'], ['whatsapp', 'WhatsApp'], ['instagram', 'Instagram / сайт'],
  ['assortment', 'Ассортимент'], ['competitors', 'Бренды конкурентов'],
  ['supplier', 'Поставщик'], ['alina', 'Работаем / Не работаем'], ['ourBrands', 'Наши бренды в точке'],
  ['interest', 'Интерес'], ['nextStep', 'Итог / следующий шаг'], ['nextDate', 'Дата след. шага'],
  ['comment', 'Комментарий'], ['photos', 'Фото'],
  ['visit', 'Визит №'], ['gps', 'GPS агента'], ['distance', 'До точки, м'],
  ['id', 'id'], ['uid', 'uid'],
].concat(extraFields_());

const RENAMED_COLUMNS = { 'Работают с Alina': 'Работаем / Не работаем' };

// Поля шаблона оценки ТТ. Ключи совпадают с именами полей анкеты в app.js
function extraFields_() {
  const EQUIP = ['FAWORI', 'Alina Paint', 'AlinEX', 'V-tech'];
  const KO = ['Alina', 'FAWORI', 'Радуга', 'Dulux', 'Tikkurila', 'Собственное', 'Другие'];
  const BRANDING = ['FAWORI', 'Alina Paint', 'V-tech', 'AlinEX', 'НАШИ'];
  const PAINT = ['Dulux', 'Tikkurila', 'Marshall', 'Raduga', 'Belly Dom', 'Decorex', 'Fawori', 'Alina', 'Другие'];
  const SSS = ['AlinEX', 'НАШИ', 'Волма', 'Другие'];
  const SEAL = ['V-tech', 'Tytan', 'VGT', 'Другие'];
  const nums = (prefix, title, names) => names.map(n => [prefix + ':' + n, title + ': ' + n, 'num']);
  return [].concat(
    [['score', 'Баллы ТТ', 'num'], ['manager', 'АК Alina Group'], ['format', 'Формат ТТ'],
      ['formatDesc', 'Описание формата'], ['payment', 'Условия оплаты'],
      ['traffic', 'Проходимость и расположение'], ['ready', 'Готовность работать с Alina Group'],
      ['areaHall', 'Торговый зал, м2', 'num'], ['areaStock', 'Склад, м2', 'num']],
    nums('shelf', 'Полки, шт', EQUIP), nums('end', 'Торцы, шт', EQUIP), nums('ko', 'КО, шт', KO),
    BRANDING.map(n => ['brand:' + n, 'Брендинг: ' + n]),
    nums('fVdk', 'Фейсы ВДК', PAINT), nums('fAlk', 'Фейсы алкиды', PAINT),
    nums('pSss', 'Паллеты ССС', SSS), nums('fGrout', 'Фейсы затирки', SSS),
    nums('fSeal', 'Фейсы герметики', SEAL), nums('fFoam', 'Фейсы пены', SEAL),
    [['sPaint', 'Продажи за год: краски, тенге', 'num'], ['shareVdk', 'Краски: доля ВДК, %', 'num'],
      ['shareAlk', 'Краски: доля алкидов, %', 'num']],
    nums('dVdk', 'Доля в ВДК, %', PAINT), nums('dAlk', 'Доля в алкидах, %', PAINT),
    [['sSss', 'Продажи за год: ССС, тенге', 'num'], ['shareSss', 'ССС: доля без затирок, %', 'num'],
      ['shareGrout', 'ССС: доля затирок, %', 'num']],
    nums('dSss', 'Доля в ССС, %', SSS), nums('dGrout', 'Доля в затирках, %', SSS),
    [['sSeal', 'Продажи за год: герметики и пены, тенге', 'num'], ['shareSeal', 'Доля герметиков, %', 'num'],
      ['shareFoam', 'Доля пен, %', 'num']],
    nums('dSeal', 'Доля в герметиках, %', SEAL), nums('dFoam', 'Доля в пенах, %', SEAL),
    [['masterClasses', 'Мастер-классов ОТЭК за год', 'num'], ['billboardCount', 'Билборды: кол-во', 'num'],
      ['billboardAddr', 'Билборды: адрес'], ['billboardContact', 'Билборды: контакт']]
  );
}

// Шкалы баллов из шаблона оценки ТТ (лист DATA): [нижняя граница, баллы]
const SCORE_SALES_LKP = [[30e6, 7], [50e6, 12], [100e6, 25], [300e6, 76], [500e6, 127]];
const SCORE_SALES_SSS = [[30e6, 11], [50e6, 19], [100e6, 38], [300e6, 116], [500e6, 193]];
const SCORE_SALES_SEAL = [[30e6, 2], [50e6, 4], [100e6, 9], [300e6, 27], [500e6, 45]];
const SCORE_ASSORTMENT = [[50, 6], [100, 12], [300, 38], [500, 64], [1000, 128]];
const SCORE_AREA = [[100, 1], [500, 7], [1000, 15], [3000, 46], [5000, 78]];
const SCORE_TRAFFIC = { 'Слабая': 1, 'Средняя': 7, 'Высокая': 11 };
const SCORE_READY = { 'Да': 10 };

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
    .addSeparator()
    .addItem('Рассчитать новые маршруты (черновик)', 'menuZonesBuild')
    .addItem('Адрес для ежедневного отчёта…', 'menuReportTo')
    .addToUi();
}

function menuReportTo() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const res = ui.prompt('Ежедневный отчёт', 'Куда отправлять. Сейчас: ' + (props.getProperty('REPORT_TO') || 'не задано'), ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const to = res.getResponseText().trim();
  if (to) props.setProperty('REPORT_TO', to);
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

/** Только черновик: заполняет колонки «Зона» и «№ в зоне», агенты продолжают видеть старые маршруты. */
function menuZonesBuild() {
  const z = zonesBuild_();
  const lines = z.titles.map((title, i) => 'Маршрут ' + (i + 1) + ' (' + title + '): ' + z.points.filter(p => p.zone === i + 1).length);
  SpreadsheetApp.getUi().alert('Черновик рассчитан. В приложении ничего не изменилось.\n\n' + lines.join('\n') +
    '\nБез зоны: ' + z.points.filter(p => !p.zone).length);
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
      p.phone || '', p.whatsapp || '', p.gis || '', '', '', '', '', '', '', '', '', '', '', '']);
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
    if (q.action === 'point') return { point: toPoint_(findRow_(q.id).row) };
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
      case 'pointAdd': return withLock_(() => pointAdd_(agent, body.point || {}));
      case 'pointClose': return withLock_(() => pointClose_(agent, body.id, body));
      case 'pointReopen': return withLock_(() => pointReopen_(me, body.id));
      case 'report': requireManager_(me); return { report: cached_('report:' + body.date, 300, () => dayReport_(String(body.date))) };
      case 'reportSend': requireManager_(me); return reportSend_(me.name, String(body.date));
      case 'addrAt': return { address: addrAt_(body.lat, body.lon) };
      case 'pos': return pos_(me, body.geo); // без блокировки и сброса кэша: приходит часто и данных точек не меняет
      case 'positions': requireManager_(me); return { positions: positions_() };
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
      case 'zones': requireManager_(me); return { zones: zonesPreview_() };
      case 'zonesBuild': requireManager_(me); return { zones: zonesBuild_() };
      case 'zoneSet': requireManager_(me); return { zones: withLock_(() => zoneSet_(me.name, body.id, body.zone)) };
      case 'zonesEnable': requireManager_(me); return { zones: withLock_(() => zonesEnable_(me.name, !!body.on)) };
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
    zv: PropertiesService.getScriptProperties().getProperty('ZONES_VER') || '',
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
const visitsOf_ = (row) => Number(row[P.visits]) || (row[P.status] === ST_DONE || row[P.done] ? 1 : 0);

function toPoint_(row) {
  return {
    // Маршрут и № для показа: при включённых зонах — из зоны. id и старый маршрут (origin) не меняются
    id: String(row[P.id]), route: effRoute_(row), origin: Number(row[P.route]),
    n: zonesOn_() && Number(row[P.zoneN]) ? Number(row[P.zoneN]) : Number(row[P.n]),
    name: String(row[P.name]), type: String(row[P.type]), address: String(row[P.address]),
    lat: row[P.lat] === '' ? null : Number(row[P.lat]),
    lon: row[P.lon] === '' ? null : Number(row[P.lon]),
    acc: String(row[P.acc] || ''),
    status: String(row[P.status] || ST_FREE), agent: String(row[P.agent] || ''),
    phone: String(row[P.phone] || ''), whatsapp: String(row[P.whatsapp] || ''), gis: String(row[P.gis] || ''),
    visits: visitsOf_(row), lastVisit: fmt_(row[P.last] || row[P.done]), added: String(row[P.added] || ''),
    closedReason: String(row[P.closedReason] || ''), closedNote: String(row[P.closedNote] || ''),
    closedBy: String(row[P.closedBy] || ''), closedAt: fmt_(row[P.closedAt]),
  };
}

/** Точка не работает: меняются только статус и колонки отметки, визиты и анкеты остаются. */
function pointClose_(agent, id, f) {
  const reason = String(f.reason || '').trim();
  if (!reason) fail_('Укажите причину');
  const { sh, rowIndex, row } = findRow_(id);
  if (row[P.status] === ST_CLOSED) fail_('Точка уже отмечена как нерабочая (' + row[P.closedBy] + ')');
  const note = String(f.comment || '').trim();
  const now = new Date();
  const gps = gpsText_(f.geo);
  sh.getRange(rowIndex, P.closedReason + 1, 1, 3).setNumberFormat('@').setValues([[reason, note, agent]]);
  sh.getRange(rowIndex, P.closedAt + 1, 1, 2).setValues([[now, gps]]);
  sh.getRange(rowIndex, P.status + 1).setValue(ST_CLOSED);
  sh.getRange(rowIndex, 1, 1, POINTS_HEADER.length).setBackground(CLOSED_COLOR);
  row[P.status] = ST_CLOSED; row[P.closedReason] = reason; row[P.closedNote] = note;
  row[P.closedBy] = agent; row[P.closedAt] = now; row[P.closedGps] = gps;
  log_(agent, 'отметил нерабочей', id, row[P.name] + ' · ' + reason + (note ? ' · ' + note : ''));
  return { point: toPoint_(row) };
}

function clearClosed_(sh, rowIndex, row) {
  sh.getRange(rowIndex, P.closedReason + 1, 1, 5).setValues([['', '', '', '', '']]);
  sh.getRange(rowIndex, 1, 1, POINTS_HEADER.length).setBackground(null);
  [P.closedReason, P.closedNote, P.closedBy, P.closedAt, P.closedGps].forEach(k => { row[k] = ''; });
}

/** Вернуть точку в работу: отметивший или руководитель. Статус — как был по визитам. */
function pointReopen_(me, id) {
  const { sh, rowIndex, row } = findRow_(id);
  if (row[P.status] !== ST_CLOSED) fail_('Точка не отмечена как нерабочая');
  if (me.role !== ROLE_MANAGER && nameKey_(row[P.closedBy]) !== nameKey_(me.name)) {
    fail_('Вернуть точку может ' + row[P.closedBy] + ' или руководитель');
  }
  const next = visitsOf_(row) ? ST_DONE : ST_FREE;
  sh.getRange(rowIndex, P.status + 1).setValue(next);
  row[P.status] = next;
  if (next === ST_FREE) {
    // До отметки точка могла быть у кого-то в работе — теперь она снова свободна
    sh.getRange(rowIndex, P.agent + 1, 1, 2).setValues([['', '']]);
    row[P.agent] = ''; row[P.claimed] = '';
  }
  clearClosed_(sh, rowIndex, row);
  log_(me.name, 'вернул точку в работу', id, row[P.name]);
  return { point: toPoint_(row) };
}

/** Новая точка с места: всегда новая строка в конце листа и в маршруте «Новые точки», остальные точки не меняются. */
function pointAdd_(agent, f) {
  const name = String(f.name || '').trim();
  const address = String(f.address || '').trim();
  if (!name) fail_('Укажите название точки');
  if (!address) fail_('Укажите адрес точки');
  const lat = Number(f.lat), lon = Number(f.lon);
  const has = f.lat != null && f.lon != null && isFinite(lat) && isFinite(lon);
  const { sh, values } = allPoints_();
  const props = PropertiesService.getScriptProperties();
  let route = Number(props.getProperty('NEW_POINTS_ROUTE'));
  if (!route) {
    route = values.reduce((m, r) => Math.max(m, Number(r[P.route]) || 0), 0) + 1;
    props.setProperty('NEW_POINTS_ROUTE', String(route));
    const titles = JSON.parse(props.getProperty('ROUTE_TITLES') || '{}');
    titles[route] = NEW_POINTS_TITLE;
    props.setProperty('ROUTE_TITLES', JSON.stringify(titles));
  }
  const inRoute = values.filter(r => Number(r[P.route]) === route);
  // Повторная отправка (ответ потерялся) не создаёт дубль
  const same = inRoute.find(r => String(r[P.name]) === name && String(r[P.address]) === address);
  if (same) return { point: toPoint_(same) };
  const n = inRoute.reduce((m, r) => Math.max(m, Number(r[P.n]) || 0), 0) + 1;
  const id = 'R' + route + '-' + String(n).padStart(3, '0');
  const row = [id, route, n, name, String(f.type || '').trim(), address,
    has ? lat : '', has ? lon : '', has ? 'точно' : '', ST_FREE, '', '', '',
    String(f.phone || '').trim(), '', '', '', '', agent, '', '', '', '', '', new Date(), '', ''];
  // При включённых зонах новая точка сразу попадает в ближайший район — маршрутов остаётся 6
  if (zonesOn_() && has) {
    const z = nearestZone_(lat, lon);
    if (z) { row[P.zone] = z; row[P.zoneN] = values.reduce((m, r) => Number(r[P.zone]) === z ? Math.max(m, Number(r[P.zoneN]) || 0) : m, 0) + 1; }
  }
  const range = sh.getRange(sh.getLastRow() + 1, 1, 1, POINTS_HEADER.length);
  range.offset(0, P.phone, 1, 2).setNumberFormat('@');
  range.setValues([row]);
  resultSheet_(route);
  log_(agent, 'добавил точку', id, name + ' · ' + address);
  return { point: toPoint_(row) };
}

/** Адрес по координатам телефона. Пусто, если адрес не определился — агент введёт его вручную. */
function addrAt_(lat, lon) {
  const la = Number(lat), lo = Number(lon);
  if (!isFinite(la) || !isFinite(lo)) fail_('Нет координат');
  const r = Maps.newGeocoder().setLanguage('ru').setRegion('kz').reverseGeocode(la, lo);
  const best = r.status === 'OK' && (r.results || []).find(x => (x.types || []).indexOf('plus_code') < 0);
  if (!best) return '';
  return String(best.formatted_address || '')
    .replace(/,?\s*Казахстан\s*$/i, '').replace(/,?\s*\b\d{6}\b/g, '').trim();
}

/* ---------------- Местоположение сотрудников ----------------
 * Последняя позиция каждого хранится в свойствах скрипта: приходит часто, в таблицы не пишется и точек не касается. */
const POS_PREFIX = 'pos:';

function pos_(me, geo) {
  const lat = Number(geo && geo.lat), lon = Number(geo && geo.lon);
  if (!geo || geo.lat == null || geo.lon == null || !isFinite(lat) || !isFinite(lon)) return {};
  PropertiesService.getScriptProperties().setProperty(POS_PREFIX + nameKey_(me.name), JSON.stringify({
    name: me.name, lat, lon, acc: Math.round(Number(geo.acc)) || 0, t: nowIso_(),
  }));
  return {};
}

function positions_() {
  const active = {};
  cached_('staff', 600, staff_).forEach(s => { if (s.status !== ST_BLOCKED) active[nameKey_(s.name)] = true; });
  const all = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(all)
    .filter(k => k.indexOf(POS_PREFIX) === 0 && active[k.slice(POS_PREFIX.length)])
    .map(k => JSON.parse(all[k]));
}

function summary_() {
  const by = {};
  const props = PropertiesService.getScriptProperties();
  const titles = Object.assign(JSON.parse(props.getProperty('ROUTE_TITLES') || '{}'),
    zonesOn_() ? JSON.parse(props.getProperty('ZONE_TITLES') || '{}') : {});
  allPoints_().values.forEach(row => {
    const r = effRoute_(row);
    by[r] = by[r] || { route: r, title: titles[r] || '', total: 0, free: 0, work: 0, done: 0, closed: 0 };
    by[r].total++;
    const s = row[P.status] || ST_FREE;
    if (s === ST_DONE) by[r].done++; else if (s === ST_WORK) by[r].work++; else if (s === ST_CLOSED) by[r].closed++; else by[r].free++;
  });
  return { routes: Object.keys(by).sort((a, b) => a - b).map(k => by[k]) };
}

function points_(route) {
  const list = allPoints_().values.filter(row => effRoute_(row) === route).map(toPoint_);
  return zonesOn_() ? list.sort((a, b) => a.n - b.n) : list;
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
  if (status === ST_CLOSED) throw new Error('Точка отмечена как нерабочая (' + row[P.closedBy] + ')');
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

  const rs = resultSheet_(route);
  writeResult_(rs.getRange(rs.getLastRow() + 1, 1, 1, RESULT_FIELDS.length), rec);

  const claimed = status === ST_DONE ? row[P.claimed] : (row[P.claimed] || now);
  // Анкета могла ждать связи, пока точку отметили нерабочей: визит важнее, отметка снимается
  const firstDone = status === ST_DONE || status === ST_CLOSED ? (row[P.done] || now) : now;
  sh.getRange(rowIndex, P.status + 1, 1, 4).setValues([[ST_DONE, agent, claimed, firstDone]]);
  sh.getRange(rowIndex, P.visits + 1, 1, 2).setValues([[visit, now]]);
  if (status === ST_CLOSED) clearClosed_(sh, rowIndex, row);
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

/** Числа пишутся числами (агент может ввести «40 000 000» или «12,5»), остальное — текстом. */
function toNum_(v) {
  const s = String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.');
  if (s === '') return '';
  const n = Number(s);
  return isNaN(n) ? String(v) : n;
}

function writeResult_(range, rec) {
  Object.keys(rec).forEach(k => { if (Array.isArray(rec[k])) rec[k] = rec[k].join(', '); });
  rec.score = score_(rec);
  const isNum = f => f[2] === 'num';
  range.setNumberFormats([RESULT_FIELDS.map(f => isNum(f) ? 'General' : '@')]);
  range.setValues([RESULT_FIELDS.map(f => isNum(f) ? toNum_(rec[f[0]]) : (rec[f[0]] == null ? '' : String(rec[f[0]])))]);
}

/** Сумма баллов по шаблону оценки ТТ; пусто, если данных для оценки в анкете нет. */
function score_(rec) {
  const num = k => { const n = toNum_(rec[k]); return typeof n === 'number' ? n : 0; };
  const band = (v, table) => table.reduce((p, t) => (v >= t[0] ? t[1] : p), 0);
  const faces = RESULT_FIELDS.filter(f => /^(fVdk|fAlk|pSss|fGrout|fSeal|fFoam):/.test(f[0]))
    .reduce((sum, f) => sum + num(f[0]), 0);
  const area = num('areaHall') + num('areaStock');
  if (!faces && !area && !num('sPaint') && !num('sSss') && !num('sSeal') && !rec.traffic && !rec.ready) return '';
  return band(num('sPaint'), SCORE_SALES_LKP) + band(num('sSss'), SCORE_SALES_SSS) + band(num('sSeal'), SCORE_SALES_SEAL) +
    band(faces, SCORE_ASSORTMENT) + band(area, SCORE_AREA) + (SCORE_TRAFFIC[rec.traffic] || 0) + (SCORE_READY[rec.ready] || 0);
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
  writeResult_(res.rs.getRange(res.rowIndex, 1, 1, RESULT_FIELDS.length), rec);
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

/* ---------------- Отчёт за день: экран руководителя и письмо ---------------- */

/** Разделы анкеты для показа: только заполненные поля, понятными группами. */
function visitSections_(r) {
  const groupOf = (k) => {
    if (/^(contact|position|phone|whatsapp|instagram)$/.test(k)) return 'Контакты';
    if (/^(alina|manager|format|formatDesc|payment|traffic|ready|areaHall|areaStock)$/.test(k)) return 'Точка и помещение';
    if (/^(assortment|competitors|ourBrands|supplier)$/.test(k)) return 'Ассортимент и бренды';
    if (/^(shelf|end|ko):/.test(k)) return 'Оборудование';
    if (/^brand:/.test(k)) return 'Брендинг';
    if (/^(fVdk|fAlk|pSss|fGrout|fSeal|fFoam):/.test(k)) return 'Полка и склад';
    if (/^(sPaint|shareVdk|shareAlk|sSss|shareSss|shareGrout|sSeal|shareSeal|shareFoam)$|^(dVdk|dAlk|dSss|dGrout|dSeal|dFoam):/.test(k)) return 'Продажи за год';
    if (/^(billboardCount|billboardAddr|billboardContact|masterClasses)$/.test(k)) return 'Билборды и мастер-классы';
    if (/^(interest|nextStep|nextDate|comment|score)$/.test(k)) return 'Итог';
    return '';
  };
  const order = ['Итог', 'Контакты', 'Точка и помещение', 'Ассортимент и бренды', 'Оборудование', 'Брендинг', 'Полка и склад', 'Продажи за год', 'Билборды и мастер-классы'];
  const by = {};
  RESULT_FIELDS.forEach(f => {
    const g = groupOf(f[0]);
    const v = String(r[f[0]] == null ? '' : r[f[0]]).trim();
    if (g && v) (by[g] = by[g] || []).push([f[1], v]);
  });
  return order.filter(g => by[g]).map(g => ({ title: g, fields: by[g] }));
}

const hmIn_ = (t) => Utilities.formatDate(new Date(t), TZ, 'HH:mm');
const parseTime_ = (v) => v instanceof Date ? v.getTime() : (Date.parse(String(v || '')) || 0);

/** Всё за календарный день (по Алматы): по сотрудникам, с хронологией визитов и откуда человек приехал. */
function dayReport_(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail_('Неверная дата');
  const from = Utilities.parseDate(date + ' 00:00', TZ, 'yyyy-MM-dd HH:mm').getTime();
  const to = from + 86400000;
  const inDay = (t) => t >= from && t < to;
  // В отчёте — маршрут и № точки, какие сейчас видят агенты
  const shownById = {};
  allPoints_().values.forEach(r => { const s = toPoint_(r); shownById[s.id] = s; });
  const by = {};
  const ag = (name) => {
    const k = nameKey_(name);
    return by[k] || (by[k] = { name: String(name), goal: 0, start: '', end: '', startPos: null, visits: 0, newPoints: 0, repeat: 0,
      far: 0, noGps: 0, closed: 0, added: 0, issued: 0, taken: 0, done: 0, first: '', last: '', items: [] });
  };
  staff_().filter(s => s.status !== ST_BLOCKED).forEach(s => ag(s.name));

  const dsh = daySheet_();
  const dLast = dsh.getLastRow();
  (dLast < 2 ? [] : dsh.getRange(2, 1, dLast - 1, DAY_HEADER.length).getValues())
    .filter(r => String(r[D.date]) === date).forEach(r => {
      Object.assign(ag(r[D.agent]), dayOut_(r), { startPos: parseGps_(r[D.startGps]) });
    });

  const visits = allVisits_().filter(v => v.agent && inDay(v.t));
  visits.sort((a, b) => a.t - b.t);
  visits.forEach(v => {
    const a = ag(v.agent);
    const pos = parseGps_(v.gps);
    const prev = a.items[a.items.length - 1];
    const fromPos = prev ? prev.pos : a.startPos;
    const fromT = prev ? prev.t : parseTime_(a.start);
    const isNew = !(Number(v.visit) > 1);
    const far = v.gps && v.distance !== '' && Number(v.distance) > FAR_METERS;
    a.visits++;
    if (isNew) a.newPoints++; else a.repeat++;
    if (far) a.far++;
    if (!v.gps) a.noGps++;
    a.first = a.first || hmIn_(v.t);
    a.last = hmIn_(v.t);
    a.items.push({
      id: v.id, route: (shownById[v.id] || {}).route || '', n: (shownById[v.id] || v).n, name: v.name, type: v.type, address: v.address,
      time: hmIn_(v.t), t: v.t, visit: Number(v.visit) || 1, gps: v.gps, distance: v.distance === '' ? null : Number(v.distance), far: !!far,
      from: prev ? prev.name : (a.start ? 'Начало дня' : ''),
      fromMin: fromT && v.t >= fromT ? Math.round((v.t - fromT) / 60000) : null,
      fromKm: pos && fromPos ? Math.round(meters_(fromPos.lat, fromPos.lon, pos.lat, pos.lon) / 100) / 10 : null,
      pos, interest: v.interest, alina: v.alina, contact: v.contact, position: v.position, phone: v.phone, whatsapp: v.whatsapp,
      assortment: v.assortment, competitors: v.competitors, ourBrands: v.ourBrands, nextStep: v.nextStep, nextDate: v.nextDate,
      comment: v.comment, score: v.score, photos: String(v.photos || '').split(/\s+/).filter(Boolean), sections: visitSections_(v),
    });
  });

  const closed = [];
  const added = [];
  allPoints_().values.forEach(row => {
    const ct = parseTime_(row[P.closedAt]);
    if (ct && inDay(ct)) {
      closed.push({ id: String(row[P.id]), route: effRoute_(row), n: toPoint_(row).n, name: String(row[P.name]), address: String(row[P.address]),
        reason: String(row[P.closedReason]), note: String(row[P.closedNote]), by: String(row[P.closedBy]), time: hmIn_(ct), gps: String(row[P.closedGps] || ''), t: ct });
      ag(row[P.closedBy]).closed++;
    }
    const at = parseTime_(row[P.addedAt]);
    if (at && inDay(at)) {
      added.push({ id: String(row[P.id]), route: effRoute_(row), name: String(row[P.name]), type: String(row[P.type]), address: String(row[P.address]),
        phone: String(row[P.phone] || ''), by: String(row[P.added] || ''), time: hmIn_(at), t: at, status: String(row[P.status] || ST_FREE) });
      if (row[P.added]) ag(row[P.added]).added++;
    }
  });
  closed.sort((a, b) => a.t - b.t);
  added.sort((a, b) => a.t - b.t);

  const tasks = [];
  allTasks_().values.forEach(row => {
    const t = toTask_(row);
    const tc = parseTime_(row[T.created]), tt = parseTime_(row[T.taken]), td = parseTime_(row[T.done]);
    if (!inDay(tc) && !inDay(tt) && !inDay(td)) return;
    if (inDay(tc) && t.author) ag(t.author).issued++;
    if (inDay(tt) && t.assignee) ag(t.assignee).taken++;
    if (inDay(td) && t.status === TS_DONE && t.assignee) ag(t.assignee).done++;
    tasks.push({ id: t.id, point: t.point, name: t.name, address: t.address, type: t.type, comment: t.comment, due: t.due, status: t.status,
      author: t.author, assignee: t.assignee, result: t.result || '',
      created: inDay(tc) ? hmIn_(tc) : '', taken: inDay(tt) ? hmIn_(tt) : '', done: inDay(td) ? hmIn_(td) : '' });
  });

  const agents = Object.keys(by).map(k => by[k]).map(a => {
    a.items.forEach(i => { delete i.pos; });
    a.closedItems = closed.filter(c => nameKey_(c.by) === nameKey_(a.name));
    a.addedItems = added.filter(c => nameKey_(c.by) === nameKey_(a.name));
    return a;
  }).sort((a, b) => b.visits - a.visits || b.closed - a.closed || a.name.localeCompare(b.name));
  const sum = (k) => agents.reduce((s, a) => s + a[k], 0);
  const routes = summary_().routes;
  const rsum = (k) => routes.reduce((s, r) => s + r[k], 0);
  const out = {
    date, label: Utilities.formatDate(new Date(from), TZ, 'dd.MM.yyyy'), agents, closed, added, tasks,
    totals: { visits: sum('visits'), newPoints: sum('newPoints'), repeat: sum('repeat'), far: sum('far'), noGps: sum('noGps'),
      closed: closed.length, added: added.length, issued: sum('issued'), taken: sum('taken'), done: sum('done') },
    akb: { total: rsum('total'), done: rsum('done'), work: rsum('work'), free: rsum('free'), closed: rsum('closed') },
  };
  out.active = !!(out.totals.visits || closed.length || added.length || tasks.length);
  return out;
}

/** Исходные строки анкет за день — для листа «Анкеты полностью». */
function dayVisitsRaw_(date) {
  const from = Utilities.parseDate(date + ' 00:00', TZ, 'yyyy-MM-dd HH:mm').getTime();
  return allVisits_().filter(v => v.agent && v.t >= from && v.t < from + 86400000).sort((a, b) => a.t - b.t);
}

function dayLog_(date) {
  const from = Utilities.parseDate(date + ' 00:00', TZ, 'yyyy-MM-dd HH:mm').getTime();
  const sh = logSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const n = Math.min(last - 1, 5000);
  return sh.getRange(last - n + 1, 1, n, LOG_HEADER.length).getValues().filter(r => {
    const t = parseTime_(r[0]);
    return t >= from && t < from + 86400000;
  });
}

/** Лист отчёта: columns — [заголовок, ширина, тип]; тип 'n' — число, 'f' — формула, иначе текст. */
function reportSheet_(ss, title, columns, rows, opts) {
  const o = opts || {};
  const sh = o.sheet || ss.insertSheet(title);
  sh.setName(title);
  const top = o.top || 1;
  const n = columns.length;
  if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
  if (sh.getMaxRows() < top + rows.length + 2) sh.insertRowsAfter(sh.getMaxRows(), top + rows.length + 2 - sh.getMaxRows());
  sh.getRange(top, 1, 1, n).setValues([columns.map(c => c[0])])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#2a3b7e').setWrap(true).setVerticalAlignment('middle');
  columns.forEach((c, i) => sh.setColumnWidth(i + 1, c[1] || 120));
  if (rows.length) {
    const range = sh.getRange(top + 1, 1, rows.length, n);
    range.setNumberFormats(rows.map(() => columns.map(c => c[2] === 'n' || c[2] === 'f' ? 'General' : '@')));
    range.setValues(rows).setWrap(true).setVerticalAlignment('top');
    sh.getRange(top, 1, rows.length + 1, n).createFilter();
  } else {
    sh.getRange(top + 1, 1).setValue('За этот день нет данных').setFontColor('#777777');
  }
  sh.setFrozenRows(top);
  return sh;
}

function buildReportBlob_(date) {
  const rep = dayReport_(date);
  const ss = SpreadsheetApp.create('Отчёт МТ ' + rep.label);
  const fileId = ss.getId();
  try {
    ss.setSpreadsheetTimeZone(TZ);
    const dur = (a) => {
      const s = parseTime_(a.start), e = parseTime_(a.end);
      if (!s || !e) return '';
      const m = Math.max(0, Math.round((e - s) / 60000));
      return Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин';
    };
    const tm = (iso) => { const t = parseTime_(iso); return t ? hmIn_(t) : ''; };

    // Сводка: шапка с АКБ, затем строка на сотрудника и итог
    const summary = ss.getSheets()[0];
    summary.setName('Сводка');
    const active = rep.akb.total - rep.akb.closed;
    const pct = active ? Math.round(rep.akb.done / active * 1000) / 10 : 0;
    summary.getRange(1, 1, 3, 1).setValues([['Отчёт МТ за ' + rep.label],
      ['АКБ на момент отчёта: выполнено ' + rep.akb.done + ' из ' + active + ' рабочих точек (' + String(pct).replace('.', ',') + '%) · в работе ' + rep.akb.work +
        ' · свободно ' + rep.akb.free + ' · не работают ' + rep.akb.closed + ' · загружено всего ' + rep.akb.total],
      ['За день: посещено точек ' + rep.totals.visits + ' (новых ' + rep.totals.newPoints + ', повторных ' + rep.totals.repeat + ') · нерабочих отмечено ' + rep.totals.closed +
        ' · новых адресов ' + rep.totals.added + ' · заданий выполнено ' + rep.totals.done]]);
    summary.getRange(1, 1).setFontWeight('bold').setFontSize(14);
    const sumRows = rep.agents.map(a => [a.name, tm(a.start), tm(a.end), dur(a), a.goal || '', a.visits, a.newPoints, a.repeat, a.first, a.last,
      a.far, a.noGps, a.closed, a.added, a.issued, a.taken, a.done]);
    reportSheet_(ss, 'Сводка', [['Сотрудник', 190], ['Начал день', 70], ['Закончил день', 70], ['Рабочий день', 90], ['Цель, точек', 60, 'n'],
      ['Посещено точек', 75, 'n'], ['Новые', 60, 'n'], ['Повторные', 75, 'n'], ['Первый визит', 70], ['Последний визит', 75],
      ['Далеко от точки (>' + FAR_METERS + ' м)', 90, 'n'], ['Без GPS', 60, 'n'], ['Отметил нерабочими', 85, 'n'], ['Добавил адресов', 75, 'n'],
      ['Заданий выдал', 70, 'n'], ['Заданий взял', 70, 'n'], ['Заданий выполнил', 80, 'n']], sumRows, { sheet: summary, top: 5 });
    if (sumRows.length) {
      const t = rep.totals;
      summary.getRange(6 + sumRows.length, 1, 1, 17).setValues([['ИТОГО', '', '', '', '', t.visits, t.newPoints, t.repeat, '', '', t.far, t.noGps, t.closed, t.added, t.issued, t.taken, t.done]])
        .setFontWeight('bold').setBackground('#e8ecf7');
    }

    // Визиты: кто, куда, откуда, когда, по сотрудникам по порядку
    const photoCell = (urls) => urls.length ? '=HYPERLINK("' + urls[0] + '","Фото (' + urls.length + ')")' : '';
    const visitRows = [];
    const farCells = [];
    rep.agents.forEach(a => a.items.forEach(i => {
      visitRows.push([a.name, rep.label, i.time, i.route, i.n, i.name, i.type, i.address, i.visit, i.from, i.fromMin == null ? '' : i.fromMin, i.fromKm == null ? '' : i.fromKm,
        i.distance == null ? '' : i.distance, i.gps, i.alina, i.contact, i.position, i.phone, i.whatsapp, i.assortment, i.competitors, i.ourBrands,
        i.interest, i.nextStep, i.nextDate, i.comment, i.score === '' ? '' : Number(i.score) || '', photoCell(i.photos)]);
      if (i.far || !i.gps) farCells.push(visitRows.length);
    }));
    const vs = reportSheet_(ss, 'Визиты', [['Сотрудник', 170], ['Дата', 80], ['Время', 55], ['Маршрут', 60, 'n'], ['№ точки', 55, 'n'], ['Точка', 190], ['Тип', 150], ['Адрес', 260],
      ['Визит №', 55, 'n'], ['Откуда приехал', 170], ['Минут с прошлой точки', 75, 'n'], ['Км по прямой от прошлой', 75, 'n'], ['До точки при отправке, м', 80, 'n'], ['GPS сотрудника', 170],
      ['Работаем / не работаем', 95], ['Контактное лицо', 130], ['Должность', 110], ['Телефон', 120], ['WhatsApp', 120], ['Ассортимент', 210], ['Конкуренты', 190], ['Наши бренды', 150],
      ['Интерес', 75], ['Итог / следующий шаг', 230], ['Дата след. шага', 85], ['Комментарий', 220], ['Баллы ТТ', 60, 'n'], ['Фото', 70, 'f']], visitRows);
    farCells.forEach(r => vs.getRange(r + 1, 13, 1, 2).setBackground('#ffe2b8'));

    // Анкеты полностью: все поля за день
    const rawCols = RESULT_FIELDS.filter(f => f[0] !== 'uid' && f[0] !== 'n').map(f => [f[1], f[2] === 'num' ? 75 : 130, f[2] === 'num' ? 'n' : '']);
    const rawRows = dayVisitsRaw_(date).map(v => RESULT_FIELDS.filter(f => f[0] !== 'uid' && f[0] !== 'n').map(f => {
      const val = v[f[0]] == null ? '' : v[f[0]];
      return f[2] === 'num' ? toNum_(val) : String(val);
    }));
    reportSheet_(ss, 'Анкеты полностью', rawCols, rawRows);

    const cs = reportSheet_(ss, 'Нерабочие точки', [['Время', 55], ['Кто отметил', 170], ['Маршрут', 60, 'n'], ['№ точки', 55, 'n'], ['Точка', 190], ['Адрес', 260], ['Причина', 160], ['Комментарий', 220], ['GPS', 170]],
      rep.closed.map(c => [c.time, c.by, c.route, c.n, c.name, c.address, c.reason, c.note, c.gps]));
    if (rep.closed.length) cs.getRange(2, 1, rep.closed.length, 9).setBackground(CLOSED_COLOR);

    reportSheet_(ss, 'Новые адреса', [['Время', 55], ['Кто добавил', 170], ['Точка', 190], ['Тип', 150], ['Адрес', 260], ['Телефон', 120], ['Статус', 90]],
      rep.added.map(c => [c.time, c.by, c.name, c.type, c.address, c.phone, c.status]));

    reportSheet_(ss, 'Задания', [['Точка', 190], ['Адрес', 240], ['Задание', 260], ['Комментарий', 200], ['Срок', 85], ['Статус', 85], ['Выдал', 150], ['Выдано в', 60], ['Исполнитель', 150], ['Взято в', 60], ['Выполнено в', 70], ['Результат', 220]],
      rep.tasks.map(t => [t.name, t.address, t.type, t.comment, t.due, t.status, t.author, t.created, t.assignee, t.taken, t.done, t.result]));

    reportSheet_(ss, 'Хронология', [['Время', 55], ['Сотрудник', 170], ['Действие', 170], ['id точки', 80], ['Подробности', 420]],
      dayLog_(date).map(r => [hmIn_(parseTime_(r[0])), String(r[1]), String(r[2]), String(r[3]), String(r[4])]));

    SpreadsheetApp.flush();
    const res = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + fileId + '/export?format=xlsx',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('Не удалось собрать Excel (код ' + res.getResponseCode() + ')');
    return { rep, blob: res.getBlob().setName('Отчёт МТ ' + rep.label + '.xlsx') };
  } finally {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
  }
}

function archiveReport_(blob) {
  const folder = subFolder_(DriveApp.getRootFolder(), REPORT_FOLDER);
  const same = folder.getFilesByName(blob.getName());
  while (same.hasNext()) same.next().setTrashed(true);
  folder.createFile(blob);
}

function mailReport_(date) {
  const to = PropertiesService.getScriptProperties().getProperty('REPORT_TO');
  if (!to) fail_('Не задан адрес отчёта (меню таблицы «' + MENU + ' → Адрес для ежедневного отчёта»)');
  const { rep, blob } = buildReportBlob_(date);
  archiveReport_(blob);
  const t = rep.totals;
  const worked = rep.agents.filter(a => a.visits || a.closed || a.added);
  const body = 'Отчёт МТ за ' + rep.label + '\n\n' +
    'Посещено точек: ' + t.visits + ' (новых ' + t.newPoints + ', повторных ' + t.repeat + ')\n' +
    'Отмечено нерабочими: ' + t.closed + '\nДобавлено новых адресов: ' + t.added + '\nЗаданий выполнено: ' + t.done + '\n\n' +
    (worked.length ? 'По сотрудникам:\n' + worked.map(a => '· ' + a.name + ': ' + a.visits + ' точек' +
      (a.closed ? ', нерабочих ' + a.closed : '') + (a.added ? ', новых адресов ' + a.added : '')).join('\n') + '\n\n' : '') +
    'Подробности — во вложении.';
  MailApp.sendEmail({ to, subject: REPORT_SUBJECT, body, attachments: [blob], name: 'Alina Sales' });
  return { rep, to };
}

/** Запускается триггером каждый день. В день без активности письма нет. */
function sendDailyReport() {
  const date = todayStr_();
  if (!dayReport_(date).active) { Logger.log('За ' + date + ' активности нет, отчёт не отправлен'); return; }
  mailReport_(date);
  log_('Система', 'отправил отчёт на почту', '', date);
}

/** Ручная отправка из приложения за выбранную дату. */
function reportSend_(agent, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail_('Неверная дата');
  if (!dayReport_(date).active) fail_('За этот день нет данных');
  const { to } = mailReport_(date);
  log_(agent, 'отправил отчёт на почту', '', date);
  return { sent: true, to };
}

/** Один раз из редактора: ежедневная отправка в REPORT_HOUR по Алматы. Google запускает с разбросом до 15 минут. */
function reportSetup() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'sendDailyReport').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendDailyReport').timeBased().everyDays(1).atHour(REPORT_HOUR).nearMinute(0).inTimezone(TZ).create();
  Logger.log('Триггер создан: ' + ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'sendDailyReport').length);
}

/* ---------------- Маршруты по зонам ----------------
 * Новые маршруты — отдельный слой поверх данных: заполняются только колонки «Зона» и «№ в зоне».
 * id, старый маршрут, статусы, анкеты (листы «Маршрут N»), фото и задания не меняются,
 * поэтому переход можно включить и отменить переключателем ZONES_ON. */
const ZONES = 6;
const ZONE_SLACK = 1.12; // зона может быть больше средней не более чем на 12%
const ALMATY_CENTER = { lat: 43.238, lon: 76.889 };

let zonesOnMemo_ = null;
function zonesOn_() {
  if (zonesOnMemo_ === null) zonesOnMemo_ = PropertiesService.getScriptProperties().getProperty('ZONES_ON') === '1';
  return zonesOnMemo_;
}
// Точка без зоны остаётся в своём старом маршруте — при включении ничего не пропадёт
const effRoute_ = (row) => zonesOn_() && Number(row[P.zone]) ? Number(row[P.zone]) : Number(row[P.route]);

const zoneXY_ = (p) => ({ x: p.lon * 81.1, y: p.lat * 111 }); // км; для широты Алматы
const dist2_ = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Разбивка на k компактных зон примерно равного размера (k-means с лимитом вместимости, расчёт повторяемый). */
function balancedZones_(C, k, slack) {
  const cap = Math.ceil(C.length / k * slack);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let best = null;
  for (let t = 0; t < 12; t++) {
    const cen = [Object.assign({}, C[Math.floor(rnd() * C.length)])];
    while (cen.length < k) {
      const ds = C.map(p => Math.min.apply(null, cen.map(c => dist2_(c, p))));
      let r = rnd() * ds.reduce((a, b) => a + b, 0), i = 0;
      while ((r -= ds[i]) > 0 && i < C.length - 1) i++;
      cen.push(Object.assign({}, C[i]));
    }
    let asg = [];
    for (let it = 0; it < 20; it++) {
      const cnt = new Array(k).fill(0);
      asg = new Array(C.length).fill(-1);
      const order = C.map((p, i) => {
        const ds = cen.map(c => dist2_(c, p)).sort((a, b) => a - b);
        return { i, regret: Math.sqrt(ds[1]) - Math.sqrt(ds[0]) };
      }).sort((a, b) => b.regret - a.regret);
      order.forEach(o => {
        const opts = cen.map((c, z) => ({ z, d: dist2_(c, C[o.i]) })).sort((a, b) => a.d - b.d);
        const f = opts.find(x => cnt[x.z] < cap);
        asg[o.i] = f.z;
        cnt[f.z]++;
      });
      cen.forEach((c, z) => {
        const m = C.filter((_, j) => asg[j] === z);
        if (m.length) { c.x = m.reduce((s, p) => s + p.x, 0) / m.length; c.y = m.reduce((s, p) => s + p.y, 0) / m.length; }
      });
    }
    const cost = C.reduce((s, p, i) => s + Math.sqrt(dist2_(cen[asg[i]], p)), 0);
    if (!best || cost < best.cost) best = { cost, asg: asg.slice(), cen: cen.map(c => ({ x: c.x, y: c.y })) };
  }
  return best;
}

/** Улица или микрорайон из адреса: по ним проверяются точки с неточными координатами. */
function streetKey_(address) {
  const part = String(address).toLowerCase().replace(/ё/g, 'е').split(',').map(s => s.trim())
    .find(s => /(улица|проспект|микрорайон|мкр|переулок|бульвар|шоссе|тракт)/.test(s));
  return part ? part.replace(/(^|\s)(улица|проспект|микрорайон|мкр\.?|переулок|бульвар|шоссе|тракт)(?=\s|$)/g, ' ').trim() : '';
}

/** Название зоны: настоящие районы по обратному геокодированию выборки точных адресов. */
function zoneTitle_(pts, fallback) {
  const exact = pts.filter(p => p.acc === 'точно' && p.lat != null);
  const counts = {};
  let n = 0;
  try {
    const geocoder = Maps.newGeocoder().setLanguage('ru');
    const step = Math.max(1, Math.floor(exact.length / 12));
    for (let i = 0; i < exact.length; i += step) {
      const res = geocoder.reverseGeocode(exact[i].lat, exact[i].lon);
      const comps = (res.results || []).reduce((a, r) => a.concat(r.address_components || []), []);
      const area = comps.find(c => /район/i.test(c.long_name)) || comps.find(c => (c.types || []).indexOf('locality') >= 0);
      if (area) {
        const name = String(area.long_name).replace(/\s*район\s*/i, '').trim();
        counts[name] = (counts[name] || 0) + 1;
        n++;
      }
    }
  } catch (e) { return fallback; }
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).filter(k => counts[k] / n >= 0.25).slice(0, 2);
  return top.length ? top.join(', ') : fallback;
}

/** Черновик зон. Пишет только колонки «Зона» и «№ в зоне»; агенты не увидят его, пока зоны не включены. */
function zonesBuild_() {
  if (zonesOn_()) fail_('Новые маршруты уже включены — сначала верните старые');
  const { sh, values } = allPoints_();
  const pts = values.map((row, i) => {
    const has = row[P.lat] !== '' && row[P.lon] !== '';
    const p = { i, acc: String(row[P.acc] || ''), key: streetKey_(row[P.address]), zone: 0,
      lat: has ? Number(row[P.lat]) : null, lon: has ? Number(row[P.lon]) : null };
    return has ? Object.assign(p, zoneXY_(p)) : p;
  });
  const C = pts.filter(p => p.lat != null);
  const res = balancedZones_(C, ZONES, ZONE_SLACK);
  C.forEach((p, j) => { p.zone = res.asg[j] + 1; });

  // Неточные и пустые координаты: если на этой улице точные адреса почти все в одной зоне — берём её
  const byStreet = {};
  pts.filter(p => p.acc === 'точно' && p.key && p.zone).forEach(p => {
    const s = byStreet[p.key] || (byStreet[p.key] = {});
    s[p.zone] = (s[p.zone] || 0) + 1;
  });
  pts.filter(p => p.acc !== 'точно' && byStreet[p.key]).forEach(p => {
    const s = byStreet[p.key];
    const total = Object.keys(s).reduce((a, z) => a + s[z], 0);
    const top = Object.keys(s).sort((a, b) => s[b] - s[a])[0];
    if (total >= 2 && s[top] / total >= 0.7) p.zone = Number(top);
  });

  // Номера зон — по часовой стрелке от севера вокруг центра города
  const center = zoneXY_(ALMATY_CENTER);
  const angle = (c) => (Math.atan2(c.x - center.x, c.y - center.y) + 2 * Math.PI) % (2 * Math.PI);
  const order = res.cen.map((c, z) => ({ z: z + 1, a: angle(c) })).sort((a, b) => a.a - b.a);
  const renum = {};
  order.forEach((o, i) => { renum[o.z] = i + 1; });
  pts.forEach(p => { if (p.zone) p.zone = renum[p.zone]; });

  // № в зоне — порядок объезда: каждый раз к ближайшей следующей точке
  const DIRS = ['север', 'северо-восток', 'восток', 'юго-восток', 'юг', 'юго-запад', 'запад', 'северо-запад'];
  const titles = {};
  for (let z = 1; z <= ZONES; z++) {
    const inZone = pts.filter(p => p.zone === z);
    const left = inZone.filter(p => p.lat != null);
    let cur = center, n = 0;
    while (left.length) {
      let b = 0;
      left.forEach((p, i) => { if (dist2_(cur, p) < dist2_(cur, left[b])) b = i; });
      cur = left.splice(b, 1)[0];
      cur.n = ++n;
    }
    inZone.filter(p => p.lat == null).forEach(p => { p.n = ++n; });
    const o = order[z - 1];
    titles[z] = zoneTitle_(inZone, DIRS[Math.round(o.a / (Math.PI / 4)) % 8]);
  }

  withLock_(() => {
    sh.getRange(2, P.zone + 1, pts.length, 2).setValues(pts.map(p => [p.zone || '', p.zone ? p.n : '']));
    const props = PropertiesService.getScriptProperties();
    props.setProperty('ZONE_TITLES', JSON.stringify(titles));
    props.setProperty('ZONE_CENTERS', JSON.stringify(order.map(o => ({ lat: res.cen[o.z - 1].y / 111, lon: res.cen[o.z - 1].x / 81.1 }))));
    log_('Система', 'рассчитан черновик новых маршрутов', '', '');
  });
  return zonesPreview_();
}

/** Для экрана руководителя: карта и счётчики черновика. */
function zonesPreview_() {
  const props = PropertiesService.getScriptProperties();
  const stored = JSON.parse(props.getProperty('ZONE_TITLES') || '{}');
  const titles = [];
  for (let z = 1; z <= ZONES; z++) titles.push(stored[z] || '');
  const rows = allPoints_().values;
  return {
    on: zonesOn_(), built: rows.some(row => Number(row[P.zone]) > 0), titles,
    points: rows.map(row => ({
      id: String(row[P.id]), name: String(row[P.name]), address: String(row[P.address]),
      lat: row[P.lat] === '' ? null : Number(row[P.lat]), lon: row[P.lon] === '' ? null : Number(row[P.lon]),
      zone: Number(row[P.zone]) || 0, origin: Number(row[P.route]), acc: String(row[P.acc] || ''),
      done: row[P.status] === ST_DONE, closed: row[P.status] === ST_CLOSED,
    })),
  };
}

/** Ближайшая зона для точки, добавленной после расчёта. */
function nearestZone_(lat, lon) {
  const centers = JSON.parse(PropertiesService.getScriptProperties().getProperty('ZONE_CENTERS') || '[]');
  const me = zoneXY_({ lat, lon });
  let best = 0, bd = Infinity;
  centers.forEach((c, i) => { const d = dist2_(zoneXY_(c), me); if (d < bd) { bd = d; best = i + 1; } });
  return best;
}

function zoneSet_(agent, id, zone) {
  const z = Number(zone);
  if (!(z >= 1 && z <= ZONES)) fail_('Маршрут — от 1 до ' + ZONES);
  const { sh, rowIndex, row } = findRow_(id);
  const max = allPoints_().values.reduce((m, r) => Number(r[P.zone]) === z ? Math.max(m, Number(r[P.zoneN]) || 0) : m, 0);
  sh.getRange(rowIndex, P.zone + 1, 1, 2).setValues([[z, max + 1]]);
  log_(agent, 'назначил точке маршрут', id, row[P.name] + ' → ' + z);
  return zonesPreview_();
}

function zonesEnable_(agent, on) {
  const rows = allPoints_().values;
  if (on && !rows.some(row => Number(row[P.zone]) > 0)) fail_('Сначала рассчитайте черновик');
  if (on) {
    // Точки, добавленные с места после расчёта, — в ближайшую зону
    const sh = pointsSheet_();
    rows.forEach((row, i) => {
      if (Number(row[P.zone]) || row[P.lat] === '' || row[P.lon] === '') return;
      const z = nearestZone_(Number(row[P.lat]), Number(row[P.lon]));
      if (!z) return;
      const n = rows.reduce((m, r) => Number(r[P.zone]) === z ? Math.max(m, Number(r[P.zoneN]) || 0) : m, 0) + 1;
      row[P.zone] = z; row[P.zoneN] = n;
      sh.getRange(i + 2, P.zone + 1, 1, 2).setValues([[z, n]]);
    });
  }
  const props = PropertiesService.getScriptProperties();
  props.setProperty('ZONES_ON', on ? '1' : '0');
  props.setProperty('ZONES_VER', Utilities.getUuid().slice(0, 8)); // телефоны сбросят сохранённые списки точек
  zonesOnMemo_ = on;
  log_(agent, on ? 'включил новые маршруты' : 'вернул старые маршруты', '', '');
  return zonesPreview_();
}

/* ---------------- Листы и папки ---------------- */

function pointsSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(POINTS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(POINTS_SHEET, 0);
    if (sh.getMaxColumns() < POINTS_HEADER.length) sh.insertColumnsAfter(sh.getMaxColumns(), POINTS_HEADER.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, POINTS_HEADER.length).setValues([POINTS_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(P.name + 1, 220);
    sh.setColumnWidth(P.address + 1, 360);
  } else if (sh.getLastColumn() < POINTS_HEADER.length) {
    const max = sh.getMaxColumns();
    if (max < POINTS_HEADER.length) sh.insertColumnsAfter(max, POINTS_HEADER.length - max);
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
    growColumns_(sh);
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

function growColumns_(sh) {
  const max = sh.getMaxColumns();
  if (max < RESULT_FIELDS.length) sh.insertColumnsAfter(max, RESULT_FIELDS.length - max);
}

function ensureResultColumnsNow_(sh) {
  const width = Math.max(sh.getLastColumn(), 1);
  const header = sh.getRange(1, 1, 1, width).getValues()[0].map(String);
  growColumns_(sh);
  header.forEach((h, i) => {
    if (!RENAMED_COLUMNS[h]) return;
    header[i] = RENAMED_COLUMNS[h];
    sh.getRange(1, i + 1).setValue(header[i]);
  });
  RESULT_FIELDS.forEach((f, i) => {
    if (i >= header.length || header[i] === f[1] || header.indexOf(f[1]) >= 0) return;
    sh.insertColumnBefore(i + 1);
    sh.getRange(1, i + 1).setValue(f[1]).setFontWeight('bold').setBackground('#dbe7f5');
    header.splice(i, 0, f[1]);
  });
  // Колонки в конце добавляются одним запросом — их может быть больше сотни
  const tail = RESULT_FIELDS.slice(header.length).map(f => f[1]);
  if (tail.length) {
    sh.getRange(1, header.length + 1, 1, tail.length).setValues([tail])
      .setFontWeight('bold').setBackground('#dbe7f5');
  }
}

function subFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
