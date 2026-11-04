(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const MOCK = new URLSearchParams(location.search).has('mock') || !CFG.API_URL;

  const ASSORTMENT = ['ВД-краски', 'Эмали', 'Грунтовки', 'Лаки и пропитки', 'Шпатлёвки и штукатурки',
    'Клей', 'Герметики и пена', 'Растворители', 'Колеровка', 'Инструмент'];
  const COMPETITORS = ['Tikkurila', 'Dulux', 'Alpina', 'Caparol', 'Ceresit', 'Knauf', 'Текс',
    'VGT', 'Лакра', 'Eskaro', 'Marshall', 'Местные / Китай'];
  const OUR_BRANDS = ['AlinEX', 'НАШИ', 'Norma', 'Alina Paint', 'Алкиды', 'FAWORI', 'V-tech'];
  const ALINA = ['Работаем', 'Не работаем'];
  const OLD_ALINA = { 'Да, работают': 'Работаем', 'Нет': 'Не работаем' }; // ответы старых анкет

  // Поля шаблона оценки ТТ. Те же ключи — в extraFields_() в apps-script/Code.gs
  const TT_FORMATS = ['Строительный магазин', 'Хозяйственный магазин', 'Универсальный магазин', 'Специализированный магазин ЛКМ',
    'Магазин инструментов', 'Магазин сантехники', 'Строительная база', 'Торговая сеть', 'Другое', 'Не формат'];
  const PAYMENT = ['Предоплата', 'Пост оплата до 7 дней', 'Пост оплата до 15 дней', 'Пост оплата до 30 дней',
    'Пост оплата более 30 дней', 'В реализацию'];
  const TRAFFIC = ['Слабая', 'Средняя', 'Высокая'];
  const READY = ['Да', 'Нет'];
  const EQUIP_BRANDS = ['FAWORI', 'Alina Paint', 'AlinEX', 'V-tech'];
  const KO_BRANDS = ['Alina', 'FAWORI', 'Радуга', 'Dulux', 'Tikkurila', 'Собственное', 'Другие'];
  const BRANDING_BRANDS = ['FAWORI', 'Alina Paint', 'V-tech', 'AlinEX', 'НАШИ'];
  const BRANDING_KINDS = ['Снаружи', 'Внутри', 'Торговое оборудование', 'POSM'];
  const PAINT_BRANDS = ['Dulux', 'Tikkurila', 'Marshall', 'Raduga', 'Belly Dom', 'Decorex', 'Fawori', 'Alina', 'Другие'];
  const SSS_BRANDS = ['AlinEX', 'НАШИ', 'Волма', 'Другие'];
  const SEAL_BRANDS = ['V-tech', 'Tytan', 'VGT', 'Другие'];
  const INTEREST = ['Высокий', 'Средний', 'Низкий', 'Отказ'];
  const TASK_TYPES = [
    'Отработать с командой ОТЭК',
    'Отработать по бренду Alina Paint и NORMA',
    'Отработать по бренду AlinEX и НАШИ',
    'Отработать по бренду V-tech, Alina Paint Alkyd',
    'Отработать по бренду FAWORI',
    'Отработать по брендингу в торговой точке',
  ];
  const FAR_METERS = 300;

  const $ = (id) => document.getElementById(id);
  const $app = $('app');

  /* ---------- localStorage (может быть недоступен) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  const ROLE_MANAGER = 'руководитель';
  const LOCK_AFTER = 15 * 60000; // приложение просит PIN / Face ID после 15 минут в фоне
  const me = { agent: store.get('agent', ''), role: store.get('role', ''), token: store.get('token', '') };
  const isManager = () => me.role === ROLE_MANAGER && !!me.token;
  let unlocked = false;
  let faceIdOk = false;
  const ui = {
    q: '', sort: 'order', tab: store.get('ui:tab', 'free'), pos: null,
    tq: '', ttab: store.get('ui:ttab', 'free'), tstatus: 'open', tagent: '',
    period: store.get('ui:period', 'today'), mperiod: store.get('ui:mperiod', 'day'), taskBack: null,
    auth: { step: me.agent ? 'pin' : 'name', name: me.agent || store.get('lastAgent', ''), pin1: '' },
  };
  // Всё, что пришло с сервера, сохраняется на телефоне: экраны открываются сразу, свежие данные догружаются в фоне
  const cache = {
    summary: store.get('cache:summary', null), points: {}, tasks: store.get('cache:tasks', null),
    stats: store.get('cache:stats', {}), me: store.get('cache:me', {}), staff: store.get('cache:staff', null),
  };
  const saveCache = (k) => store.set('cache:' + k, cache[k]);
  let refreshTimer = null;
  let currentLoad = null;

  /* ---------- helpers ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const routeOf = (id) => Number(String(id).match(/^R(\d+)-/)[1]);
  const cleanAddr = (a) => String(a).replace(/\s*\d+\s*филиал\S*\s*$/i, '').trim();
  const telDigits = (s) => String(s || '').replace(/[^\d+]/g, '');
  function waUrl(s) {
    let n = String(s || '').replace(/\D/g, '');
    if (n.length === 11 && n[0] === '8') n = '7' + n.slice(1);
    return n.length === 11 && n[0] === '7' && n.slice(1, 4) !== '800' ? 'https://wa.me/' + n : '';
  }
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => ymd(new Date());
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  const fmtDue = (s) => s ? s.slice(8, 10) + '.' + s.slice(5, 7) : '';
  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
  };

  function toast(msg, isErr) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.hidden = true; }, isErr ? 5000 : 2800);
  }

  function km(a, b) {
    const R = 6371, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  // Местоположение для отметки визита; без GPS визит всё равно отправляется
  function getGeo() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: Math.round(pos.coords.accuracy) }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
    });
  }

  /* ---------- 2ГИС ---------- */
  const hasCoords = (p) => p.lat != null && p.lon != null && p.acc !== 'нет';
  // Маршрут по координатам — только для точного адреса, иначе через поиск фирмы в 2ГИС
  const routable = (p) => hasCoords(p) && p.acc === 'точно';
  // Своя ссылка 2ГИС точки (если есть) открывает её карточку напрямую
  const gisSearchUrl = (p) => p.gis || ('https://2gis.kz/almaty/search/' + encodeURIComponent(p.name + ', ' + cleanAddr(p.address)));
  const gisRouteWebUrl = (p) => routable(p)
    ? 'https://2gis.kz/almaty/directions/points/%7C' + p.lon + '%2C' + p.lat
    : gisSearchUrl(p);

  function openRoute(p) {
    if (!routable(p)) { location.href = gisSearchUrl(p); return; }
    // Приложение 2ГИС: маршрут от текущего местоположения. Если приложения нет — сайт.
    const started = Date.now();
    location.href = 'dgis://2gis.ru/routeSearch/rsType/car/to/' + p.lon + ',' + p.lat;
    setTimeout(() => {
      if (!document.hidden && Date.now() - started < 3000) location.href = gisRouteWebUrl(p);
    }, 1500);
  }

  /* ---------- Задания: общие функции ---------- */
  const isOpen = (t) => t.status === 'новое' || t.status === 'в работе';
  const isOverdue = (t) => isOpen(t) && !!t.due && t.due < today();
  function taskSort(a, b) {
    return (isOpen(b) - isOpen(a)) || (isOverdue(b) - isOverdue(a)) ||
      ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0) ||
      String(b.created).localeCompare(String(a.created));
  }
  function taskCounts(ts) {
    return {
      free: ts.filter((t) => t.status === 'новое').length,
      mine: ts.filter((t) => t.status === 'в работе' && t.assignee === me.agent).length,
      overdue: ts.filter((t) => isOverdue(t) && (isManager() || t.status === 'новое' || t.assignee === me.agent)).length,
    };
  }

  /** Статистика руководителя (в демо-режиме считается здесь, на сервере — так же в Code.gs). */
  function computeStats(from, visits, tasks, log) {
    const by = {};
    const ag = (n) => by[n] || (by[n] = { name: n, visits: 0, newPoints: 0, far: 0, noGps: 0,
      issued: 0, taken: 0, done: 0, inWork: 0, overdue: 0, last: 0 });
    const seen = (a, t) => { if (t > a.last) a.last = t; };
    const inP = (t) => t && t >= from;
    visits.forEach((v) => {
      if (!v.agent || !inP(v.t)) return;
      const a = ag(v.agent);
      a.visits++;
      if (!(v.visit > 1)) a.newPoints++;
      if (!v.gps) a.noGps++; else if (v.distance !== '' && v.distance != null && v.distance > FAR_METERS) a.far++;
      seen(a, v.t);
    });
    let issued = 0, taken = 0, done = 0, open = 0, overdue = 0, hours = 0, hoursN = 0;
    tasks.forEach((t) => {
      const tc = Date.parse(t.created) || 0, tt = Date.parse(t.taken) || 0, td = Date.parse(t.done) || 0;
      if (inP(tc) && t.author) { issued++; const a = ag(t.author); a.issued++; seen(a, tc); }
      if (inP(tt) && t.assignee) { taken++; const a = ag(t.assignee); a.taken++; seen(a, tt); }
      if (t.status === 'выполнено' && inP(td) && t.assignee) {
        done++; const a = ag(t.assignee); a.done++; seen(a, td);
        if (tt) { hours += (td - tt) / 3600000; hoursN++; }
      }
      if (isOpen(t)) {
        open++;
        if (t.status === 'в работе' && t.assignee) ag(t.assignee).inWork++;
        if (isOverdue(t)) { overdue++; if (t.assignee) ag(t.assignee).overdue++; }
      }
    });
    const feed = log.filter((e) => inP(Date.parse(e.time))).slice(-100).reverse();
    const agents = Object.values(by).map((a) => Object.assign({}, a, { last: a.last ? new Date(a.last).toISOString() : '' }))
      .sort((a, b) => (b.visits + b.done) - (a.visits + a.done) || a.name.localeCompare(b.name));
    const sum = (k) => agents.reduce((s, a) => s + a[k], 0);
    return {
      totals: { visits: sum('visits'), newPoints: sum('newPoints'), far: sum('far'), noGps: sum('noGps'),
        issued, taken, done, open, overdue, avgHours: hoursN ? Math.round(hours / hoursN * 10) / 10 : null },
      agents, feed, farMeters: FAR_METERS,
    };
  }

  /* ---------- API ---------- */
  function remoteApi() {
    const url = CFG.API_URL;
    async function parse(res) {
      const data = await res.json();
      if (!data.ok) {
        const e = new Error(data.error || 'Ошибка сервера');
        e.server = true;
        e.code = data.code || '';
        if (e.code === 'auth') setTimeout(() => authLost(e.message));
        throw e;
      }
      return data;
    }
    const get = (action, q) => fetch(url + '?' + new URLSearchParams(Object.assign({ action, token: me.token }, q)))
      .then(parse);
    const post = (action, body) => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action, token: me.token }, body)),
    }).then(parse);
    return {
      ping: () => get('ping'),
      summary: () => get('summary').then((d) => d.routes),
      points: (route) => get('points', { route }).then((d) => d.points),
      claim: (id) => post('claim', { id }).then((d) => d.point),
      release: (id) => post('release', { id }).then((d) => d.point),
      complete: (id, form, photos, agent) => post('complete', { id, form, photos, agent: agent || me.agent }).then((d) => d.point),
      result: (id) => get('result', { id }).then((d) => d.result),
      history: (id) => get('history', { id }).then((d) => d.visits),
      update: (id, form, photos) => post('update', { id, form, photos }).then((d) => d.point),
      remove: (id) => post('remove', { id }).then((d) => d.point),
      tasks: (point) => get('tasks', point ? { point } : {}).then((d) => d.tasks),
      taskCreate: (point, items, due) => post('taskCreate', { point, items, due }).then((d) => d.tasks),
      taskTake: (id) => post('taskTake', { id }).then((d) => d.task),
      taskRelease: (id) => post('taskRelease', { id }).then((d) => d.task),
      taskDone: (id, result, photos) => post('taskDone', { id, result, photos }).then((d) => d.task),
      taskCancel: (id) => post('taskCancel', { id }).then((d) => d.task),
      stats: (from) => post('stats', { from }).then((d) => d.stats),
      login: (name, pin) => post('login', { name, pin }),
      register: (name, pin, managerCode) => post('register', { name, pin, managerCode }),
      pinChange: (old, pin) => post('pinChange', { old, pin }),
      becomeManager: (code) => post('becomeManager', { code }),
      goalSet: (goal) => post('goalSet', { goal }).then((d) => d.day),
      dayStart: (geo) => post('dayStart', { geo }).then((d) => d.day),
      dayEnd: (geo) => post('dayEnd', { geo }).then((d) => d.day),
      me: (from, who) => post('me', { from, who }).then((d) => d.me),
      boot: (from) => post('boot', { from }),
      staff: () => post('staff', {}).then((d) => d.staff),
      staffReset: (name) => post('staffReset', { name }).then((d) => d.staff),
      staffBlock: (name, blocked) => post('staffBlock', { name, blocked }).then((d) => d.staff),
      staffRole: (name, role) => post('staffRole', { name, role }).then((d) => d.staff),
    };
  }

  // Демо-режим: точки из data/routes.json, статусы, визиты и задания — в localStorage этого браузера
  function mockApi() {
    let base = null;
    const wait = (v) => new Promise((r) => setTimeout(() => r(v), 250));
    const state = () => store.get('mock:state', {});
    const results = () => store.get('mock:results', []);
    const tasksDb = () => store.get('mock:tasks', []);
    const logDb = () => store.get('mock:log', []);
    const log = (agent, action, id, details) => {
      store.set('mock:log', logDb().concat([{ time: new Date().toISOString(), agent, action, id, details }]).slice(-500));
    };
    const load = async () => base || (base = await fetch('data/routes.json').then((r) => r.json()));
    const all = async () => {
      const s = state();
      const out = [];
      (await load()).routes.forEach((r) => r.points.forEach((p) => {
        const st = s[p.id] || {};
        out.push(Object.assign({ route: r.route, lat: null, lon: null, acc: p.lat != null ? 'точно' : '' }, p,
          { status: st.status || 'свободна', agent: st.agent || '', visits: st.visits || 0, lastVisit: fmtTime(st.last) }));
      }));
      return out;
    };
    const fail = (m, code) => { const e = new Error(m); e.server = true; e.code = code || ''; throw e; };
    const find = async (id) => (await all()).find((x) => x.id === id) || fail('Точка не найдена');
    const staffDb = () => store.get('mock:staff', []);
    const findStaff = (name) => staffDb().find((s) => s.name.toLowerCase() === String(name).trim().toLowerCase());
    const session = (s) => wait({ ok: true, token: 'mock.' + encodeURIComponent(s.name) + '.' + (s.ver || 1), name: s.name, role: s.role });
    const dayDb = () => store.get('mock:day', {});
    const dayKey = (name) => today() + '|' + name;
    const dayOf = (name) => Object.assign({ goal: 0, start: '', end: '' }, dayDb()[dayKey(name)]);
    const setDay = (name, patch) => {
      const db = dayDb();
      db[dayKey(name)] = Object.assign(dayOf(name), patch);
      store.set('mock:day', db);
      return wait(db[dayKey(name)]);
    };
    const visitsAll = () => results().map((r) => ({ agent: r.agent, t: Date.parse(r.time), visit: r.visit || 1,
      distance: r.distance, gps: !!r.gps, geo: r.geo, id: r.id, nextDate: r.form.nextDate, nextStep: r.form.nextStep }));
    const dayStartMs = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const setState = async (id, patch) => {
      const s = state();
      const cur = Object.assign({}, s[id], patch);
      if (cur.status === 'свободна') delete s[id]; else s[id] = cur;
      store.set('mock:state', s);
      return find(id);
    };
    const changeTask = (id, fn) => {
      const db = tasksDb();
      const t = db.find((x) => x.id === id) || fail('Задание не найдено');
      fn(t);
      store.set('mock:tasks', db);
      return wait(t);
    };
    const lastResult = (id) => results().filter((x) => x.id === id).pop();
    return {
      ping: () => wait({ ok: true }),
      summary: async () => {
        const by = {};
        (await all()).forEach((p) => {
          const r = by[p.route] || (by[p.route] = { route: p.route,
            title: (base.routes.find((x) => x.route === p.route) || {}).title || '', total: 0, free: 0, work: 0, done: 0 });
          r.total++;
          if (p.status === 'выполнена') r.done++; else if (p.status === 'в работе') r.work++; else r.free++;
        });
        return wait(Object.values(by));
      },
      points: async (route) => wait((await all()).filter((p) => p.route === Number(route))),
      claim: async (id) => {
        const p = await find(id);
        if (p.status === 'выполнена') fail('Точка уже выполнена (' + p.agent + ')');
        if (p.status === 'в работе' && p.agent !== me.agent) fail('Точку уже взял(а): ' + p.agent);
        log(me.agent, 'взял точку', id, p.name);
        return wait(await setState(id, { status: 'в работе', agent: me.agent }));
      },
      release: async (id) => {
        const p = await find(id);
        if (p.status !== 'в работе' || p.agent !== me.agent) fail('Эта точка не у вас в работе');
        log(me.agent, 'освободил точку', id, p.name);
        return wait(await setState(id, { status: 'свободна', agent: '' }));
      },
      complete: async (id, form, photos, agent) => {
        const who = agent || me.agent;
        const p = await find(id);
        if (p.status === 'в работе' && p.agent !== who) fail('Точку уже взял(а): ' + p.agent);
        const list = results();
        if (form.uid && list.some((r) => r.id === id && r.form.uid === form.uid)) return wait(p);
        const f = Object.assign({}, form);
        const geo = f.geo;
        delete f.geo;
        const distance = geo && hasCoords(p) ? Math.round(km(geo, p) * 1000) : '';
        const visit = (p.visits || (p.status === 'выполнена' ? 1 : 0)) + 1;
        const now = new Date().toISOString();
        list.push({ id, agent: who, time: now, form: f, photos: photos.length, visit, distance, gps: !!geo, geo: geo || null });
        store.set('mock:results', list);
        log(who, visit > 1 ? 'повторный визит' : 'визит', id,
          p.name + (distance !== '' ? ' · ' + distance + ' м от точки' : geo ? ' · GPS отмечен' : ' · без GPS'));
        return wait(await setState(id, { status: 'выполнена', agent: who, visits: visit, last: now }));
      },
      result: async (id) => {
        const r = lastResult(id);
        if (!r) return wait(null);
        const out = Object.assign({}, r.form, { photos: Array(r.photos).fill('photo').join('\n') });
        Object.keys(out).forEach((k) => { if (Array.isArray(out[k])) out[k] = out[k].join(', '); });
        return wait(out);
      },
      history: async (id) => wait(results().filter((x) => x.id === id).map((r, i) => ({
        visit: r.visit || i + 1, time: fmtTime(r.time), agent: r.agent, interest: r.form.interest,
        nextStep: r.form.nextStep, comment: r.form.comment, distance: r.distance == null ? '' : r.distance,
        gps: !!r.gps, photos: r.photos,
      }))),
      update: async (id, form, photos) => {
        const p = await find(id);
        if (p.status !== 'выполнена') fail('Точка ещё не выполнена');
        const log2 = results();
        const r = log2.filter((x) => x.id === id).pop();
        r.form = Object.assign({}, form, { uid: r.form.uid });
        r.photos += photos.length;
        store.set('mock:results', log2);
        log(me.agent, 'изменил анкету', id, p.name);
        return wait(p);
      },
      remove: async (id) => {
        const p = await find(id);
        if (p.status !== 'выполнена') fail('Точка ещё не выполнена');
        const list = results();
        const i = list.map((x) => x.id).lastIndexOf(id);
        list.splice(i, 1);
        store.set('mock:results', list);
        log(me.agent, 'удалил анкету', id, p.name);
        const prev = list.filter((x) => x.id === id).pop();
        return wait(await setState(id, prev
          ? { agent: prev.agent, visits: Math.max(1, (p.visits || 1) - 1) }
          : { status: 'свободна', agent: '', visits: 0, last: '' }));
      },
      tasks: async (point) => wait(tasksDb().filter((t) => !point || t.point === point)),
      taskCreate: async (point, items, due) => {
        const p = await find(point);
        if (!items.length) fail('Выберите хотя бы одно задание');
        const db = tasksDb();
        const now = new Date().toISOString();
        const stamp = Date.now().toString(36);
        items.forEach((it, i) => {
          const t = { id: 'T' + stamp + '-' + (i + 1), point, route: p.route, name: p.name, address: p.address,
            type: it.type, comment: it.comment || '', due: due || '', author: me.agent, created: now,
            status: 'новое', assignee: '', taken: '', done: '', result: '', photos: '' };
          db.push(t);
          log(me.agent, 'выдал задание', t.id, t.type + ' — ' + t.name + (due ? ' · срок ' + due : ''));
        });
        store.set('mock:tasks', db);
        return wait(db.filter((t) => t.point === point));
      },
      taskTake: (id) => changeTask(id, (t) => {
        if (t.status === 'в работе' && t.assignee !== me.agent) fail('Задание уже взял(а): ' + t.assignee);
        if (!isOpen(t)) fail('Задание уже ' + t.status);
        Object.assign(t, { status: 'в работе', assignee: me.agent, taken: new Date().toISOString() });
        log(me.agent, 'взял задание', id, t.type + ' — ' + t.name);
      }),
      taskRelease: (id) => changeTask(id, (t) => {
        if (t.status !== 'в работе' || t.assignee !== me.agent) fail('Это задание не у вас в работе');
        Object.assign(t, { status: 'новое', assignee: '', taken: '' });
        log(me.agent, 'отказался от задания', id, t.type + ' — ' + t.name);
      }),
      taskDone: (id, result, photos) => changeTask(id, (t) => {
        if (t.status === 'в работе' && t.assignee !== me.agent) fail('Задание выполняет: ' + t.assignee);
        if (!isOpen(t)) fail('Задание уже ' + t.status);
        const now = new Date().toISOString();
        Object.assign(t, { status: 'выполнено', assignee: me.agent, taken: t.taken || now, done: now,
          result: result || '', photos: photos.map((_, i) => 'фото ' + (i + 1)).join('\n') });
        log(me.agent, 'выполнил задание', id, t.type + ' — ' + t.name + (photos.length ? ' · фото ' + photos.length : ''));
      }),
      taskCancel: (id) => changeTask(id, (t) => {
        if (t.author !== me.agent && !isManager()) fail('Отменить может автор задания или руководитель');
        if (t.status === 'выполнено') fail('Задание уже выполнено');
        t.status = 'отменено';
        log(me.agent, 'отменил задание', id, t.type + ' — ' + t.name);
      }),
      stats: async (from) => {
        const s = computeStats(from, visitsAll(), tasksDb(), logDb());
        const pts = await all();
        const by = {};
        staffDb().filter((x) => x.status !== 'заблокирован').forEach((x) => { by[x.name] = { name: x.name, visits: 0, startPos: null, lastPos: null }; });
        visitsAll().filter((v) => v.t >= dayStartMs()).forEach((v) => {
          const a = by[v.agent] || (by[v.agent] = { name: v.agent, visits: 0, startPos: null, lastPos: null });
          a.visits++;
          a.last = new Date(v.t).toISOString();
          if (v.geo) a.lastPos = { lat: v.geo.lat, lon: v.geo.lon, time: a.last, id: v.id, point: (pts.find((p) => p.id === v.id) || {}).name };
        });
        s.today = Object.values(by).map((a) => Object.assign(a, dayOf(a.name), { startPos: dayOf(a.name).startPos || null }));
        return wait(s);
      },
      // Вход в демо: сотрудники и PIN хранятся в этом браузере; код руководителя — любой
      login: async (name, pin) => {
        const s = findStaff(name);
        if (!s) fail('Вы входите впервые — придумайте PIN', 'not_registered');
        if (s.status === 'заблокирован') fail('Доступ закрыт — обратитесь к руководителю');
        if (s.pin !== pin) fail('Неверный PIN', 'bad_pin');
        return session(s);
      },
      register: async (name, pin, managerCode) => {
        if (!/^\d{4}$/.test(pin)) fail('PIN — 4 цифры');
        const db = staffDb();
        const s = findStaff(name);
        if (s && s.pin) fail('Это имя уже зарегистрировано — войдите своим PIN', 'exists');
        const rec = s || { name: String(name).trim().replace(/\s+/g, ' '), role: 'агент', status: 'активен', created: new Date().toISOString() };
        Object.assign(rec, { pin, role: managerCode ? ROLE_MANAGER : rec.role, last: new Date().toISOString(), ver: (rec.ver || 0) + 1 });
        store.set('mock:staff', s ? db.map((x) => x.name === s.name ? rec : x) : db.concat([rec]));
        log(rec.name, 'зарегистрировался', '', rec.role);
        return session(rec);
      },
      pinChange: async (old, pin) => {
        const db = staffDb();
        const s = db.find((x) => x.name === me.agent);
        if (s.pin !== old) fail('Неверный текущий PIN');
        s.pin = pin;
        store.set('mock:staff', db);
        return session(s);
      },
      becomeManager: async (code) => {
        if (!code) fail('Неверный код руководителя');
        const db = staffDb();
        const s = db.find((x) => x.name === me.agent);
        s.role = ROLE_MANAGER;
        store.set('mock:staff', db);
        return session(s);
      },
      goalSet: (goal) => { log(me.agent, 'цель дня', '', goal + ' точек'); return setDay(me.agent, { goal: Number(goal) }); },
      dayStart: (geo) => {
        const d = dayOf(me.agent);
        if (d.start && !d.end) fail('Рабочий день уже начат');
        log(me.agent, 'начал день', '', geo ? 'GPS отмечен' : 'без GPS');
        return setDay(me.agent, d.start ? { end: '' } : { start: new Date().toISOString(), startPos: geo });
      },
      dayEnd: (geo) => {
        if (!dayOf(me.agent).start) fail('Рабочий день ещё не начат');
        log(me.agent, 'закончил день', '', geo ? 'GPS отмечен' : 'без GPS');
        return setDay(me.agent, { end: new Date().toISOString() });
      },
      me: async (from, who) => {
        const name = who && isManager() ? who : me.agent;
        const visits = visitsAll();
        const s = computeStats(from, visits, tasksDb(), logDb());
        const row = s.agents.find((a) => a.name === name) || { visits: 0, newPoints: 0, far: 0, noGps: 0, issued: 0, taken: 0, done: 0 };
        const pts = await all();
        const lastById = {};
        visits.forEach((v) => { lastById[v.id] = v; });
        const todo = Object.values(lastById).filter((v) => v.nextDate && v.agent === name).map((v) => {
          const p = pts.find((x) => x.id === v.id) || {};
          return { id: v.id, name: p.name, address: p.address, nextDate: v.nextDate, nextStep: v.nextStep };
        }).sort((a, b) => a.nextDate.localeCompare(b.nextDate));
        return wait({ name, role: (findStaff(name) || {}).role || 'агент', period: row,
          today: Object.assign({ visits: visits.filter((v) => v.agent === name && v.t >= dayStartMs()).length }, dayOf(name)),
          todo, feed: s.feed.filter((e) => e.agent === name).slice(0, 30) });
      },
      boot: async (from) => ({
        routes: await api.summary(), tasks: await api.tasks(), me: await api.me(from, ''),
        stats: isManager() ? await api.stats(from) : null,
      }),
      staff: () => wait(staffDb().map((s) => ({ name: s.name, role: s.role, status: s.status, hasPin: !!s.pin, created: s.created, last: s.last }))),
      staffReset: (name) => { const db = staffDb(); db.find((x) => x.name === name).pin = ''; store.set('mock:staff', db); return api.staff(); },
      staffBlock: (name, blocked) => { const db = staffDb(); db.find((x) => x.name === name).status = blocked ? 'заблокирован' : 'активен'; store.set('mock:staff', db); return api.staff(); },
      staffRole: (name, role) => { const db = staffDb(); db.find((x) => x.name === name).role = role; store.set('mock:staff', db); return api.staff(); },
    };
  }

  const api = MOCK ? mockApi() : remoteApi();

  /* ---------- Очередь отправки (если нет связи) ---------- */
  const outbox = () => store.get('outbox', []);
  const isPending = (id) => outbox().some((x) => x.id === id);

  async function flushOutbox() {
    const items = outbox();
    if (!items.length || flushOutbox.busy || !me.token || !unlocked) return;
    flushOutbox.busy = true;
    const rest = [];
    for (const it of items) {
      try {
        await api.complete(it.id, it.form, it.photos, it.agent);
        store.del('draft:' + it.id);
        toast('Отправлено: ' + it.name);
      } catch (e) {
        if (e.server) toast('Не принято «' + it.name + '»: ' + e.message, true);
        else rest.push(it);
      }
    }
    store.set('outbox', rest);
    flushOutbox.busy = false;
    updateBanner();
  }

  function updateBanner() {
    const b = $('banner');
    const parts = [];
    if (MOCK) parts.push('Демо-режим: данные сохраняются только на этом устройстве.');
    const n = outbox().length;
    if (n) parts.push('Ждут отправки: ' + n + ' — отправим, когда появится связь.');
    b.textContent = parts.join(' ');
    b.hidden = !parts.length;
  }

  /* ---------- Иконки (линейные, в духе SF Symbols) ---------- */
  const icon = (d, cls) => `<svg class="i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const I = {
    home: icon('<path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z"/>'),
    tasks: icon('<path d="M10 6h10M10 12h10M10 18h10"/><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12 5 13.5 7.5 11M3.5 18 5 19.5 7.5 17"/>'),
    team: icon('<path d="M4 20V11M10 20V5M16 20v-6M22 20H2"/>'),
    person: icon('<circle cx="12" cy="8" r="4"/><path d="M4 21c.5-4 4-6 8-6s7.5 2 8 6"/>'),
    map: icon('<path d="m9 4-6 2.2v14L9 18l6 2 6-2.2v-14L15 6z"/><path d="M9 4v14M15 6v14"/>'),
    pin: icon('<path d="M12 21.5s7-6.9 7-11.5a7 7 0 0 0-14 0c0 4.6 7 11.5 7 11.5z"/><circle cx="12" cy="10" r="2.5"/>'),
    car: icon('<path d="M4 16.5V12l2-5.5h12L20 12v4.5"/><path d="M3 16.5h18v2H3zM4 12h16"/><circle cx="7.5" cy="14.3" r=".6"/><circle cx="16.5" cy="14.3" r=".6"/>'),
    phone: icon('<path d="M5.5 3.5h3.5l1.8 4.6-2.3 1.4a11 11 0 0 0 6 6l1.4-2.3 4.6 1.8v3.5a2 2 0 0 1-2.1 2A17 17 0 0 1 3.5 5.6a2 2 0 0 1 2-2.1z"/>'),
    chat: icon('<path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4a8.5 8.5 0 1 1 15.6-4.6z"/>'),
    plus: icon('<path d="M12 5v14M5 12h14"/>'),
    repeat: icon('<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11V9.5A3.5 3.5 0 0 1 7 6h13.5M7 21.5 3.5 18 7 14.5"/><path d="M20.5 13v1.5A3.5 3.5 0 0 1 17 18H3.5"/>'),
    edit: icon('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
    trash: icon('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
    clock: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),
    play: icon('<path d="M7 4.5v15l12-7.5z"/>'),
    stop: icon('<rect x="5.5" y="5.5" width="13" height="13" rx="2"/>'),
    target: icon('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
    key: icon('<circle cx="8" cy="15" r="4.5"/><path d="m11.2 11.8 9.3-9.3M17 6l3 3M14.5 8.5l2 2"/>'),
    face: icon('<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M9 9.5v1M15 9.5v1M12 9.5v3.5h-1M9 16a4.5 4.5 0 0 0 6 0"/>'),
    shield: icon('<path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6z"/>'),
    logout: icon('<path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M10 8l-4 4 4 4M6 12h10"/>'),
    camera: icon('<path d="M3.5 8.5A1.5 1.5 0 0 1 5 7h2.5L9 4.5h6L16.5 7H19a1.5 1.5 0 0 1 1.5 1.5v9.5A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z"/><circle cx="12" cy="13" r="3.5"/>'),
    check: icon('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    users: icon('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.4-3.6 3.2-5.5 6.5-5.5s6.1 1.9 6.5 5.5"/><path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.8c2.2.6 3.7 2.4 4 5.2"/>'),
    chev: icon('<path d="m9 5 7 7-7 7"/>', 'chev'),
  };
  const chev = I.chev;

  // Кольцо прогресса (как кольца активности на Apple Watch)
  function ring(pct, size) {
    const p = Math.max(0, Math.min(100, pct));
    return `<svg class="ring${p >= 100 ? ' full' : ''}" width="${size}" height="${size}" viewBox="0 0 36 36" aria-label="${p}%">
      <circle class="track" cx="18" cy="18" r="15.5" fill="none" stroke-width="4"/>
      <circle class="val" cx="18" cy="18" r="15.5" fill="none" stroke-width="4" stroke-linecap="round"
        stroke-dasharray="${(p * 97.4 / 100).toFixed(1)} 97.4" transform="rotate(-90 18 18)"/>
      <text x="18" y="21" text-anchor="middle">${p}%</text></svg>`;
  }

  /* ---------- Каркас: навигационная панель, большой заголовок, вкладки ---------- */
  // backHash — экран «внутри» раздела (стрелка назад); без него — раздел с большим заголовком.
  // action — кнопка справа: { icon, href, label }.
  function setBar(title, backHash, action) {
    const authed = !!(me.token && unlocked);
    const large = !backHash && authed;
    document.body.classList.toggle('large', large);
    $('title').textContent = title;
    $('ltitle').textContent = title;
    $('ltitle').hidden = !large;
    const back = $('back');
    back.hidden = !backHash;
    back.onclick = () => { location.hash = backHash; };
    $('logo').hidden = !!backHash || !authed;
    const a = $('action');
    a.hidden = !action;
    if (action) { a.innerHTML = action.icon; a.href = action.href; a.setAttribute('aria-label', action.label); }
    updateTabbar();
    onScroll();
  }

  function onScroll() { document.body.classList.toggle('scrolled', window.scrollY > 36); }
  window.addEventListener('scroll', onScroll, { passive: true });

  function updateTabbar() {
    const tb = $('tabbar');
    const authed = !!(me.token && unlocked);
    tb.hidden = !authed;
    document.body.classList.toggle('has-tabbar', authed);
    if (!authed) return;
    const h = location.hash.replace(/^#\/?/, '');
    const cur = /^(tasks|td\/)/.test(h) ? 'tasks'
      : /^(stats|staff|teammap)/.test(h) || (/^me\/./.test(h) && isManager()) ? 'stats'
      : /^(me|pin)/.test(h) ? 'me' : 'home';
    const c = cache.tasks ? taskCounts(cache.tasks) : null;
    const tabs = [['home', '#/', 'Сегодня', I.home], ['tasks', '#/tasks', 'Задания', I.tasks]]
      .concat(isManager() ? [['stats', '#/stats', 'Команда', I.team]] : [])
      .concat([['me', '#/me', 'Профиль', I.person]]);
    tb.innerHTML = tabs.map((t) => `<a href="${t[1]}" class="${cur === t[0] ? 'on' : ''}">${t[3]}${t[2]}
      ${t[0] === 'tasks' && c && c.mine + c.free ? `<span class="tb-badge">${c.mine + c.free}</span>` : ''}</a>`).join('');
  }

  function stopRefresh() { clearInterval(refreshTimer); refreshTimer = null; currentLoad = null; }

  function route() {
    stopRefresh();
    updateBanner();
    window.scrollTo(0, 0);
    if (!me.token) return loginView();
    if (!unlocked) return lockView();
    const h = location.hash.replace(/^#\/?/, '');
    let m;
    if ((m = h.match(/^r\/(\d+)$/))) return listView(Number(m[1]));
    if ((m = h.match(/^map\/(\d+)$/))) return mapView(Number(m[1]));
    if ((m = h.match(/^p\/(R\d+-\d+)$/))) return pointView(m[1]);
    if ((m = h.match(/^give\/(R\d+-\d+)$/))) return giveView(m[1]);
    if ((m = h.match(/^td\/(T[\w-]+)$/))) return taskDoneView(m[1]);
    if ((m = h.match(/^me(?:\/(.+))?$/))) return meView(m[1] ? decodeURIComponent(m[1]) : '');
    if (h === 'pin') return pinChangeView();
    if (h === 'tasks') return tasksView();
    if (h === 'stats') return statsView();
    if (h === 'staff') return staffView();
    if (h === 'teammap') return teamMapView();
    return homeView();
  }

  function showError(e, retry) {
    $app.innerHTML = '<div class="empty"><p>' + esc(e.message || 'Нет связи') + '</p>' +
      '<button class="btn" id="retry">Повторить</button></div>';
    $('retry').onclick = retry;
  }

  /* ---------- Вход: PIN, Face ID, блокировка ---------- */
  const HERO = '<div class="hero compact"><img src="icons/alina-logo.svg" alt="Alina Group"><p>Торговая команда</p></div>';
  const b64 = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));

  // Экран из 4 точек и цифровой клавиатуры. onPin вызывается, когда набраны 4 цифры.
  let padPress = null;
  function pinPad(opts) {
    let pin = '';
    let busy = false;
    $app.innerHTML = HERO + `
      <div class="card pin-card">
        <h2>${esc(opts.title)}</h2>
        ${opts.subtitle ? `<p class="muted">${esc(opts.subtitle)}</p>` : ''}
        <div class="pin-dots" id="dots"><span></span><span></span><span></span><span></span></div>
        <div class="pin-pad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}
          ${opts.onFaceId ? '<button type="button" data-k="face" class="pin-face" aria-label="Face ID">Face ID</button>' : '<span></span>'}
          <button type="button" data-k="0">0</button>
          <button type="button" data-k="del" class="pin-del" aria-label="Стереть">⌫</button>
        </div>
        ${opts.extra || ''}
      </div>`;
    const dots = () => { const d = $('dots'); if (d) d.querySelectorAll('span').forEach((s, i) => s.classList.toggle('on', i < pin.length)); };
    const pad = {
      shake() {
        const d = $('dots');
        if (!d) return;
        d.classList.remove('shake');
        void d.offsetWidth;
        d.classList.add('shake');
      },
    };
    padPress = async (k) => {
      if (busy || !$('dots')) return;
      if (k === 'face') return opts.onFaceId();
      if (k === 'del') pin = pin.slice(0, -1);
      else if (pin.length < 4) pin += k;
      dots();
      if (pin.length < 4) return;
      busy = true;
      const p = pin;
      try { await opts.onPin(p, pad); } finally { busy = false; pin = ''; dots(); }
    };
    $app.querySelectorAll('.pin-pad [data-k]').forEach((b) => { b.onclick = () => padPress(b.dataset.k); });
    return pad;
  }
  window.addEventListener('keydown', (e) => {
    if (!padPress || !$('dots') || (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName))) return;
    if (/^\d$/.test(e.key)) padPress(e.key);
    else if (e.key === 'Backspace') padPress('del');
  });

  // Локальная проверка PIN для экрана блокировки (без связи): PBKDF2-хэш, сам PIN не хранится
  async function pinDigest(pin, salt) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256));
  }
  async function savePinHash(pin) {
    try { const salt = b64(rnd(16)); store.set('pinHash', { agent: me.agent, salt, hash: await pinDigest(pin, salt) }); } catch (e) {}
  }
  async function checkPinLocal(pin) {
    const h = store.get('pinHash', null);
    if (!h || h.agent !== me.agent) return null;
    try { return (await pinDigest(pin, h.salt)) === h.hash; } catch (e) { return null; }
  }

  // Face ID / отпечаток: ключ на этом телефоне (WebAuthn), подтверждает разблокировку приложения
  const faceIdAvailable = async () => {
    try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; }
  };
  const faceIdOn = () => { const f = store.get('faceid', null); return !!(f && f.agent === me.agent); };
  async function faceIdEnable() {
    const cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'Alina Sales' },
      user: { id: rnd(16), name: me.agent, displayName: me.agent },
      challenge: rnd(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000, attestation: 'none',
    } });
    store.set('faceid', { agent: me.agent, id: b64(cred.rawId) });
  }
  async function faceIdUnlock() {
    const f = store.get('faceid', null);
    await navigator.credentials.get({ publicKey: {
      challenge: rnd(32), timeout: 60000, userVerification: 'required',
      allowCredentials: [{ type: 'public-key', id: unb64(f.id), transports: ['internal'] }],
    } });
  }

  function loginView() {
    setBar('Alina Sales');
    const a = ui.auth;
    if (a.step === 'name' || !a.name) {
      $app.innerHTML = HERO + `
        <div class="card">
          <h2>Вход</h2>
          <p class="muted">Укажите имя и фамилию — по ним видно, кто взял точку или задание. Дальше вход по PIN или Face ID.</p>
          <form id="login">
            <div class="field"><label for="agent">Имя и фамилия</label>
              <input type="text" id="agent" autocomplete="name" required value="${esc(a.name)}"></div>
            <button class="btn primary" type="submit">Далее</button>
          </form>
        </div>`;
      $('login').onsubmit = (ev) => {
        ev.preventDefault();
        const name = $('agent').value.trim().replace(/\s+/g, ' ');
        if (name.length < 2) return toast('Укажите имя и фамилию', true);
        Object.assign(a, { name, step: 'pin', pin1: '' });
        store.set('lastAgent', name);
        loginView();
      };
      return;
    }
    const other = '<button class="link-btn" id="other">← Другое имя</button>';
    if (a.step === 'pin') {
      pinPad({
        title: a.name, subtitle: 'Введите PIN', extra: other,
        onPin: async (pin, pad) => {
          try {
            await finishLogin(await api.login(a.name, pin), pin);
          } catch (e) {
            if (e.code === 'not_registered') { Object.assign(a, { step: 'confirm', pin1: pin }); return loginView(); }
            pad.shake();
            toast(e.server ? e.message : 'Нет связи', true);
          }
        },
      });
    } else {
      pinPad({
        title: 'Повторите PIN',
        subtitle: `«${a.name}» входит впервые. Повторите PIN — он станет вашим кодом входа.`,
        extra: `<details class="mgr"><summary>Я руководитель</summary>
            <div class="field"><input type="password" id="mcode" inputmode="numeric" autocomplete="off" placeholder="Код руководителя"></div>
          </details>` + other,
        onPin: async (pin, pad) => {
          if (pin !== a.pin1) {
            Object.assign(a, { step: 'pin', pin1: '' });
            toast('PIN не совпал — наберите заново', true);
            return loginView();
          }
          try {
            await finishLogin(await api.register(a.name, pin, ($('mcode') || {}).value || ''), pin);
          } catch (e) {
            pad.shake();
            toast(e.server ? e.message : 'Нет связи', true);
            if (e.code === 'exists') { Object.assign(a, { step: 'pin', pin1: '' }); loginView(); }
          }
        },
      });
    }
    $('other').onclick = () => { Object.assign(a, { step: 'name', pin1: '' }); loginView(); };
  }

  async function finishLogin(s, pin) {
    me.agent = s.name; me.role = s.role; me.token = s.token;
    store.set('agent', s.name); store.set('lastAgent', s.name); store.set('role', s.role); store.set('token', s.token);
    store.set('lock:fails', 0);
    await savePinHash(pin);
    ui.auth = { step: 'pin', name: s.name, pin1: '' };
    const f = store.get('faceid', null);
    if (f && f.agent !== s.name) store.del('faceid');
    unlocked = true;
    prefetchedAt = 0;
    prefetch();
    if (!faceIdOn() && faceIdOk && !store.get('faceid:skip:' + s.name, false)) return faceIdOffer();
    location.hash = '#/';
    route();
    flushOutbox();
  }

  function faceIdOffer() {
    setBar('Alina Sales');
    $app.innerHTML = HERO + `
      <div class="card" style="text-align:center">
        <div style="font-size:44px">🙂</div>
        <h2>Входить по Face ID?</h2>
        <p class="muted">Приложение будет открываться по Face ID (или отпечатку) вместо PIN. PIN остаётся запасным способом.</p>
        <button class="btn primary" id="fon">Включить Face ID</button>
        <button class="link-btn" id="foff">Не сейчас</button>
      </div>`;
    const done = () => { location.hash = '#/'; route(); flushOutbox(); };
    $('fon').onclick = async () => {
      try { await faceIdEnable(); toast('Face ID включён'); } catch (e) { toast('Не получилось включить Face ID', true); }
      done();
    };
    $('foff').onclick = () => { store.set('faceid:skip:' + me.agent, true); done(); };
  }

  function lockView() {
    setBar('Alina Sales');
    const hasFace = faceIdOn();
    const tryFace = async () => {
      try { await faceIdUnlock(); unlock(); } catch (e) { /* отменили — остаётся ввод PIN */ }
    };
    pinPad({
      title: me.agent, subtitle: hasFace ? 'Face ID или PIN' : 'Введите PIN',
      onFaceId: hasFace ? tryFace : null,
      extra: '<button class="link-btn" id="logout">Выйти / другой сотрудник</button>',
      onPin: async (pin, pad) => {
        const okLocal = await checkPinLocal(pin);
        if (okLocal === true) return unlock();
        if (okLocal === null) {
          // На этом телефоне PIN ещё не сохранён — проверяем на сервере
          try { return await finishLogin(await api.login(me.agent, pin), pin); } catch (e) {
            pad.shake();
            return toast(e.server ? e.message : 'Нет связи', true);
          }
        }
        const fails = (store.get('lock:fails', 0) || 0) + 1;
        store.set('lock:fails', fails);
        if (fails >= 5) return logout('Слишком много попыток — войдите заново');
        pad.shake();
        toast('Неверный PIN. Осталось попыток: ' + (5 - fails), true);
      },
    });
    $('logout').onclick = () => logout('', true);
    if (hasFace && !lockView.tried) { lockView.tried = true; tryFace(); }
  }

  function unlock() {
    unlocked = true;
    store.set('lock:fails', 0);
    route();
    flushOutbox();
    prefetch();
  }

  function lock() {
    unlocked = false;
    lockView.tried = false;
    route();
  }

  // Выход: токен и PIN-хэш стираются; otherPerson — сразу на ввод имени
  function logout(msg, otherPerson) {
    me.token = ''; me.role = '';
    store.del('token'); store.del('role'); store.del('pinHash');
    unlocked = false;
    lockView.tried = false;
    ui.auth = { step: otherPerson ? 'name' : 'pin', name: otherPerson ? '' : me.agent, pin1: '' };
    // Личные данные прошлого сотрудника не остаются на телефоне
    cache.me = {}; cache.stats = {}; cache.staff = null;
    ['me', 'stats', 'staff'].forEach((k) => store.del('cache:' + k));
    prefetchedAt = 0;
    if (msg) toast(msg, true);
    location.hash = '#/';
    route();
  }

  // Сервер не принял токен (PIN сброшен, сменён на другом телефоне, доступ закрыт)
  function authLost(msg) {
    if (!me.token) return;
    logout(msg || 'Войдите заново');
  }

  function pinChangeView() {
    setBar('Смена PIN', '#/me');
    const st = { step: 'old', old: '', pin1: '' };
    const show = () => {
      const titles = { old: 'Текущий PIN', new1: 'Новый PIN', new2: 'Повторите новый PIN' };
      pinPad({
        title: titles[st.step],
        onPin: async (pin, pad) => {
          if (st.step === 'old') { st.old = pin; st.step = 'new1'; return show(); }
          if (st.step === 'new1') { st.pin1 = pin; st.step = 'new2'; return show(); }
          if (pin !== st.pin1) { toast('PIN не совпал', true); st.step = 'new1'; return show(); }
          try {
            const s = await api.pinChange(st.old, pin);
            me.token = s.token;
            store.set('token', s.token);
            await savePinHash(pin);
            toast('PIN изменён');
            location.hash = '#/me';
          } catch (e) {
            pad.shake();
            toast(e.server ? e.message : 'Нет связи', true);
            Object.assign(st, { step: 'old', old: '', pin1: '' });
            show();
          }
        },
      });
      setBar('Смена PIN', '#/me');
    };
    show();
  }

  /* ---------- Загрузка данных: один запрос на старте, предзагрузка остального ---------- */
  // Маршруты, задания, свой день (и «Сегодня» команды у руководителя) — одним запросом вместо трёх
  function refreshAll() {
    return api.boot(periodStart('day')).then((d) => {
      d.routes.sort((a, b) => a.route - b.route);
      cache.summary = d.routes; saveCache('summary');
      cache.tasks = d.tasks; saveCache('tasks');
      cache.me['|day'] = d.me; saveCache('me');
      if (d.stats) { cache.stats.today = d.stats; saveCache('stats'); }
      updateTabbar();
      return d;
    });
  }

  // После входа в фоне подтягиваются точки всех маршрутов, сотрудники и карта — переходы потом без ожидания
  let prefetchedAt = 0;
  function prefetch() {
    if (Date.now() - prefetchedAt < 5 * 60000) return;
    prefetchedAt = Date.now();
    setTimeout(async () => {
      try {
        // Главная сама делает этот запрос — на других экранах делаем его здесь
        if (location.hash.replace(/^#\/?/, '') !== '') await refreshAll();
        else await new Promise((r) => setTimeout(r, 2500));
        for (const r of cache.summary || []) {
          if (!me.token) return;
          await loadPoints(r.route);
        }
        if (isManager()) { cache.staff = await api.staff(); saveCache('staff'); }
      } catch (e) { /* без связи — догрузится при следующем открытии */ }
      loadLeaflet().catch(() => {});
    }, 800);
  }

  /* ---------- Главная: задания, статистика, маршруты ---------- */
  async function loadTasks() {
    const ts = await api.tasks();
    cache.tasks = ts;
    store.set('cache:tasks', ts);
    updateTabbar();
    return ts;
  }
  function updateCachedTask(t) {
    if (!t || !cache.tasks) return;
    const i = cache.tasks.findIndex((x) => x.id === t.id);
    if (i >= 0) cache.tasks[i] = t; else cache.tasks.push(t);
    store.set('cache:tasks', cache.tasks);
  }

  function homeView() {
    setBar('Сегодня');
    const isHome = () => location.hash.replace(/^#\/?/, '') === '';
    const dateLine = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    const tasksRow = () => {
      const c = cache.tasks ? taskCounts(cache.tasks) : null;
      if (!c) return '';
      return `<div class="list">
        <a class="row-item has-icon" href="#/tasks"><span class="ri-icon">${I.tasks}</span>
          <span class="grow"><span class="ri-title">Задания</span>
            <span class="ri-sub" style="display:block">Свободных ${c.free} · мои ${c.mine}${c.overdue ? ` · <b style="color:var(--bad)">просрочено ${c.overdue}</b>` : ''}</span></span>${chev}</a>
      </div>`;
    };
    const render = (routes) => {
      $app.innerHTML = `<div class="subtitle">${esc(me.agent.split(' ')[0])} · ${esc(dateLine)}</div>` +
        goalCard(cache.me['|day']) + tasksRow() +
        '<div class="section-title">Маршруты</div>' + (routes ? '<div class="list">' + routes.map((r) => {
          const pd = r.total ? (r.done / r.total) * 100 : 0;
          const pw = r.total ? (r.work / r.total) * 100 : 0;
          return `<a class="row-item" href="#/r/${r.route}">
            <span class="grow"><span class="ri-title">Маршрут ${r.route}</span>
              ${r.title ? `<span class="ri-sub" style="display:block">${esc(r.title)}</span>` : ''}
              <span class="progress" style="display:flex"><span class="done" style="width:${pd}%"></span><span class="work" style="width:${pw}%"></span></span>
              <span class="ri-sub">Выполнено ${r.done} из ${r.total}${r.work ? ' · в работе ' + r.work : ''}</span></span>
            ${chev}</a>`;
        }).join('') + '</div><p class="muted" style="text-align:center">Старт: Алматы, Казыбаева 20</p>' : '<div class="spinner">Загрузка…</div>');
      if ($('homeDay')) $('homeDay').onclick = async (ev) => {
        ev.target.disabled = true;
        ev.target.textContent = 'Определяем местоположение…';
        try { await api.dayStart(await getGeo()); toast('Рабочий день начат'); } catch (e) { toast(e.server ? e.message : 'Нет связи', true); }
        refreshAll().then(() => { if (isHome()) render(cache.summary); }).catch(() => {});
      };
    };
    render(cache.summary);
    const load = () => refreshAll().then(() => { if (isHome()) render(cache.summary); })
      .catch((e) => { if (!cache.summary) showError(e, homeView); else toast('Нет связи', true); });
    load();
    currentLoad = load;
    refreshTimer = setInterval(load, 60000);
  }

  /* ---------- Список точек ---------- */
  async function loadPoints(routeNo) {
    const pts = await api.points(routeNo);
    cache.points[routeNo] = pts;
    store.set('cache:points:' + routeNo, pts);
    return pts;
  }
  const cachedPoints = (routeNo) => cache.points[routeNo] || store.get('cache:points:' + routeNo, null);

  function listView(routeNo) {
    setBar('Маршрут ' + routeNo, '#/', { icon: I.map, href: '#/map/' + routeNo, label: 'Карта маршрута' });
    const hash = location.hash;
    const group = (items) => '<div class="list">' + items.map(itemHtml).join('') + '</div>';

    const itemHtml = (p) => {
      const mine = p.status === 'в работе' && p.agent === me.agent;
      let badge = '';
      if (isPending(p.id)) badge = '<span class="badge work">ждёт отправки</span>';
      else if (p.status === 'выполнена') badge = `<span class="badge done">✓ ${esc(p.agent)}</span>`;
      else if (mine) badge = '<span class="badge work">у вас в работе</span>';
      else if (p.status === 'в работе') badge = `<span class="badge work">взял(а): ${esc(p.agent)}</span>`;
      if (p.visits > 1) badge += `<span class="badge info">${p.visits} ${plural(p.visits, 'визит', 'визита', 'визитов')}</span>`;
      const dist = ui.pos && hasCoords(p) ? `<span class="dist">${km(ui.pos, p).toFixed(1)} км</span>` : '';
      return `<a class="row-item point${mine ? ' mine' : ''}" href="#/p/${p.id}">
        <span class="num">${p.n}</span>
        <span class="grow"><div class="name">${esc(p.name)}</div>
          <div class="addr">${esc(p.type)}${p.type ? ' · ' : ''}${esc(cleanAddr(p.address))}</div>${badge}</span>
        ${dist}${chev}</a>`;
    };

    const render = (pts) => {
      if (location.hash !== hash) return;
      const q = ui.q.trim().toLowerCase();
      const match = (p) => !q || (p.name + ' ' + p.address + ' ' + p.type + ' ' + p.n).toLowerCase().includes(q);
      let list = pts.filter(match);
      if (ui.sort === 'near' && ui.pos) {
        list = list.slice().sort((a, b) => (hasCoords(a) ? km(ui.pos, a) : 1e9) - (hasCoords(b) ? km(ui.pos, b) : 1e9));
      }
      const mine = list.filter((p) => p.status === 'в работе' && p.agent === me.agent && !isPending(p.id));
      const free = list.filter((p) => p.status === 'свободна' && !isPending(p.id));
      const taken = list.filter((p) => p.status === 'в работе' && p.agent !== me.agent && !isPending(p.id));
      const done = list.filter((p) => p.status === 'выполнена' || isPending(p.id));

      const searchFocused = document.activeElement && document.activeElement.id === 'q';
      const caret = searchFocused ? document.activeElement.selectionStart : null;
      $app.innerHTML = `
        <div class="tools">
          <input class="search" id="q" type="search" placeholder="Поиск по названию или адресу" value="${esc(ui.q)}">
          <div class="seg"><button data-sort="order" class="${ui.sort === 'order' ? 'on' : ''}">По порядку</button>
            <button data-sort="near" class="${ui.sort === 'near' ? 'on' : ''}">Ближайшие</button></div>
        </div>
        <div class="seg tabs">
          <button data-tab="free" class="${ui.tab === 'free' ? 'on' : ''}">Свободные<b>${free.length + mine.length}</b></button>
          <button data-tab="taken" class="${ui.tab === 'taken' ? 'on' : ''}">Заняты<b>${taken.length}</b></button>
          <button data-tab="done" class="${ui.tab === 'done' ? 'on' : ''}">Выполнено<b>${done.length}</b></button>
        </div>
        ${ui.tab === 'free' ? `
          ${mine.length ? '<div class="section-title">У меня в работе</div>' + group(mine) : ''}
          <div class="section-title">Свободные</div>
          ${free.length ? group(free) : '<div class="empty">Свободных точек нет</div>'}` : ''}
        ${ui.tab === 'taken' ? (taken.length ? group(taken) : '<div class="empty">Нет точек, занятых другими</div>') : ''}
        ${ui.tab === 'done' ? (done.length ? group(done) : '<div class="empty">Выполненных точек пока нет</div>') : ''}`;

      const qi = $('q');
      qi.oninput = () => { ui.q = qi.value; render(pts); };
      if (searchFocused) { qi.focus(); qi.setSelectionRange(caret, caret); }
      $app.querySelectorAll('[data-sort]').forEach((b) => {
        b.onclick = () => {
          ui.sort = b.dataset.sort;
          if (ui.sort === 'near') locate(() => render(pts)); else render(pts);
        };
      });
      $app.querySelectorAll('[data-tab]').forEach((b) => {
        b.onclick = () => { ui.tab = b.dataset.tab; store.set('ui:tab', ui.tab); render(pts); };
      });
    };

    const cached = cachedPoints(routeNo);
    if (cached) render(cached); else $app.innerHTML = '<div class="spinner">Загрузка точек…</div>';
    const load = () => loadPoints(routeNo).then(render)
      .catch((e) => { if (!cachedPoints(routeNo)) showError(e, () => listView(routeNo)); else toast('Нет связи — показан сохранённый список', true); });
    load();
    if (ui.sort === 'near') locate(() => render(cachedPoints(routeNo) || []));
    currentLoad = load;
    refreshTimer = setInterval(() => { if (document.activeElement?.id !== 'q') load(); }, 60000);
  }

  function locate(done) {
    if (!navigator.geolocation) { toast('Геолокация недоступна', true); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { ui.pos = { lat: pos.coords.latitude, lon: pos.coords.longitude }; done(); },
      () => { toast('Разрешите доступ к геолокации в настройках Safari', true); ui.sort = 'order'; done(); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  /* ---------- Фото ---------- */
  function bindPhotos(input, box, list, max) {
    const draw = () => {
      box.innerHTML = list.map((src, i) => `<div class="ph"><img src="${src}" alt=""><button type="button" data-i="${i}">×</button></div>`).join('');
      box.querySelectorAll('button').forEach((b) => { b.onclick = () => { list.splice(Number(b.dataset.i), 1); draw(); }; });
    };
    input.onchange = async (ev) => {
      const files = Array.from(ev.target.files || []);
      ev.target.value = '';
      for (const file of files) {
        if (list.length >= max) { toast('Не больше ' + max + ' фото', true); break; }
        try { list.push(await compress(file)); } catch (e) { toast('Не удалось прочитать фото', true); }
      }
      draw();
    };
    draw();
  }

  /* ---------- Точка ---------- */
  function chips(name, options, type, values) {
    return '<div class="chips">' + options.map((o) => `<label><input type="${type}" name="${name}" value="${esc(o)}"
      ${values.indexOf(o) >= 0 ? 'checked' : ''}>${esc(o)}</label>`).join('') + '</div>';
  }

  async function loadPoint(id) {
    const routeNo = routeOf(id);
    let p = (cachedPoints(routeNo) || []).find((x) => x.id === id);
    if (!p) p = (await loadPoints(routeNo)).find((x) => x.id === id);
    if (!p) throw new Error('Точка не найдена');
    return p;
  }

  async function pointView(id) {
    const routeNo = routeOf(id);
    setBar('Маршрут ' + routeNo, '#/r/' + routeNo);
    const hash = location.hash;
    let p = (cachedPoints(routeNo) || []).find((x) => x.id === id);
    if (!p) {
      $app.innerHTML = '<div class="spinner">Загрузка…</div>';
      try { p = await loadPoint(id); } catch (e) { return showError(e, () => pointView(id)); }
    }
    let photos = [];
    let editing = null; // значения анкеты, когда автор её редактирует
    let revisit = null; // новый визит на выполненную точку: контакты из прошлой анкеты
    const openSects = new Set(['assort']);
    let history = null; // визиты точки, когда история открыта
    let ptasks = cache.tasks ? cache.tasks.filter((t) => t.point === id) : null; // сразу из сохранённых, потом обновятся
    renderPoint();
    // Актуальный статус с сервера
    loadPoints(routeNo).then((pts) => {
      const fresh = pts.find((x) => x.id === id);
      if (fresh && location.hash === hash && !editing && !revisit &&
        (fresh.status !== p.status || fresh.agent !== p.agent || fresh.visits !== p.visits)) {
        p = fresh;
        renderPoint();
      }
    }).catch(() => {});
    loadPointTasks();

    function loadPointTasks() {
      api.tasks(id).then((ts) => {
        ptasks = ts;
        ts.forEach(updateCachedTask);
        if (location.hash === hash) drawTasks();
      }).catch(() => {});
    }

    function drawTasks() {
      const box = $('ptasks');
      if (!box || !ptasks) return;
      const list = ptasks.filter((t) => t.status !== 'отменено').sort(taskSort);
      box.innerHTML = list.length ? '<div class="section-title">Задания по точке</div>' +
        list.map((t) => taskCard(t, { noPoint: true })).join('') : '';
      bindTaskActions(box, loadPointTasks);
    }

    function drawHistory() {
      const box = $('histbox');
      if (!box || !history) return;
      box.innerHTML = history.length ? '<ul class="history">' + history.slice().reverse().map((v) => `<li>
          <b>Визит ${v.visit}</b> · ${esc(v.time)} · ${esc(v.agent)}
          ${v.interest ? `<div class="muted">Интерес: ${esc(v.interest)}${v.distance !== '' && v.distance != null
            ? ` · ${v.distance > FAR_METERS ? '⚠️ ' : ''}${esc(v.distance)} м от точки` : v.gps ? ' · GPS отмечен' : ' · без GPS'}</div>` : ''}
          ${v.nextStep ? `<div>${esc(v.nextStep)}</div>` : ''}
        </li>`).join('') + '</ul>' : '<div class="muted">Визитов нет</div>';
    }

    function renderPoint() {
      const draft = store.get('draft:' + id, {});
      const mine = p.status === 'в работе' && p.agent === me.agent;
      const other = p.status === 'в работе' && !mine;
      const done = p.status === 'выполнена';
      const pending = isPending(id);
      const canFill = (!other && !done && !pending) || !!editing || !!revisit;
      const ownDone = done && !pending;
      const src = editing || (revisit ? Object.assign({}, revisit, draft) : draft);

      let status = '';
      if (pending) status = '<div class="status-box work">Анкета сохранена и ждёт отправки (нет связи)</div>';
      else if (done) {
        status = `<div class="status-box done">✓ Выполнена — ${esc(p.agent)}${p.visits > 1 ? ` · визитов: ${p.visits}` : ''}
          ${p.lastVisit ? `<div class="muted" style="font-weight:400">Последний визит: ${esc(p.lastVisit)}</div>` : ''}</div>`;
      } else if (other) status = `<div class="status-box other">Точку взял(а): ${esc(p.agent)}</div>`;
      else if (mine) status = '<div class="status-box work">У вас в работе</div>';

      // Телефоны точки (если есть в базе) подставляются в анкету по умолчанию
      const known = { phone: p.phone || '', whatsapp: p.whatsapp || '' };
      const d = (k) => esc(src[k] != null ? src[k] : (known[k] || ''));
      const formTitle = editing ? 'Изменение анкеты' : revisit ? 'Новый визит' : 'Анкета точки';
      const sect = (key, title, body) => `<details class="sect" data-s="${key}"${openSects.has(key) ? ' open' : ''}>
        <summary>${esc(title)}</summary>${body}</details>`;
      const num = (key, label, group) => `<label class="num">${esc(label)}<input type="text" inputmode="decimal"
        name="${esc(key)}"${group ? ` data-g="${group}"` : ''} value="${d(key)}"></label>`;
      const nums = (prefix, names, group) => `<div class="num-grid">${names.map((n) => num(prefix + ':' + n, n, group)).join('')}</div>`;
      const sum = (group) => `<div class="sum" data-sum="${group}"></div>`;
      const salesBlock = (title, totalKey, parts, brands) => `<div class="field"><span class="label">${esc(title)}</span>
        <div class="num-grid">${num(totalKey, 'Всего, тенге')}</div>
        <div class="sub-label">Доля в продажах, %</div>
        <div class="num-grid">${parts.map((x) => num(x[0], x[1], totalKey)).join('')}</div>${sum(totalKey)}
        ${brands.map((x) => `<div class="sub-label">${esc(x[1])}: доли брендов, %</div>${nums(x[0], x[2], x[0])}${sum(x[0])}`).join('')}</div>`;
      // Быстрые действия, как в «Контактах» iPhone: маршрут, звонок, WhatsApp, карточка 2ГИС
      const quick = [
        `<button class="qa main" id="go">${I.car}<span>Маршрут</span></button>`,
        p.phone ? `<a class="qa" href="tel:${esc(telDigits(p.phone))}">${I.phone}<span>Позвонить</span></a>` : '',
        waUrl(p.whatsapp) ? `<a class="qa" href="${waUrl(p.whatsapp)}" target="_blank" rel="noopener">${I.chat}<span>WhatsApp</span></a>` : '',
        `<a class="qa" href="${gisSearchUrl(p)}" target="_blank" rel="noopener">${I.pin}<span>2ГИС</span></a>`,
      ].join('');
      $app.innerHTML = `
        <div class="card point-head">
          <div class="muted">№ ${p.n}${p.type ? ' · ' + esc(p.type) : ''}</div>
          <h2>${esc(p.name)}</h2>
          <div class="addr">${esc(p.address)}</div>
          ${p.phone ? `<div class="addr">${esc(p.phone)}</div>` : ''}
          <div class="quick">${quick}</div>
          ${routable(p) ? '' : '<div class="muted" style="font-size:13px">«Маршрут» откроет карточку фирмы в 2ГИС — нажмите там «Проехать».</div>'}
          ${status}
          ${!done && !other && !pending ? (mine
            ? '<button class="btn ghost" id="release">Отказаться от точки</button>'
            : `<button class="btn primary" id="claim">${I.check} Беру в работу</button>`) : ''}
          ${ownDone && !editing && !revisit ? `<div class="btns">
            <a class="btn primary wide" href="#/give/${id}">${I.plus} Дать задание</a>
            <button class="btn wide" id="revisit">${I.repeat} Новый визит</button>
            <button class="btn ghost" id="edit">${I.edit} Изменить</button>
            <button class="btn danger" id="remove">${I.trash} Удалить</button></div>
            <button class="link-btn" id="hist">${history ? 'Скрыть историю' : 'История визитов (' + (p.visits || 1) + ')'}</button>
            <div id="histbox"></div>` : ''}
          ${!done && !pending ? `<a class="btn" href="#/give/${id}" style="margin-top:8px">${I.plus} Дать задание</a>` : ''}
        </div>
        <div id="ptasks"></div>
        ${canFill ? `
        <form class="card" id="f" autocomplete="off">
          <h2 style="margin-bottom:12px">${formTitle}</h2>
          <div class="field"><label>Контактное лицо</label><input type="text" name="contact" value="${d('contact')}"></div>
          <div class="field"><label>Должность</label><input type="text" name="position" placeholder="владелец, продавец, закупщик…" value="${d('position')}"></div>
          <div class="field"><label>Телефон</label><input type="tel" name="phone" placeholder="+7" value="${d('phone')}"></div>
          <div class="field"><label>WhatsApp</label><input type="tel" name="whatsapp" placeholder="если отличается" value="${d('whatsapp')}"></div>
          <div class="field"><label>Instagram / сайт</label><input type="text" name="instagram" autocapitalize="off" value="${d('instagram')}"></div>
          <div class="field"><span class="label">Работаем / Не работаем?</span>${chips('alina', ALINA, 'radio', [src.alina])}</div>
          ${sect('place', 'Точка, помещение и склад', `
            <div class="field"><label>АК Alina Group</label><input type="text" name="manager" value="${d('manager')}"></div>
            <div class="field"><span class="label">Формат торговой точки</span>${chips('format', TT_FORMATS, 'radio', [src.format])}
              <input type="text" name="formatDesc" placeholder="Описание, если «Другое»" style="margin-top:8px" value="${d('formatDesc')}"></div>
            <div class="field"><span class="label">Площадь, м²</span><div class="num-grid">${num('areaHall', 'Торговый зал')}${num('areaStock', 'Склад')}</div></div>
            <div class="field"><span class="label">Текущие условия оплаты</span>${chips('payment', PAYMENT, 'radio', [src.payment])}</div>
            <div class="field"><span class="label">Проходимость и расположение</span>${chips('traffic', TRAFFIC, 'radio', [src.traffic])}</div>
            <div class="field"><span class="label">Готовность работать с Alina Group по всем категориям</span>${chips('ready', READY, 'radio', [src.ready])}</div>`)}
          ${sect('assort', 'Ассортимент и бренды', `
            <div class="field"><span class="label">Ассортимент</span>${chips('assortment', ASSORTMENT, 'checkbox', src.assortment || [])}
              <input type="text" name="assortmentOther" placeholder="Другое" style="margin-top:8px" value="${d('assortmentOther')}"></div>
            <div class="field"><span class="label">Бренды конкурентов на полке</span>${chips('competitors', COMPETITORS, 'checkbox', src.competitors || [])}
              <input type="text" name="competitorsOther" placeholder="Другие бренды" style="margin-top:8px" value="${d('competitorsOther')}"></div>
            <div class="field"><span class="label">Наши бренды в точке</span>${chips('ourBrands', OUR_BRANDS, 'checkbox', src.ourBrands || [])}</div>
            <div class="field"><label>Поставщик (у кого закупаются)</label><input type="text" name="supplier" value="${d('supplier')}"></div>`)}
          ${sect('equip', 'Оборудование в точке', `
            ${EQUIP_BRANDS.map((b) => `<div class="field"><span class="label">${esc(b)}</span>
              <div class="num-grid">${num('shelf:' + b, 'Полки, шт')}${num('end:' + b, 'Торцы, шт')}</div></div>`).join('')}
            <div class="field"><span class="label">Колеровочное оборудование (КО), шт</span>${nums('ko', KO_BRANDS)}</div>`)}
          ${sect('branding', 'Брендинг', BRANDING_BRANDS.map((b) => `<div class="field"><span class="label">${esc(b)}</span>
            ${chips('brand:' + b, BRANDING_KINDS, 'checkbox', src['brand:' + b] || [])}</div>`).join(''))}
          ${sect('shelf', 'Полка и склад: фейсы и паллеты', `
            <div class="field"><span class="label">Краски ВДК, фейсов на полке</span>${nums('fVdk', PAINT_BRANDS)}</div>
            <div class="field"><span class="label">Алкиды, фейсов на полке</span>${nums('fAlk', PAINT_BRANDS)}</div>
            <div class="field"><span class="label">ССС без затирок, паллет на складе</span>${nums('pSss', SSS_BRANDS)}</div>
            <div class="field"><span class="label">Затирки, фейсов на полке</span>${nums('fGrout', SSS_BRANDS)}</div>
            <div class="field"><span class="label">Герметики, фейсов на полке</span>${nums('fSeal', SEAL_BRANDS)}</div>
            <div class="field"><span class="label">Пены, фейсов на полке</span>${nums('fFoam', SEAL_BRANDS)}</div>`)}
          ${sect('sales', 'Объёмы продаж за последний год', `
            ${salesBlock('Краски', 'sPaint', [['shareVdk', 'ВДК'], ['shareAlk', 'Алкиды']], [['dVdk', 'ВДК', PAINT_BRANDS], ['dAlk', 'Алкиды', PAINT_BRANDS]])}
            ${salesBlock('ССС', 'sSss', [['shareSss', 'ССС без затирок'], ['shareGrout', 'Затирки']], [['dSss', 'ССС без затирок', SSS_BRANDS], ['dGrout', 'Затирки', SSS_BRANDS]])}
            ${salesBlock('Герметики и пены', 'sSeal', [['shareSeal', 'Герметики'], ['shareFoam', 'Пены']], [['dSeal', 'Герметики', SEAL_BRANDS], ['dFoam', 'Пены', SEAL_BRANDS]])}`)}
          ${sect('extra', 'Билборды и мастер-классы', `
            <div class="field"><span class="label">Билборды рядом с точкой под аренду</span>
              <div class="num-grid">${num('billboardCount', 'Количество')}</div>
              <label class="num" style="margin-top:8px">Адрес<textarea name="billboardAddr">${d('billboardAddr')}</textarea></label>
              <label class="num" style="margin-top:8px">Контакт<textarea name="billboardContact">${d('billboardContact')}</textarea></label></div>
            <div class="field"><span class="label">Мастер-классы ОТЭК в точке за последний год</span>
              <div class="num-grid">${num('masterClasses', 'Количество')}</div></div>`)}
          <div class="field"><span class="label">Интерес к сотрудничеству <span class="req">*</span></span>${chips('interest', INTEREST, 'radio', [src.interest])}</div>
          <div class="field"><label>Итог / следующий шаг</label><textarea name="nextStep" placeholder="Например: отправить прайс в WhatsApp, перезвонить в пятницу">${d('nextStep')}</textarea></div>
          <div class="field"><label>Дата следующего шага</label><input type="date" name="nextDate" min="${today()}" value="${d('nextDate')}">
            <div class="muted" style="margin-top:4px">Появится в «Моих делах» в этот день</div></div>
          <div class="field"><label>Комментарий</label><textarea name="comment">${d('comment')}</textarea></div>
          <div class="field"><span class="label">Фото витрины</span>
            <label class="btn file-btn">${I.camera} Добавить фото<input type="file" id="photo" accept="image/*" multiple></label>
            ${editing && editing.photoCount ? `<div class="muted">Уже загружено фото: ${editing.photoCount}. Новые добавятся к ним.</div>` : ''}
            <div class="photos" id="photos"></div></div>
          ${editing ? '' : '<p class="muted" style="font-size:13px">При отправке отметится ваше местоположение — так видно, что визит был на точке.</p>'}
          <button class="btn ok" type="submit" id="submit">${editing ? 'Сохранить изменения' : '✓ Выполнено — отправить'}</button>
          ${editing || revisit ? '<button class="btn ghost" type="button" id="cancelEdit" style="margin-top:8px">Отмена</button>' : ''}
        </form>` : ''}`;

      $('go').onclick = () => openRoute(p);
      if ($('claim')) $('claim').onclick = (ev) => act(ev.target, () => api.claim(id), 'Точка ваша');
      if ($('release')) $('release').onclick = (ev) => {
        if (confirm('Вернуть точку в свободные?')) act(ev.target, () => api.release(id), 'Точка освобождена');
      };
      const byOther = p.agent && p.agent !== me.agent ? 'Анкету заполнил(а) ' + p.agent + '. ' : '';
      if ($('edit')) $('edit').onclick = (ev) => { if (!byOther || confirm(byOther + 'Изменить её?')) startEdit(ev.target); };
      if ($('remove')) $('remove').onclick = (ev) => {
        const what = p.visits > 1 ? 'Удалить анкету последнего визита?' : 'Удалить анкету? Точка снова станет свободной.';
        if (confirm(byOther + what + ' Фото уйдут в корзину Google Диска.')) {
          history = null;
          act(ev.target, () => api.remove(id), 'Анкета удалена');
        }
      };
      if ($('revisit')) $('revisit').onclick = (ev) => startRevisit(ev.target);
      if ($('hist')) $('hist').onclick = () => toggleHistory();
      drawHistory();
      drawTasks();
      if ($('cancelEdit')) $('cancelEdit').onclick = () => { editing = null; revisit = null; photos = []; renderPoint(); };
      const f = $('f');
      if (!f) return;
      f.oninput = () => {
        updateSums(f);
        if (!editing) store.set('draft:' + id, readForm(f));
      };
      updateSums(f);
      // Открытые разделы не сворачиваются, когда форма перерисовывается
      f.querySelectorAll('details.sect').forEach((el) => {
        el.ontoggle = () => { if (el.open) openSects.add(el.dataset.s); else openSects.delete(el.dataset.s); };
      });
      bindPhotos($('photo'), $('photos'), photos, 6);
      f.onsubmit = (ev) => { ev.preventDefault(); submit(f); };
    }

    async function toggleHistory() {
      if (history) { history = null; renderPoint(); return; }
      $('hist').disabled = true;
      try { history = await api.history(id); } catch (e) { toast(e.server ? e.message : 'Нет связи', true); }
      if (location.hash === hash) renderPoint();
    }

    async function act(btn, fn, okMsg) {
      btn.disabled = true;
      try {
        p = await fn();
        updateCached(p);
        toast(okMsg);
      } catch (e) {
        toast(e.server ? e.message : 'Нет связи, попробуйте ещё раз', true);
        try { const fresh = (await loadPoints(routeNo)).find((x) => x.id === id); if (fresh) p = fresh; } catch (_) {}
      }
      if (location.hash === hash) renderPoint();
    }

    async function startEdit(btn) {
      btn.disabled = true;
      try {
        const r = await api.result(id);
        if (!r) throw Object.assign(new Error('Анкета не найдена в таблице'), { server: true });
        editing = toEditForm(r);
        photos = [];
      } catch (e) {
        toast(e.server ? e.message : 'Нет связи, попробуйте ещё раз', true);
      }
      if (location.hash === hash) renderPoint();
      if (editing && $('f')) $('f').scrollIntoView();
    }

    // Новый визит: контакты, поставщик и данные о помещении берутся из последней анкеты, остальное заполняется заново
    async function startRevisit(btn) {
      btn.disabled = true;
      let base = {};
      try {
        const r = await api.result(id);
        if (r) ['contact', 'position', 'phone', 'whatsapp', 'instagram', 'supplier', 'alina', 'manager', 'format',
          'formatDesc', 'payment', 'traffic', 'ready', 'areaHall', 'areaStock']
          .forEach((k) => { if (r[k]) base[k] = r[k]; });
        if (base.alina) base.alina = OLD_ALINA[base.alina] || base.alina;
      } catch (e) { base = {}; }
      revisit = base;
      photos = [];
      if (location.hash === hash) renderPoint();
      if ($('f')) $('f').scrollIntoView();
    }

    async function submit(f) {
      const form = readForm(f);
      if (!form.interest) return toast('Отметьте интерес к сотрудничеству', true);
      form.assortment = form.assortment.concat(form.assortmentOther ? [form.assortmentOther] : []);
      form.competitors = form.competitors.concat(form.competitorsOther ? [form.competitorsOther] : []);
      delete form.assortmentOther;
      delete form.competitorsOther;
      const btn = $('submit');
      if (editing) {
        btn.disabled = true;
        btn.textContent = 'Сохранение…';
        try {
          p = await api.update(id, form, photos);
          updateCached(p);
          editing = null;
          photos = [];
          history = null;
          toast('Изменения сохранены');
        } catch (e) {
          toast(e.server ? e.message : 'Нет связи, изменения не сохранены', true);
          btn.disabled = false;
          btn.textContent = 'Сохранить изменения';
          return;
        }
        if (location.hash === hash) renderPoint();
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Определяем местоположение…';
      // uid защищает от двойного визита, если ответ сервера потерялся и анкета ушла повторно из очереди
      form.uid = id + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      form.geo = await getGeo();
      btn.textContent = 'Отправка…';
      try {
        p = await api.complete(id, form, photos);
        updateCached(p);
        store.del('draft:' + id);
        revisit = null;
        photos = [];
        history = null;
        toast('Визит сохранён — можно дать задание по точке');
        if (location.hash === hash) { renderPoint(); window.scrollTo(0, 0); }
      } catch (e) {
        if (e.server) {
          toast(e.message, true);
          btn.disabled = false;
          btn.textContent = '✓ Выполнено — отправить';
          return;
        }
        const queued = outbox().concat([{ id, name: p.name, agent: me.agent, form, photos }]);
        if (!store.set('outbox', queued)) {
          // Не хватает места под фото — сохраняем анкету без них
          queued[queued.length - 1].photos = [];
          store.set('outbox', queued);
          toast('Нет связи. Анкета сохранена без фото и отправится позже', true);
        } else {
          toast('Нет связи. Анкета сохранена и отправится автоматически');
        }
        location.hash = '#/r/' + routeNo;
      }
    }
  }

  // Строка анкеты из таблицы → значения формы (списки «через запятую» обратно в отметки)
  function toEditForm(r) {
    const split = (s, options) => {
      const items = String(s || '').split(/,\s*/).map((x) => x.trim()).filter(Boolean);
      return { chosen: items.filter((x) => options.indexOf(x) >= 0), other: items.filter((x) => options.indexOf(x) < 0).join(', ') };
    };
    const a = split(r.assortment, ASSORTMENT);
    const c = split(r.competitors, COMPETITORS);
    const out = Object.assign({}, r, {
      assortment: a.chosen, assortmentOther: a.other,
      competitors: c.chosen, competitorsOther: c.other,
      ourBrands: split(r.ourBrands, OUR_BRANDS).chosen,
      alina: OLD_ALINA[r.alina] || r.alina || '',
      photoCount: String(r.photos || '').split(/\s+/).filter(Boolean).length,
    });
    BRANDING_BRANDS.forEach((b) => { out['brand:' + b] = split(r['brand:' + b], BRANDING_KINDS).chosen; });
    return out;
  }

  // Подсказка под долями: сумма должна быть 100%, но отправке это не мешает
  function updateSums(f) {
    const toNum = (s) => Number(String(s).replace(/\s/g, '').replace(',', '.')) || 0;
    f.querySelectorAll('[data-sum]').forEach((el) => {
      const total = Array.from(f.querySelectorAll('[data-g="' + el.dataset.sum + '"]'))
        .reduce((s, i) => s + toNum(i.value), 0);
      const rounded = Math.round(total * 100) / 100;
      el.textContent = rounded ? 'Сумма: ' + rounded + '%' : '';
      el.classList.toggle('warn', rounded !== 0 && rounded !== 100);
    });
  }

  function updateCached(p) {
    const list = cachedPoints(p.route);
    if (!list) return;
    const i = list.findIndex((x) => x.id === p.id);
    if (i >= 0) list[i] = p;
    cache.points[p.route] = list;
    store.set('cache:points:' + p.route, list);
  }

  function readForm(f) {
    const data = { assortment: [], competitors: [], ourBrands: [] };
    BRANDING_BRANDS.forEach((b) => { data['brand:' + b] = []; });
    new FormData(f).forEach((v, k) => {
      if (k in data && Array.isArray(data[k])) data[k].push(v);
      else data[k] = String(v).trim();
    });
    return data;
  }

  /* ---------- Дать задание ---------- */
  async function giveView(id) {
    setBar('Дать задание', '#/p/' + id);
    const hash = location.hash;
    let p;
    try { p = await loadPoint(id); } catch (e) { return showError(e, () => giveView(id)); }
    if (location.hash !== hash) return;
    const due = ymd(new Date(Date.now() + 3 * 86400000));
    $app.innerHTML = `
      <div class="card">
        <div class="muted">Маршрут ${p.route} · № ${p.n}</div>
        <h2>${esc(p.name)}</h2>
        <div class="muted">${esc(cleanAddr(p.address))}</div>
      </div>
      <form class="card" id="gf" autocomplete="off">
        <h2 style="margin-bottom:4px">Задания по точке</h2>
        <p class="muted" style="margin-top:0">Отметьте одно или несколько и добавьте комментарий. Задание увидит вся команда — кто возьмёт, за тем и закрепится.</p>
        ${TASK_TYPES.map((t, i) => `<div class="task-pick">
          <label><input type="checkbox" name="type" value="${i}">${esc(t)}</label>
          <textarea name="c${i}" placeholder="Комментарий к заданию"></textarea></div>`).join('')}
        <div class="field" style="margin-top:14px"><label for="due">Срок выполнения</label>
          <input type="date" id="due" name="due" value="${due}" min="${today()}"></div>
        <button class="btn primary" type="submit" id="gsubmit">${I.plus} Дать задание</button>
      </form>`;
    const f = $('gf');
    f.querySelectorAll('input[name=type]').forEach((cb) => {
      cb.onchange = () => { if (cb.checked) f.elements['c' + cb.value].focus(); };
    });
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const items = Array.from(f.querySelectorAll('input[name=type]:checked'))
        .map((cb) => ({ type: TASK_TYPES[cb.value], comment: f.elements['c' + cb.value].value.trim() }));
      if (!items.length) return toast('Отметьте хотя бы одно задание', true);
      const btn = $('gsubmit');
      btn.disabled = true;
      btn.textContent = 'Отправка…';
      try {
        const ts = await api.taskCreate(id, items, f.elements.due.value);
        ts.forEach(updateCachedTask);
        toast('Выдано заданий: ' + items.length);
        location.hash = '#/p/' + id;
      } catch (e) {
        toast(e.server ? e.message : 'Нет связи, попробуйте ещё раз', true);
        btn.disabled = false;
        btn.innerHTML = I.plus + ' Дать задание';
      }
    };
  }

  /* ---------- Задания ---------- */
  function taskCard(t, opts) {
    opts = opts || {};
    const od = isOverdue(t);
    const mine = t.status === 'в работе' && t.assignee === me.agent;
    const canCancel = isOpen(t) && (t.author === me.agent || isManager());
    let status = '';
    if (t.status === 'новое') status = '<span class="badge info">свободно</span>';
    else if (mine) status = '<span class="badge work">у вас в работе</span>';
    else if (t.status === 'в работе') status = `<span class="badge work">выполняет: ${esc(t.assignee)}</span>`;
    else if (t.status === 'выполнено') status = `<span class="badge done">✓ ${esc(t.assignee)} · ${fmtTime(t.done)}</span>`;
    else status = '<span class="badge">отменено</span>';
    if (od) status += '<span class="badge bad">просрочено</span>';
    const idAttr = `data-id="${esc(t.id)}"`;
    let acts = '';
    if (t.status === 'новое') {
      acts = `<button class="btn small" data-act="take" ${idAttr}>Беру себе</button>
        <button class="btn small ok" data-act="done" ${idAttr}>✓ Выполнено</button>`;
    } else if (mine) {
      acts = `<button class="btn small ok" data-act="done" ${idAttr}>✓ Выполнено</button>
        <button class="btn small ghost" data-act="release" ${idAttr}>Отказаться</button>`;
    }
    if (canCancel) acts += `<button class="btn small ghost wide" data-act="cancel" ${idAttr}>Отменить задание</button>`;
    if (opts.noActions) acts = '';
    const photos = String(t.photos || '').split(/\n+/).filter(Boolean);
    const photoHtml = photos.map((u, i) => /^https?:/.test(u)
      ? ` <a href="${esc(u)}" target="_blank" rel="noopener">📷 фото ${i + 1}</a>` : ` 📷 ${esc(u)}`).join('');
    return `<div class="card task${od ? ' overdue' : ''}">
      <div class="type">${esc(t.type)}</div>
      ${opts.noPoint ? '' : `<a class="task-link" href="#/p/${esc(t.point)}">${esc(t.name)} ›</a>
        <div class="meta">${esc(cleanAddr(t.address))}</div>`}
      ${t.comment ? `<div class="comment">💬 ${esc(t.comment)}</div>` : ''}
      <div class="meta">Выдал(а) ${esc(t.author)} · ${fmtTime(t.created)}${t.due
        ? ` · срок <b${od ? ' style="color:var(--bad)"' : ''}>${fmtDue(t.due)}</b>` : ''}</div>
      <div style="margin-top:6px">${status}</div>
      ${t.result || photos.length ? `<div class="result">${esc(t.result)}${photoHtml}</div>` : ''}
      ${acts ? `<div class="btns">${acts}</div>` : ''}
    </div>`;
  }

  function bindTaskActions(box, after) {
    box.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = async (ev) => {
        ev.preventDefault();
        const id = b.dataset.id, a = b.dataset.act;
        if (a === 'done') { ui.taskBack = location.hash; location.hash = '#/td/' + id; return; }
        if (a === 'release' && !confirm('Вернуть задание в свободные?')) return;
        if (a === 'cancel' && !confirm('Отменить задание?')) return;
        b.disabled = true;
        try {
          const t = await (a === 'take' ? api.taskTake(id) : a === 'release' ? api.taskRelease(id) : api.taskCancel(id));
          updateCachedTask(t);
          toast(a === 'take' ? 'Задание закреплено за вами' : a === 'release' ? 'Задание возвращено в свободные' : 'Задание отменено');
        } catch (e) {
          toast(e.server ? e.message : 'Нет связи, попробуйте ещё раз', true);
        }
        after();
      };
    });
  }

  function tasksView() {
    setBar('Задания');
    const hash = location.hash;
    const tabs = [['free', 'Свободные'], ['mine', 'Мои'], ['done', 'Выполнено']].concat(isManager() ? [['all', 'Все']] : []);
    if (!tabs.some((t) => t[0] === ui.ttab)) ui.ttab = 'free';

    const render = (ts) => {
      if (location.hash !== hash) return;
      const q = ui.tq.trim().toLowerCase();
      const list = ts.filter((t) => !q || [t.type, t.name, t.address, t.comment, t.author, t.assignee, t.result]
        .join(' ').toLowerCase().includes(q)).sort(taskSort);
      const free = list.filter((t) => t.status === 'новое');
      const mine = list.filter((t) => t.status === 'в работе' && t.assignee === me.agent);
      const others = list.filter((t) => t.status === 'в работе' && t.assignee !== me.agent);
      const done = list.filter((t) => t.status === 'выполнено').sort((a, b) => String(b.done).localeCompare(String(a.done)));
      const counts = { free: free.length, mine: mine.length, done: done.length, all: list.length };

      let body = '';
      if (ui.ttab === 'free') {
        body = (free.length ? free.map((t) => taskCard(t)).join('') : '<div class="empty">Свободных заданий нет</div>') +
          (others.length ? '<div class="section-title">Взяли другие</div>' + others.map((t) => taskCard(t)).join('') : '');
      } else if (ui.ttab === 'mine') {
        body = mine.length ? mine.map((t) => taskCard(t)).join('') : '<div class="empty">У вас нет заданий в работе. Возьмите свободное.</div>';
      } else if (ui.ttab === 'done') {
        body = done.length ? done.slice(0, 100).map((t) => taskCard(t)).join('') : '<div class="empty">Выполненных заданий пока нет</div>';
      } else {
        const people = Array.from(new Set(ts.map((t) => t.assignee).filter(Boolean))).sort();
        const st = ui.tstatus;
        const shown = list.filter((t) => (!ui.tagent || t.assignee === ui.tagent) &&
          (!st || (st === 'open' ? isOpen(t) : st === 'overdue' ? isOverdue(t) : t.status === st)));
        body = `<div class="tools">
            <div class="field grow" style="margin:0"><select id="fst">
              ${[['', 'Все статусы'], ['open', 'Открытые'], ['overdue', 'Просроченные'], ['новое', 'Свободные'],
                ['в работе', 'В работе'], ['выполнено', 'Выполненные'], ['отменено', 'Отменённые']]
                .map((o) => `<option value="${o[0]}"${o[0] === st ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></div>
            <div class="field grow" style="margin:0"><select id="fag"><option value="">Все исполнители</option>
              ${people.map((n) => `<option${n === ui.tagent ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
          </div>` +
          (shown.length ? shown.map((t) => taskCard(t)).join('') : '<div class="empty">Нет заданий</div>');
      }

      const searchFocused = document.activeElement && document.activeElement.id === 'tq';
      const caret = searchFocused ? document.activeElement.selectionStart : null;
      $app.innerHTML = `
        <div class="tools"><input class="search" id="tq" type="search" placeholder="Поиск по точке, заданию, агенту" value="${esc(ui.tq)}"></div>
        <div class="seg tabs">${tabs.map((t) => `<button data-ttab="${t[0]}" class="${ui.ttab === t[0] ? 'on' : ''}">${t[1]}<b>${counts[t[0]]}</b></button>`).join('')}</div>
        <div id="tlist">${body}</div>
        <p class="muted" style="text-align:center">Задание выдаётся на карточке точки: «Дать задание».</p>`;
      const qi = $('tq');
      qi.oninput = () => { ui.tq = qi.value; render(ts); };
      if (searchFocused) { qi.focus(); qi.setSelectionRange(caret, caret); }
      $app.querySelectorAll('[data-ttab]').forEach((b) => {
        b.onclick = () => { ui.ttab = b.dataset.ttab; store.set('ui:ttab', ui.ttab); render(ts); };
      });
      if ($('fst')) $('fst').onchange = (ev) => { ui.tstatus = ev.target.value; render(ts); };
      if ($('fag')) $('fag').onchange = (ev) => { ui.tagent = ev.target.value; render(ts); };
      bindTaskActions($('tlist'), () => render(cache.tasks || ts));
    };

    if (cache.tasks) render(cache.tasks); else $app.innerHTML = '<div class="spinner">Загрузка заданий…</div>';
    const load = () => loadTasks().then(render)
      .catch((e) => { if (!cache.tasks) showError(e, tasksView); else toast(e.server ? e.message : 'Нет связи — показан сохранённый список', true); });
    load();
    currentLoad = load;
    refreshTimer = setInterval(() => { if (document.activeElement?.id !== 'tq') load(); }, 60000);
  }

  async function taskDoneView(id) {
    const back = ui.taskBack || '#/tasks';
    setBar('Выполнение задания', back);
    const hash = location.hash;
    let t = (cache.tasks || []).find((x) => x.id === id);
    if (!t) {
      $app.innerHTML = '<div class="spinner">Загрузка…</div>';
      try { t = (await loadTasks()).find((x) => x.id === id); } catch (e) { return showError(e, () => taskDoneView(id)); }
      if (!t) return showError(new Error('Задание не найдено'), () => { location.hash = '#/tasks'; });
    }
    if (location.hash !== hash) return;
    const canClose = t.status === 'новое' || (t.status === 'в работе' && t.assignee === me.agent);
    const draftKey = 'tdraft:' + id;
    const photos = [];
    $app.innerHTML = taskCard(t, { noActions: true }) +
      (canClose ? `
      <form class="card" id="tf" autocomplete="off">
        <h2 style="margin-bottom:12px">Что сделано</h2>
        <div class="field"><label>Результат <span class="req">*</span></label>
          <textarea name="result" placeholder="Например: провёл встречу с командой, выставили Alina Paint на полку, договорились о заказе">${esc(store.get(draftKey, ''))}</textarea></div>
        <div class="field"><span class="label">Фото результата</span>
          <label class="btn file-btn">${I.camera} Добавить фото<input type="file" id="tphoto" accept="image/*" multiple></label>
          <div class="photos" id="tphotos"></div></div>
        <button class="btn ok" type="submit" id="tsubmit">✓ Задание выполнено</button>
      </form>` : '<div class="empty">Это задание закрыть нельзя: ' + esc(t.status === 'в работе' ? 'его выполняет ' + t.assignee : 'оно ' + t.status) + '</div>');
    const f = $('tf');
    if (!f) return;
    bindPhotos($('tphoto'), $('tphotos'), photos, 3);
    f.oninput = () => store.set(draftKey, f.elements.result.value);
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const result = f.elements.result.value.trim();
      if (!result) return toast('Опишите, что сделано', true);
      const btn = $('tsubmit');
      btn.disabled = true;
      btn.textContent = 'Отправка…';
      try {
        updateCachedTask(await api.taskDone(id, result, photos));
        store.del(draftKey);
        toast('Задание выполнено');
        location.hash = back;
      } catch (e) {
        toast(e.server ? e.message : 'Нет связи — попробуйте ещё раз, текст сохранён', true);
        btn.disabled = false;
        btn.textContent = '✓ Задание выполнено';
      }
    };
  }

  /* ---------- Статистика (руководитель) ---------- */
  function statsView() {
    if (!isManager()) { location.hash = '#/'; return; }
    setBar('Команда');
    const hash = location.hash;
    const periods = [['today', 'Сегодня'], ['7', '7 дней'], ['30', '30 дней'], ['all', 'Всё время']];
    const fromOf = (k) => {
      if (k === 'all') return 0;
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      if (k !== 'today') d.setDate(d.getDate() - Number(k) + 1);
      return d.getTime();
    };

    const render = (s) => {
      if (location.hash !== hash) return;
      const t = s.totals;
      const tile = (v, label, bad) => `<div class="tile${bad && v ? ' bad' : ''}"><b>${v == null ? '—' : v}</b><span>${label}</span></div>`;
      const pointLink = (id) => /^R\d+-\d+$/.test(id) ? ` <a href="#/p/${esc(id)}">›</a>` : '';
      $app.innerHTML = `
        <div class="section-title">Сегодня по команде</div>
        <div class="card">${(s.today || []).length ? s.today.map(teamRow).join('') : '<div class="muted">Сотрудники ещё не входили</div>'}</div>
        <div class="list">
          <a class="row-item has-icon" href="#/teammap"><span class="ri-icon" style="background:var(--ok)">${I.map}</span><span class="grow">Карта команды</span>${chev}</a>
          <a class="row-item has-icon" href="#/staff"><span class="ri-icon" style="background:#8e8e93">${I.users}</span><span class="grow">Сотрудники</span>${chev}</a>
          <a class="row-item has-icon" href="#/tasks" id="allTasks"><span class="ri-icon">${I.tasks}</span><span class="grow">Все задания команды</span>${chev}</a>
        </div>
        <div class="section-title">За период</div>
        <div class="seg tabs" style="margin-bottom:10px">${periods.map((p) =>
          `<button data-period="${p[0]}" class="${ui.period === p[0] ? 'on' : ''}">${p[1]}</button>`).join('')}</div>
        <div class="section-title">Визиты</div>
        <div class="tiles">
          ${tile(t.visits, 'визитов')}${tile(t.newPoints, 'новых точек')}
          ${tile(t.far, 'далеко от точки (>' + s.farMeters + ' м)', true)}${tile(t.noGps, 'без GPS')}
        </div>
        <div class="section-title">Задания</div>
        <div class="tiles">
          ${tile(t.issued, 'выдано')}${tile(t.taken, 'взято в работу')}${tile(t.done, 'выполнено')}
          ${tile(t.avgHours == null ? null : t.avgHours + ' ч', 'в среднем на задание')}
          ${tile(t.open, 'открыто сейчас')}${tile(t.overdue, 'просрочено сейчас', true)}
        </div>
        <div class="section-title">По агентам</div>
        <div class="card">${s.agents.length ? `<div class="table-wrap"><table class="grid">
          <tr><th>Агент</th><th>Визиты</th><th>Новые</th><th>Далеко</th><th>Выдал</th><th>Взял</th><th>Сделал</th><th>В работе</th><th>Просроч.</th><th>Активность</th></tr>
          ${s.agents.map((a) => `<tr><td><a href="#/me/${encodeURIComponent(a.name)}">${esc(a.name)}</a></td><td>${a.visits}</td><td>${a.newPoints}</td>
            <td class="${a.far ? 'bad' : ''}">${a.far}</td><td>${a.issued}</td><td>${a.taken}</td><td>${a.done}</td>
            <td>${a.inWork}</td><td class="${a.overdue ? 'bad' : ''}">${a.overdue}</td><td>${fmtTime(a.last)}</td></tr>`).join('')}
        </table></div>` : '<div class="muted">За этот период действий нет</div>'}</div>
        <div class="section-title">Лента действий</div>
        <div class="card">${s.feed.length ? '<ul class="feed">' + s.feed.map((e) =>
          `<li><time>${fmtTime(e.time)}</time><b>${esc(e.agent)}</b> ${esc(e.action)}${e.details ? ' — ' + esc(e.details) : ''}${pointLink(e.id)}</li>`).join('') +
          '</ul>' : '<div class="muted">Пока пусто</div>'}</div>`;
      $app.querySelectorAll('[data-period]').forEach((b) => {
        b.onclick = () => { ui.period = b.dataset.period; store.set('ui:period', ui.period); show(); };
      });
      $('allTasks').onclick = () => { ui.ttab = 'all'; ui.tstatus = 'open'; store.set('ui:ttab', 'all'); };
    };

    const show = () => {
      const key = ui.period;
      if (cache.stats[key]) render(cache.stats[key]); else $app.innerHTML = '<div class="spinner">Считаем статистику…</div>';
      return api.stats(fromOf(key)).then((s) => { cache.stats[key] = s; saveCache('stats'); if (ui.period === key) render(s); })
        .catch((e) => { if (!cache.stats[key]) showError(e, statsView); else toast(e.server ? e.message : 'Нет связи', true); });
    };
    show();
    currentLoad = show;
    refreshTimer = setInterval(show, 60000);
  }

  /* ---------- Личный кабинет: цель дня, рабочий день, статистика, дела ---------- */
  function periodStart(k) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    if (k === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    if (k === 'month') d.setDate(1);
    return d.getTime();
  }
  function loadMe(period, who) {
    return api.me(periodStart(period), who).then((m) => { cache.me[who + '|' + period] = m; saveCache('me'); return m; });
  }
  const hm = (iso) => { const d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  function duration(fromIso, toIso) {
    const min = Math.max(0, Math.round(((toIso ? Date.parse(toIso) : Date.now()) - Date.parse(fromIso)) / 60000));
    return (min >= 60 ? Math.floor(min / 60) + ' ч ' : '') + (min % 60) + ' мин';
  }
  function dayText(t) {
    if (!t.start) return 'день не начат';
    return t.end ? hm(t.start) + '–' + hm(t.end) + ' · ' + duration(t.start, t.end) : 'работает с ' + hm(t.start) + ' · ' + duration(t.start);
  }
  const goalPct = (t) => t.goal ? Math.min(100, Math.round(t.visits / t.goal * 100)) : 0;
  function goalBar(t, small) {
    const pct = goalPct(t);
    return `<div class="goal-bar${small ? ' small' : ''}${pct >= 100 ? ' full' : ''}"><div style="width:${pct}%"></div></div>`;
  }

  // Карточка цели на главной
  function goalCard(m) {
    if (!m) return '';
    const t = m.today;
    const pct = goalPct(t);
    return `<div class="card goal-card">
      <a class="goal-main" href="#/me">${ring(pct, 76)}
        <span class="grow"><span class="goal-num" style="display:block">${t.visits}<span> / ${t.goal || '—'} точек</span></span>
          <span class="muted">${t.goal ? (pct >= 100 ? 'Цель дня выполнена 🎉' : 'Цель дня · осталось ' + Math.max(0, t.goal - t.visits))
            : 'Нажмите, чтобы поставить цель на день'}</span></span>${chev}</a>
      ${!t.start ? `<button class="btn primary" id="homeDay">${I.play} Начать рабочий день</button>`
        : `<div class="day-line muted">${I.clock} ${esc(dayText(t))}</div>`}
    </div>`;
  }

  // Строка агента в блоке «Сегодня» у руководителя
  function teamRow(a) {
    const pct = goalPct(a);
    return `<a class="team-row" href="#/me/${encodeURIComponent(a.name)}">
      <div class="row"><b class="grow">${esc(a.name)}</b>${chev}</div>
      <div class="muted" style="font-size:13px">${esc(dayText(a))}</div>
      ${goalBar(a, true)}
      <div class="muted">${a.goal ? `${a.visits} из ${a.goal} точек · ${pct}%${pct >= 100 ? ' 🎉' : ''}` : `${a.visits} визитов · цель не поставлена`}</div>
    </a>`;
  }

  function meView(who) {
    const own = !who || who === me.agent;
    if (!own && !isManager()) { location.hash = '#/me'; return; }
    who = own ? '' : who;
    if (own) setBar('Профиль'); else setBar(who, '#/stats');
    const hash = location.hash;
    const periods = [['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц']];
    let goalEdit = false;

    const render = (m) => {
      if (location.hash !== hash) return;
      const t = m.today;
      const p = m.period;
      const pct = goalPct(t);
      const td = today();
      const soon = ymd(new Date(Date.now() + 7 * 86400000));
      const todoGroups = [
        ['Просрочено', m.todo.filter((x) => x.nextDate < td), 'bad'],
        ['Сегодня', m.todo.filter((x) => x.nextDate === td), 'work'],
        ['Ближайшие 7 дней', m.todo.filter((x) => x.nextDate > td && x.nextDate <= soon), 'info'],
      ].filter((g) => g[1].length);
      const initials = m.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
      const tile = (v, label, bad) => `<div class="tile${bad && v ? ' bad' : ''}"><b>${v}</b><span>${label}</span></div>`;
      $app.innerHTML = `
        <div class="profile">
          <div class="avatar">${esc(initials)}</div>
          <h2>${esc(m.name)}</h2><span class="badge ${m.role === ROLE_MANAGER ? 'info' : ''}">${esc(m.role)}</span>
        </div>
        <div class="section-title">Сегодня</div>
        <div class="card">
          <div class="row"><h3 class="grow">${I.target} Цель дня</h3>
            ${own && t.goal && !goalEdit ? '<button class="link-btn inline" id="goalEdit">Изменить</button>' : ''}</div>
          ${t.goal && !goalEdit ? `<div class="goal-main">${ring(pct, 76)}
              <div class="grow"><div class="goal-num">${t.visits}<span> / ${t.goal} точек</span></div>
              <div class="muted">${pct >= 100 ? 'Цель выполнена 🎉' : 'Осталось ' + Math.max(0, t.goal - t.visits) + ' ' + plural(Math.max(0, t.goal - t.visits), 'точка', 'точки', 'точек')}</div></div></div>`
            : own ? `<p class="muted" style="margin:0 0 8px">Сколько точек объедете сегодня? Каждый отправленный визит заполняет кольцо — его видит руководитель.</p>
              <div class="goal-pick">${[5, 10, 15, 20].map((n) => `<button class="btn small" data-goal="${n}">${n}</button>`).join('')}</div>
              <div class="goal-own"><div class="field" style="margin:0"><input type="text" inputmode="numeric" id="goalOwn" placeholder="Своё число"></div>
                <button class="btn small primary" id="goalSave">OK</button></div>`
            : '<div class="muted">Цель не поставлена</div>'}
        </div>
        <div class="card">
          <h3>${I.clock} Рабочий день</h3>
          <div class="muted" style="margin-bottom:10px">${esc(dayText(t))}</div>
          ${own ? (!t.start ? `<button class="btn primary" id="dayStart">${I.play} Начать рабочий день</button>`
            : !t.end ? `<button class="btn danger" id="dayEnd">${I.stop} Закончить рабочий день</button>`
            : `<button class="btn" id="dayStart">${I.play} Продолжить день</button>`) : ''}
        </div>
        <div class="section-title">Статистика</div>
        <div class="seg tabs" style="margin-bottom:10px">${periods.map((x) =>
          `<button data-mp="${x[0]}" class="${ui.mperiod === x[0] ? 'on' : ''}">${x[1]}</button>`).join('')}</div>
        <div class="tiles">
          ${tile(p.visits, 'точек посещено')}${tile(p.newPoints, 'новых точек')}
          ${tile(p.visits - p.newPoints, 'повторных визитов')}${tile(p.done, 'заданий выполнено')}
          ${tile(p.taken, 'заданий взято')}${tile(p.issued, 'заданий выдано')}
          ${tile(p.far, 'далеко от точки', true)}${tile(p.noGps, 'без GPS')}
        </div>
        <div class="section-title">${own ? 'Мои дела' : 'Дела'}</div>
        ${todoGroups.length ? todoGroups.map((g) => `<div class="card">
            <h3>${g[0]} <span class="badge ${g[2]}">${g[1].length}</span></h3>
            ${g[1].map((x) => `<a class="todo" href="#/p/${esc(x.id)}">
              <span class="badge ${g[2]}">${fmtDue(x.nextDate)}</span> <b>${esc(x.name || x.id)}</b>
              ${x.nextStep ? `<div class="muted">${esc(x.nextStep)}</div>` : ''}</a>`).join('')}
          </div>`).join('')
          : '<div class="card muted">Дел нет. Дату следующего шага можно поставить в анкете визита.</div>'}
        ${own ? `<div class="list"><a class="row-item has-icon" href="#/tasks" id="myTasks"><span class="ri-icon">${I.tasks}</span>
          <span class="grow ri-title">Мои задания</span>${chev}</a></div>` : ''}
        ${!own && m.feed.length ? `<div class="section-title">Последние действия</div><div class="card"><ul class="feed">${m.feed.map((e) =>
          `<li><time>${fmtTime(e.time)}</time>${esc(e.action)}${e.details ? ' — ' + esc(e.details) : ''}</li>`).join('')}</ul></div>` : ''}
        ${own ? `<div class="section-title">Безопасность</div>
          <div class="list">
            ${faceIdOk ? `<label class="row-item has-icon"><span class="ri-icon" style="background:var(--ok)">${I.face}</span>
              <span class="grow">Вход по Face ID</span>
              <span class="switch"><input type="checkbox" id="faceToggle"${faceIdOn() ? ' checked' : ''}><span></span></span></label>` : ''}
            <a class="row-item has-icon" href="#/pin"><span class="ri-icon" style="background:#8e8e93">${I.key}</span>
              <span class="grow">Сменить PIN</span>${chev}</a>
          </div>
          ${m.role !== ROLE_MANAGER ? `<div class="card"><details class="mgr" style="margin:0"><summary>Я руководитель</summary>
            <div class="goal-own"><div class="field" style="margin:0"><input type="password" inputmode="numeric" id="mcode" autocomplete="off" placeholder="Код руководителя"></div>
            <button class="btn small primary" id="mgrSave">OK</button></div></details></div>` : ''}
          <div class="list"><button class="row-item danger" id="logout">Выйти</button></div>` : ''}`;

      const reload = () => { cache.me = {}; load(); };
      const run = async (btn, fn, okMsg) => {
        btn.disabled = true;
        try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(e.server ? e.message : 'Нет связи', true); }
        reload();
      };
      $app.querySelectorAll('[data-mp]').forEach((b) => {
        b.onclick = () => { ui.mperiod = b.dataset.mp; store.set('ui:mperiod', ui.mperiod); show(); };
      });
      $app.querySelectorAll('[data-goal]').forEach((b) => {
        b.onclick = () => { goalEdit = false; run(b, () => api.goalSet(Number(b.dataset.goal)), 'Цель на сегодня: ' + b.dataset.goal + ' точек'); };
      });
      if ($('goalSave')) $('goalSave').onclick = (ev) => {
        const n = Number($('goalOwn').value);
        if (!(n >= 1 && n <= 200)) return toast('Цель — от 1 до 200 точек', true);
        goalEdit = false;
        run(ev.target, () => api.goalSet(n), 'Цель на сегодня: ' + n + ' точек');
      };
      if ($('goalEdit')) $('goalEdit').onclick = () => { goalEdit = true; render(m); };
      if ($('dayStart')) $('dayStart').onclick = (ev) => {
        ev.target.textContent = 'Определяем местоположение…';
        run(ev.target, async () => api.dayStart(await getGeo()), 'Рабочий день начат');
      };
      if ($('dayEnd')) $('dayEnd').onclick = (ev) => {
        if (!confirm('Закончить рабочий день?')) return;
        run(ev.target, async () => api.dayEnd(await getGeo()), 'Рабочий день закончен');
      };
      if ($('myTasks')) $('myTasks').onclick = () => { ui.ttab = 'mine'; store.set('ui:ttab', 'mine'); };
      if ($('faceToggle')) $('faceToggle').onclick = async () => {
        if (faceIdOn()) { store.del('faceid'); toast('Face ID выключен'); return render(m); }
        try { await faceIdEnable(); toast('Face ID включён'); } catch (e) { toast('Не получилось включить Face ID', true); }
        render(m);
      };
      if ($('mgrSave')) $('mgrSave').onclick = (ev) => run(ev.target, async () => {
        const s = await api.becomeManager($('mcode').value.trim());
        me.role = s.role; me.token = s.token;
        store.set('role', s.role); store.set('token', s.token);
        setBar('Профиль');
      }, 'Вы руководитель — в главном меню появилась статистика команды');
      if ($('logout')) $('logout').onclick = () => { if (confirm('Выйти из приложения?')) logout('', false); };
    };

    const load = () => loadMe(ui.mperiod, who).then(render)
      .catch((e) => { if (!cache.me[who + '|' + ui.mperiod]) showError(e, () => meView(who)); else toast(e.server ? e.message : 'Нет связи', true); });
    const show = () => {
      const c = cache.me[who + '|' + ui.mperiod];
      if (c) render(c); else $app.innerHTML = '<div class="spinner">Загрузка…</div>';
      load();
    };
    show();
    currentLoad = load;
    refreshTimer = setInterval(load, 60000);
  }

  /* ---------- Сотрудники (руководитель) ---------- */
  function staffView() {
    if (!isManager()) { location.hash = '#/'; return; }
    setBar('Сотрудники', '#/stats');
    const hash = location.hash;
    const render = (list) => {
      if (location.hash !== hash) return;
      $app.innerHTML = '<p class="muted">Сотрудник сам задаёт PIN при первом входе. Сброс PIN — он задаст новый при следующем входе. Любое изменение закрывает его текущий вход.</p>' +
        list.map((s) => {
          const self = s.name === me.agent;
          const blocked = s.status === 'заблокирован';
          return `<div class="card">
            <div class="row"><b class="grow"><a href="#/me/${encodeURIComponent(s.name)}">${esc(s.name)}</a></b>
              <span class="badge ${s.role === ROLE_MANAGER ? 'info' : ''}">${esc(s.role)}</span></div>
            <div class="muted">${blocked ? '<span class="badge bad">заблокирован</span> ' : ''}${s.hasPin ? '' : '<span class="badge work">PIN сброшен</span> '}
              Последний вход: ${s.last ? fmtTime(s.last) : '—'}</div>
            <div class="btns">
              <button class="btn small ghost" data-st="reset" data-name="${esc(s.name)}">Сбросить PIN</button>
              ${self ? '' : `<button class="btn small ghost" data-st="${blocked ? 'unblock' : 'block'}" data-name="${esc(s.name)}">${blocked ? 'Разблокировать' : 'Заблокировать'}</button>
              <button class="btn small ghost wide" data-st="${s.role === ROLE_MANAGER ? 'agent' : 'manager'}" data-name="${esc(s.name)}">${s.role === ROLE_MANAGER ? 'Сделать агентом' : 'Сделать руководителем'}</button>`}
            </div></div>`;
        }).join('');
      $app.querySelectorAll('[data-st]').forEach((b) => {
        b.onclick = async () => {
          const n = b.dataset.name, a = b.dataset.st;
          const q = { reset: 'Сбросить PIN «' + n + '»?', block: 'Заблокировать «' + n + '»? Он не сможет войти.', unblock: 'Разблокировать «' + n + '»?',
            manager: 'Сделать «' + n + '» руководителем?', agent: 'Сделать «' + n + '» агентом?' }[a];
          if (!confirm(q)) return;
          b.disabled = true;
          try {
            const list2 = await (a === 'reset' ? api.staffReset(n) : a === 'block' || a === 'unblock' ? api.staffBlock(n, a === 'block')
              : api.staffRole(n, a === 'manager' ? ROLE_MANAGER : 'агент'));
            toast('Готово');
            render(list2);
          } catch (e) { toast(e.server ? e.message : 'Нет связи', true); b.disabled = false; }
        };
      });
    };
    $app.innerHTML = '<div class="spinner">Загрузка…</div>';
    if (cache.staff) render(cache.staff);
    api.staff().then((s) => { cache.staff = s; saveCache('staff'); render(s); })
      .catch((e) => { if (!cache.staff) showError(e, staffView); else toast(e.server ? e.message : 'Нет связи', true); });
  }

  /* ---------- Карты (Leaflet + OpenStreetMap, подгружаются только здесь) ---------- */
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (!loadLeaflet.p) {
      loadLeaflet.p = new Promise((resolve, reject) => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
        document.head.appendChild(css);
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
        s.onload = resolve;
        s.onerror = () => { loadLeaflet.p = null; reject(new Error('Карта не загрузилась — проверьте связь')); };
        document.head.appendChild(s);
      });
    }
    return loadLeaflet.p;
  }
  function newMap() {
    const map = L.map('map');
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    return map;
  }
  const ALMATY = [43.238, 76.889];

  async function mapView(routeNo) {
    setBar('Карта: маршрут ' + routeNo, '#/r/' + routeNo);
    const hash = location.hash;
    $app.innerHTML = '<div class="spinner">Загрузка карты…</div>';
    let pts = cachedPoints(routeNo);
    try {
      await loadLeaflet();
      if (!pts) pts = await loadPoints(routeNo);
    } catch (e) { return showError(e, () => mapView(routeNo)); }
    if (location.hash !== hash) return;
    const colorOf = (p) => isPending(p.id) || p.status === 'выполнена' ? '#1f8a4c'
      : p.status === 'в работе' ? (p.agent === me.agent ? '#2a3b7e' : '#f0a24a') : '#489ed7';
    const shown = pts.filter(hasCoords);
    $app.innerHTML = `
      <div class="map" id="map"></div>
      <div class="map-legend">
        <span><i style="background:#489ed7"></i>свободна</span><span><i style="background:#2a3b7e"></i>у меня</span>
        <span><i style="background:#f0a24a"></i>у других</span><span><i style="background:#1f8a4c"></i>выполнена</span>
      </div>
      <div class="muted">На карте ${shown.length} из ${pts.length} точек${pts.length - shown.length ? ' · без координат: ' + (pts.length - shown.length) : ''}</div>
      <button class="btn ghost small" id="whereMe" style="margin-top:8px">${I.pin} Где я</button>`;
    const map = newMap();
    const marks = shown.map((p) => L.circleMarker([p.lat, p.lon], { radius: 9, color: '#fff', weight: 2, fillColor: colorOf(p), fillOpacity: 0.95 })
      .bindPopup(`<b>${p.n}. ${esc(p.name)}</b><br>${esc(cleanAddr(p.address))}<br><a href="#/p/${p.id}">Открыть точку ›</a>`).addTo(map));
    if (marks.length) map.fitBounds(L.featureGroup(marks).getBounds().pad(0.1)); else map.setView(ALMATY, 11);
    $('whereMe').onclick = () => locate(() => {
      if (!ui.pos) return;
      L.circleMarker([ui.pos.lat, ui.pos.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#c0352b', fillOpacity: 1 }).bindTooltip('Я').addTo(map);
      map.setView([ui.pos.lat, ui.pos.lon], 14);
    });
  }

  async function teamMapView() {
    if (!isManager()) { location.hash = '#/'; return; }
    setBar('Карта команды', '#/stats');
    const hash = location.hash;
    $app.innerHTML = '<div class="spinner">Загрузка карты…</div>';
    let s;
    try {
      await loadLeaflet();
      s = await api.stats(periodStart('day'));
    } catch (e) { return showError(e, teamMapView); }
    if (location.hash !== hash) return;
    const team = s.today || [];
    $app.innerHTML = `
      <div class="map" id="map"></div>
      <div class="map-legend"><span><i style="background:#2a3b7e"></i>последний визит</span><span><i style="background:#1f8a4c"></i>начало дня</span></div>
      <div class="card">${team.length ? team.map(teamRow).join('') : '<div class="muted">Сегодня ещё никто не работал</div>'}</div>`;
    const map = newMap();
    const marks = [];
    team.forEach((a) => {
      if (a.startPos) marks.push(L.circleMarker([a.startPos.lat, a.startPos.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#1f8a4c', fillOpacity: 0.9 })
        .bindPopup(`<b>${esc(a.name)}</b><br>Начал день ${a.start ? hm(a.start) : ''}`).addTo(map));
      if (a.lastPos) marks.push(L.circleMarker([a.lastPos.lat, a.lastPos.lon], { radius: 9, color: '#fff', weight: 2, fillColor: '#2a3b7e', fillOpacity: 0.95 })
        .bindTooltip(esc(a.name), { permanent: true, direction: 'top', offset: [0, -8] })
        .bindPopup(`<b>${esc(a.name)}</b><br>${hm(a.lastPos.time)} · ${esc(a.lastPos.point || '')}<br>
          ${a.lastPos.id ? `<a href="#/p/${esc(a.lastPos.id)}">Открыть точку ›</a> · ` : ''}<a href="#/me/${encodeURIComponent(a.name)}">Кабинет ›</a>`).addTo(map));
    });
    if (marks.length) map.fitBounds(L.featureGroup(marks).getBounds().pad(0.2), { maxZoom: 15 }); else map.setView(ALMATY, 11);
  }

  function compress(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const max = 1280;
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s);
        c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }

  /* ---------- Старт ---------- */
  window.addEventListener('hashchange', route);
  window.addEventListener('online', flushOutbox);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { store.set('hiddenAt', Date.now()); return; }
    if (unlocked && Date.now() - (store.get('hiddenAt', 0) || 0) > LOCK_AFTER) return lock();
    flushOutbox();
    if (currentLoad) currentLoad();
  });
  setInterval(flushOutbox, 90000);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  faceIdAvailable().then((v) => { faceIdOk = v; }).finally(() => { route(); flushOutbox(); });
})();
