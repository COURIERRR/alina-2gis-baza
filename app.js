(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const MOCK = new URLSearchParams(location.search).has('mock') || !CFG.API_URL;

  const ASSORTMENT = ['ВД-краски', 'Эмали', 'Грунтовки', 'Лаки и пропитки', 'Шпатлёвки и штукатурки',
    'Клей', 'Герметики и пена', 'Растворители', 'Колеровка', 'Инструмент'];
  const COMPETITORS = ['Tikkurila', 'Dulux', 'Alpina', 'Caparol', 'Ceresit', 'Knauf', 'Текс',
    'VGT', 'Лакра', 'Eskaro', 'Marshall', 'Местные / Китай'];
  const OUR_BRANDS = ['AlinEX', 'НАШИ', 'Norma', 'Alina Paint', 'Алкиды', 'FAWORI', 'V-tech'];
  const ALINA = ['Да, работают', 'Раньше работали', 'Нет'];
  const INTEREST = ['Высокий', 'Средний', 'Низкий', 'Отказ'];

  const $ = (id) => document.getElementById(id);
  const $app = $('app');

  /* ---------- localStorage (может быть недоступен) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  const me = { agent: store.get('agent', '') };
  const ui = { q: '', sort: 'order', showTaken: false, showDone: false, pos: null };
  const cache = { summary: store.get('cache:summary', null), points: {} };
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

  /* ---------- API ---------- */
  function remoteApi() {
    const url = CFG.API_URL;
    async function parse(res) {
      const data = await res.json();
      if (!data.ok) { const e = new Error(data.error || 'Ошибка сервера'); e.server = true; throw e; }
      return data;
    }
    const get = (action, q) => fetch(url + '?' + new URLSearchParams(Object.assign({ action }, q)))
      .then(parse);
    const post = (action, body) => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action, agent: me.agent }, body)),
    }).then(parse);
    return {
      ping: () => get('ping'),
      summary: () => get('summary').then((d) => d.routes),
      points: (route) => get('points', { route }).then((d) => d.points),
      claim: (id) => post('claim', { id }).then((d) => d.point),
      release: (id) => post('release', { id }).then((d) => d.point),
      complete: (id, form, photos, agent) => post('complete', { id, form, photos, agent: agent || me.agent }).then((d) => d.point),
      result: (id) => get('result', { id }).then((d) => d.result),
      update: (id, form, photos) => post('update', { id, form, photos }).then((d) => d.point),
      remove: (id) => post('remove', { id }).then((d) => d.point),
    };
  }

  // Демо-режим: точки из data/routes.json, статусы — в localStorage этого браузера
  function mockApi() {
    let base = null;
    const wait = (v) => new Promise((r) => setTimeout(() => r(v), 250));
    const state = () => store.get('mock:state', {});
    const load = async () => base || (base = await fetch('data/routes.json').then((r) => r.json()));
    const all = async () => {
      const s = state();
      const out = [];
      (await load()).routes.forEach((r) => r.points.forEach((p) => {
        const st = s[p.id] || {};
        out.push(Object.assign({ route: r.route, lat: null, lon: null, acc: p.lat != null ? 'точно' : '' }, p,
          { status: st.status || 'свободна', agent: st.agent || '' }));
      }));
      return out;
    };
    const fail = (m) => { const e = new Error(m); e.server = true; throw e; };
    const setState = async (id, status, agent) => {
      const s = state();
      if (status === 'свободна') delete s[id]; else s[id] = { status, agent };
      store.set('mock:state', s);
      return (await all()).find((p) => p.id === id);
    };
    const check = async (id, agent) => {
      const p = (await all()).find((x) => x.id === id);
      if (!p) fail('Точка не найдена');
      if (p.status === 'выполнена') fail('Точка уже выполнена (' + p.agent + ')');
      if (p.status === 'в работе' && p.agent !== agent) fail('Точку уже взял(а): ' + p.agent);
      return p;
    };
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
      claim: async (id) => { await check(id, me.agent); return wait(await setState(id, 'в работе', me.agent)); },
      release: async (id) => {
        const p = (await all()).find((x) => x.id === id);
        if (!p || p.status !== 'в работе' || p.agent !== me.agent) fail('Эта точка не у вас в работе');
        return wait(await setState(id, 'свободна', ''));
      },
      complete: async (id, form, photos, agent) => {
        const who = agent || me.agent;
        await check(id, who);
        const log = store.get('mock:results', []);
        log.push({ id, agent: who, time: new Date().toISOString(), form, photos: photos.length });
        store.set('mock:results', log);
        return wait(await setState(id, 'выполнена', who));
      },
      result: async (id) => {
        const r = store.get('mock:results', []).filter((x) => x.id === id).pop();
        if (!r) return wait(null);
        const out = Object.assign({}, r.form, { photos: Array(r.photos).fill('photo').join('\n') });
        ['assortment', 'competitors', 'ourBrands'].forEach((k) => { if (Array.isArray(out[k])) out[k] = out[k].join(', '); });
        return wait(out);
      },
      update: async (id, form, photos) => {
        const p = (await all()).find((x) => x.id === id);
        if (!p || p.status !== 'выполнена' || p.agent !== me.agent) fail('Изменить анкету может только автор');
        const log = store.get('mock:results', []);
        const r = log.filter((x) => x.id === id).pop();
        r.form = form;
        r.photos += photos.length;
        store.set('mock:results', log);
        return wait(p);
      },
      remove: async (id) => {
        const p = (await all()).find((x) => x.id === id);
        if (!p || p.status !== 'выполнена' || p.agent !== me.agent) fail('Удалить анкету может только автор');
        store.set('mock:results', store.get('mock:results', []).filter((x) => x.id !== id));
        return wait(await setState(id, 'свободна', ''));
      },
    };
  }

  const api = MOCK ? mockApi() : remoteApi();

  /* ---------- Очередь отправки (если нет связи) ---------- */
  const outbox = () => store.get('outbox', []);
  const isPending = (id) => outbox().some((x) => x.id === id);

  async function flushOutbox() {
    const items = outbox();
    if (!items.length || flushOutbox.busy) return;
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

  /* ---------- Каркас ---------- */
  function setBar(title, backHash) {
    $('title').textContent = title;
    const back = $('back');
    back.hidden = !backHash;
    back.onclick = () => { location.hash = backHash; };
    const who = $('who');
    who.hidden = !me.agent;
    who.textContent = me.agent;
  }

  $('who').onclick = () => {
    if (confirm('Сменить агента «' + me.agent + '»?')) {
      me.agent = '';
      store.del('agent');
      route();
    }
  };

  function stopRefresh() { clearInterval(refreshTimer); refreshTimer = null; currentLoad = null; }

  function route() {
    stopRefresh();
    updateBanner();
    window.scrollTo(0, 0);
    if (!me.agent) return loginView();
    const h = location.hash.replace(/^#\/?/, '');
    let m;
    if ((m = h.match(/^r\/(\d+)$/))) return listView(Number(m[1]));
    if ((m = h.match(/^p\/(R\d+-\d+)$/))) return pointView(m[1]);
    return homeView();
  }

  function showError(e, retry) {
    $app.innerHTML = '<div class="empty"><p>' + esc(e.message || 'Нет связи') + '</p>' +
      '<button class="btn" id="retry">Повторить</button></div>';
    $('retry').onclick = retry;
  }

  /* ---------- Вход ---------- */
  function loginView() {
    setBar('Alina 2ГИС');
    $app.innerHTML = `
      <div class="card">
        <h2>Отработка базы 2ГИС</h2>
        <p class="muted">Alina Group. Укажите своё имя — по нему видно, кто взял точку.</p>
        <form id="login">
          <div class="field"><label for="agent">Имя и фамилия</label>
            <input type="text" id="agent" autocomplete="name" required value="${esc(store.get('lastAgent', ''))}"></div>
          <button class="btn primary" type="submit">Войти</button>
        </form>
      </div>`;
    $('login').onsubmit = (ev) => {
      ev.preventDefault();
      const agent = $('agent').value.trim().replace(/\s+/g, ' ');
      if (!agent) return;
      me.agent = agent;
      store.set('agent', agent);
      store.set('lastAgent', agent);
      route();
    };
  }

  /* ---------- Маршруты ---------- */
  function homeView() {
    setBar('Маршруты');
    const render = (routes) => {
      $app.innerHTML = routes.map((r) => {
        const pd = r.total ? (r.done / r.total) * 100 : 0;
        const pw = r.total ? (r.work / r.total) * 100 : 0;
        return `<a class="card route-card" href="#/r/${r.route}">
          <div class="row"><h2 class="grow">Маршрут ${r.route}</h2><span class="muted">${r.total} точек</span></div>
          ${r.title ? `<div class="muted">${esc(r.title)}</div>` : ''}
          <div class="progress"><div class="done" style="width:${pd}%"></div><div class="work" style="width:${pw}%"></div></div>
          <div class="stats"><span>Выполнено <b>${r.done}</b></span><span>В работе <b>${r.work}</b></span><span>Свободно <b>${r.free}</b></span></div>
        </a>`;
      }).join('') + '<p class="muted" style="text-align:center">Старт: Алматы, Казыбаева 20</p>';
    };
    if (cache.summary) render(cache.summary); else $app.innerHTML = '<div class="spinner">Загрузка…</div>';
    const load = () => api.summary().then((routes) => {
      routes.sort((a, b) => a.route - b.route);
      cache.summary = routes;
      store.set('cache:summary', routes);
      if (location.hash.replace(/^#\/?/, '') === '') render(routes);
    }).catch((e) => { if (!cache.summary) showError(e, homeView); else toast('Нет связи', true); });
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
    setBar('Маршрут ' + routeNo, '#/');
    const hash = location.hash;

    const itemHtml = (p) => {
      const mine = p.status === 'в работе' && p.agent === me.agent;
      let badge = '';
      if (isPending(p.id)) badge = '<span class="badge work">ждёт отправки</span>';
      else if (p.status === 'выполнена') badge = `<span class="badge done">✓ ${esc(p.agent)}</span>`;
      else if (mine) badge = '<span class="badge work">у вас в работе</span>';
      else if (p.status === 'в работе') badge = `<span class="badge work">взял(а): ${esc(p.agent)}</span>`;
      const dist = ui.pos && hasCoords(p) ? `<span class="dist">${km(ui.pos, p).toFixed(1)} км</span>` : '';
      return `<a class="card point${mine ? ' mine' : ''}" href="#/p/${p.id}">
        <span class="num">${p.n}</span>
        <span class="grow"><div class="name">${esc(p.name)}</div>
          <div class="addr">${esc(p.type)}${p.type ? ' · ' : ''}${esc(cleanAddr(p.address))}</div>${badge}</span>
        ${dist}</a>`;
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
        <div class="stats" style="margin:0 4px 6px"><span>Свободно <b>${free.length}</b></span>
          <span>У меня <b>${mine.length}</b></span><span>Заняты <b>${taken.length}</b></span><span>Выполнено <b>${done.length}</b></span></div>
        ${mine.length ? '<div class="section-title">У меня в работе</div>' + mine.map(itemHtml).join('') : ''}
        <div class="section-title">Свободные</div>
        ${free.length ? free.map(itemHtml).join('') : '<div class="empty">Свободных точек нет</div>'}
        ${taken.length ? `<button class="link-btn" id="tgTaken">${ui.showTaken ? 'Скрыть' : 'Показать'} занятые другими (${taken.length})</button>` : ''}
        ${ui.showTaken ? taken.map(itemHtml).join('') : ''}
        ${done.length ? `<div><button class="link-btn" id="tgDone">${ui.showDone ? 'Скрыть' : 'Показать'} выполненные (${done.length})</button></div>` : ''}
        ${ui.showDone ? done.map(itemHtml).join('') : ''}`;

      const qi = $('q');
      qi.oninput = () => { ui.q = qi.value; render(pts); };
      if (searchFocused) { qi.focus(); qi.setSelectionRange(caret, caret); }
      $app.querySelectorAll('[data-sort]').forEach((b) => {
        b.onclick = () => {
          ui.sort = b.dataset.sort;
          if (ui.sort === 'near') locate(() => render(pts)); else render(pts);
        };
      });
      if ($('tgTaken')) $('tgTaken').onclick = () => { ui.showTaken = !ui.showTaken; render(pts); };
      if ($('tgDone')) $('tgDone').onclick = () => { ui.showDone = !ui.showDone; render(pts); };
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

  /* ---------- Точка ---------- */
  function chips(name, options, type, values) {
    return '<div class="chips">' + options.map((o) => `<label><input type="${type}" name="${name}" value="${esc(o)}"
      ${values.indexOf(o) >= 0 ? 'checked' : ''}>${esc(o)}</label>`).join('') + '</div>';
  }

  async function pointView(id) {
    const routeNo = routeOf(id);
    setBar('Маршрут ' + routeNo, '#/r/' + routeNo);
    const hash = location.hash;
    let p = (cachedPoints(routeNo) || []).find((x) => x.id === id);
    if (!p) {
      $app.innerHTML = '<div class="spinner">Загрузка…</div>';
      try { p = (await loadPoints(routeNo)).find((x) => x.id === id); } catch (e) { return showError(e, () => pointView(id)); }
      if (!p) return showError(new Error('Точка не найдена'), () => { location.hash = '#/r/' + routeNo; });
    }
    let photos = [];
    let editing = null; // значения анкеты, когда автор её редактирует
    renderPoint();
    // Актуальный статус с сервера
    loadPoints(routeNo).then((pts) => {
      const fresh = pts.find((x) => x.id === id);
      if (fresh && location.hash === hash && (fresh.status !== p.status || fresh.agent !== p.agent)) {
        p = fresh;
        renderPoint();
      }
    }).catch(() => {});

    function renderPoint() {
      const draft = store.get('draft:' + id, {});
      const mine = p.status === 'в работе' && p.agent === me.agent;
      const other = p.status === 'в работе' && !mine;
      const done = p.status === 'выполнена';
      const pending = isPending(id);
      const canFill = (!other && !done && !pending) || !!editing;
      const ownDone = done && p.agent === me.agent;
      const src = editing || draft;

      let status = '';
      if (pending) status = '<div class="status-box work">Анкета сохранена и ждёт отправки (нет связи)</div>';
      else if (done) status = `<div class="status-box done">✓ Выполнена — ${esc(p.agent)}</div>`;
      else if (other) status = `<div class="status-box other">Точку взял(а): ${esc(p.agent)}</div>`;
      else if (mine) status = '<div class="status-box work">У вас в работе</div>';

      // Телефоны точки (если есть в базе) подставляются в анкету по умолчанию
      const known = { phone: p.phone || '', whatsapp: p.whatsapp || '' };
      const d = (k) => esc(src[k] != null ? src[k] : (known[k] || ''));
      const contacts = [
        p.phone ? `<a href="tel:${esc(telDigits(p.phone))}">📞 ${esc(p.phone)}</a>` : '',
        waUrl(p.whatsapp) ? `<a href="${waUrl(p.whatsapp)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : '',
      ].filter(Boolean).join(' &nbsp; ');
      $app.innerHTML = `
        <div class="card">
          <div class="muted">№ ${p.n} · ${esc(p.type)}</div>
          <h2>${esc(p.name)}</h2>
          <div>${esc(p.address)}</div>
          ${contacts ? `<div style="margin-top:6px">${contacts}</div>` : ''}
          <div class="btns">
            <button class="btn primary wide" id="go">🚗 Маршрут в 2ГИС</button>
            <a class="btn ghost${routable(p) ? '' : ' wide'}" href="${gisSearchUrl(p)}" target="_blank" rel="noopener">Найти в 2ГИС</a>
            ${routable(p) ? `<a class="btn ghost" href="${gisRouteWebUrl(p)}" target="_blank" rel="noopener">Маршрут на сайте</a>` : ''}
          </div>
          ${routable(p) ? '' : '<div class="muted">2ГИС откроет карточку фирмы — нажмите там «Проехать».</div>'}
          ${status}
          ${!done && !other && !pending ? (mine
            ? '<button class="btn ghost" id="release">Отказаться от точки</button>'
            : '<button class="btn" id="claim">Беру в работу</button>') : ''}
          ${ownDone && !editing ? `<div class="btns">
            <button class="btn" id="edit">✏️ Изменить анкету</button>
            <button class="btn ghost" id="remove">🗑 Удалить анкету</button></div>` : ''}
        </div>
        ${canFill ? `
        <form class="card" id="f" autocomplete="off">
          <h2 style="margin-bottom:12px">${editing ? 'Изменение анкеты' : 'Анкета точки'}</h2>
          <div class="field"><label>Контактное лицо</label><input type="text" name="contact" value="${d('contact')}"></div>
          <div class="field"><label>Должность</label><input type="text" name="position" placeholder="владелец, продавец, закупщик…" value="${d('position')}"></div>
          <div class="field"><label>Телефон</label><input type="tel" name="phone" placeholder="+7" value="${d('phone')}"></div>
          <div class="field"><label>WhatsApp</label><input type="tel" name="whatsapp" placeholder="если отличается" value="${d('whatsapp')}"></div>
          <div class="field"><label>Instagram / сайт</label><input type="text" name="instagram" autocapitalize="off" value="${d('instagram')}"></div>
          <div class="field"><span class="label">Ассортимент</span>${chips('assortment', ASSORTMENT, 'checkbox', src.assortment || [])}
            <input type="text" name="assortmentOther" placeholder="Другое" style="margin-top:8px" value="${d('assortmentOther')}"></div>
          <div class="field"><span class="label">Бренды конкурентов на полке</span>${chips('competitors', COMPETITORS, 'checkbox', src.competitors || [])}
            <input type="text" name="competitorsOther" placeholder="Другие бренды" style="margin-top:8px" value="${d('competitorsOther')}"></div>
          <div class="field"><label>Поставщик (у кого закупаются)</label><input type="text" name="supplier" value="${d('supplier')}"></div>
          <div class="field"><span class="label">Работают с Alina?</span>${chips('alina', ALINA, 'radio', [src.alina])}</div>
          <div class="field"><span class="label">Наши бренды в точке</span>${chips('ourBrands', OUR_BRANDS, 'checkbox', src.ourBrands || [])}</div>
          <div class="field"><span class="label">Интерес к сотрудничеству <span class="req">*</span></span>${chips('interest', INTEREST, 'radio', [src.interest])}</div>
          <div class="field"><label>Итог / следующий шаг</label><textarea name="nextStep" placeholder="Например: отправить прайс в WhatsApp, перезвонить в пятницу">${d('nextStep')}</textarea></div>
          <div class="field"><label>Комментарий</label><textarea name="comment">${d('comment')}</textarea></div>
          <div class="field"><span class="label">Фото витрины</span>
            <label class="btn ghost file-btn">📷 Добавить фото<input type="file" id="photo" accept="image/*" multiple></label>
            ${editing && editing.photoCount ? `<div class="muted">Уже загружено фото: ${editing.photoCount}. Новые добавятся к ним.</div>` : ''}
            <div class="photos" id="photos"></div></div>
          <button class="btn ok" type="submit" id="submit">${editing ? '💾 Сохранить изменения' : '✓ Выполнено — отправить'}</button>
          ${editing ? '<button class="btn ghost" type="button" id="cancelEdit" style="margin-top:8px">Отмена</button>' : ''}
        </form>` : ''}`;

      $('go').onclick = () => openRoute(p);
      if ($('claim')) $('claim').onclick = (ev) => act(ev.target, () => api.claim(id), 'Точка ваша');
      if ($('release')) $('release').onclick = (ev) => {
        if (confirm('Вернуть точку в свободные?')) act(ev.target, () => api.release(id), 'Точка освобождена');
      };
      if ($('edit')) $('edit').onclick = (ev) => startEdit(ev.target);
      if ($('remove')) $('remove').onclick = (ev) => {
        if (confirm('Удалить анкету? Точка снова станет свободной, фото уйдут в корзину Google Диска.')) {
          act(ev.target, () => api.remove(id), 'Анкета удалена');
        }
      };
      if ($('cancelEdit')) $('cancelEdit').onclick = () => { editing = null; photos = []; renderPoint(); };
      const f = $('f');
      if (!f) return;
      f.oninput = () => { if (!editing) store.set('draft:' + id, readForm(f)); };
      $('photo').onchange = async (ev) => {
        const files = Array.from(ev.target.files || []);
        ev.target.value = '';
        for (const file of files) {
          if (photos.length >= 6) { toast('Не больше 6 фото', true); break; }
          try { photos.push(await compress(file)); } catch (e) { toast('Не удалось прочитать фото', true); }
        }
        drawPhotos();
      };
      drawPhotos();
      f.onsubmit = (ev) => { ev.preventDefault(); submit(f); };
    }

    function drawPhotos() {
      const box = $('photos');
      if (!box) return;
      box.innerHTML = photos.map((src, i) => `<div class="ph"><img src="${src}" alt=""><button type="button" data-i="${i}">×</button></div>`).join('');
      box.querySelectorAll('button').forEach((b) => { b.onclick = () => { photos.splice(Number(b.dataset.i), 1); drawPhotos(); }; });
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
          toast('Изменения сохранены');
        } catch (e) {
          toast(e.server ? e.message : 'Нет связи, изменения не сохранены', true);
          btn.disabled = false;
          btn.textContent = '💾 Сохранить изменения';
          return;
        }
        if (location.hash === hash) renderPoint();
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Отправка…';
      try {
        p = await api.complete(id, form, photos);
        updateCached(p);
        store.del('draft:' + id);
        toast('Готово! Точка выполнена');
        location.hash = '#/r/' + routeNo;
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
    const out = {};
    ['contact', 'position', 'phone', 'whatsapp', 'instagram', 'supplier', 'alina', 'interest', 'nextStep', 'comment']
      .forEach((k) => { out[k] = r[k] || ''; });
    return Object.assign(out, {
      assortment: a.chosen, assortmentOther: a.other,
      competitors: c.chosen, competitorsOther: c.other,
      ourBrands: split(r.ourBrands, OUR_BRANDS).chosen,
      photoCount: String(r.photos || '').split(/\s+/).filter(Boolean).length,
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
    new FormData(f).forEach((v, k) => {
      if (k in data && Array.isArray(data[k])) data[k].push(v);
      else data[k] = String(v).trim();
    });
    return data;
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
    if (document.hidden) return;
    flushOutbox();
    if (currentLoad) currentLoad();
  });
  setInterval(flushOutbox, 90000);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  route();
  flushOutbox();
})();
