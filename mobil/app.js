/* AMMO Mobil v1.0 — AMMO SUITE və AMMO (Vergi) üçün telefon paneli.
 *  • Eyni Firebase layihəsi (konsalting-79c40), eyni hesablar və eyni Firestore qaydaları.
 *  • Server, əlavə xərc yoxdur: statik fayllardır (GitHub Pages və ya Firebase Hosting).
 *  • Admin (memmed@ammo.az və ya users/{uid}.role == "admin") hər şeyi görür və idarə edir;
 *    işçi yalnız EMPLOYEE_SECTIONS-dakı bölmələri görür (standart: öz tapşırıqları).
 *  • e-taxes əməliyyatları «Uzaqdan əmrlər» ilə: əmr Firestore-a yazılır, ofisdə e-taxes açıq olan
 *    kompüterdəki AMMO (v1.25+) icra edir, nəticə telefona qayıdır. */
(() => {
  'use strict';

  // ------------------------------------------------------------------ ayarlar
  const FB = { apiKey: 'AIzaSyDyFppIEdpJomUAmeQ8b9V96rpBM9cG2Jg', projectId: 'konsalting-79c40' };
  const ADMIN_EMAILS = ['memmed@ammo.az'];
  const EMPLOYEE_SECTIONS = ['tasks']; // işçilərə açıq bölmələr (istəsəniz: 'beyanname','letters','reports')
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzNfq2z5uxaU1CLxjGG1gVS1K1FaiRA5dFKvmUkzDNGRz1f2qsHOVdFu3-sy4zygkZN/exec';
  const BASE = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents`;
  const AUTH_KEY = 'ammoMobAuth';
  const VERSION = '1.0.0';

  // ------------------------------------------------------------------ köməkçilər
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n0 = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const r2 = (v) => Math.round(n0(v) * 100) / 100;
  const money = (v, cur = '₼') => `${n0(v).toLocaleString('az-AZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`.trim();
  const pad = (x) => String(x).padStart(2, '0');
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const fmtDate = (v, withTime) => {
    if (!v) return '—';
    let d = new Date(v);
    if (/^\d{2}\.\d{2}\.\d{4}/.test(String(v))) { const [dd, mm, yy] = String(v).slice(0, 10).split('.'); d = new Date(+yy, +mm - 1, +dd); }
    if (Number.isNaN(d.getTime())) return String(v);
    const s = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
    return withTime ? `${s} ${pad(d.getHours())}:${pad(d.getMinutes())}` : s;
  };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  const ago = (t) => { const ms = Date.now() - new Date(t).getTime(); if (!isFinite(ms)) return '—'; const m = Math.round(ms / 60000); if (m < 1) return 'indicə'; if (m < 60) return `${m} dəq əvvəl`; const h = Math.round(m / 60); if (h < 48) return `${h} saat əvvəl`; return `${Math.round(h / 24)} gün əvvəl`; };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Date.now().toString(36) + Math.random().toString(36).slice(2));

  function toast(text, kind = '', ms = 3500) {
    const el = $('#toast'); el.textContent = text; el.className = 'toast show ' + kind;
    clearTimeout(toast.t); toast.t = setTimeout(() => { el.className = 'toast'; }, ms);
  }

  // ------------------------------------------------------------------ Firestore dəyərləri
  const enc = (v) => {
    if (v === null || v === undefined) return { nullValue: null };
    if (v instanceof Date) return { timestampValue: v.toISOString() };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, enc(x)])) } };
    return { stringValue: String(v) };
  };
  const dec = (v) => {
    if (!v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('nullValue' in v) return null;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
    if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]));
    return null;
  };
  const decDoc = (d) => { const o = Object.fromEntries(Object.entries(d.fields || {}).map(([k, x]) => [k, dec(x)])); o.id = String(d.name || '').split('/').pop(); o._updateTime = d.updateTime; return o; };
  const encFields = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => [k, enc(x)]));
  const b64id = (s) => btoa(unescape(encodeURIComponent(String(s)))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '_');

  // ------------------------------------------------------------------ giriş
  let AUTH = null, ME = null;
  const loadAuth = () => { try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { return null; } };
  const saveAuth = (a) => { AUTH = a; try { a ? localStorage.setItem(AUTH_KEY, JSON.stringify(a)) : localStorage.removeItem(AUTH_KEY); } catch (e) { /* */ } };
  const loginError = (m) => /INVALID_LOGIN|INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_EMAIL/.test(m) ? 'E-poçt və ya parol yanlışdır' : /TOO_MANY/.test(m) ? 'Çox cəhd edildi — bir az sonra yenidən yoxlayın' : /USER_DISABLED/.test(m) ? 'Hesab bloklanıb — adminə müraciət edin' : /API key|API_KEY|referer|Referer/.test(m) ? 'Firebase API açarı bu sayta icazə vermir (Google Cloud → API açarının məhdudiyyətinə bu ünvanı əlavə edin)' : m;

  async function signIn(email, password) {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FB.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(loginError(d?.error?.message || 'Giriş alınmadı'));
    saveAuth({ email: (d.email || email).toLowerCase(), uid: d.localId, idToken: d.idToken, refreshToken: d.refreshToken, expiresAt: Date.now() + Number(d.expiresIn || 3600) * 1000 });
  }
  async function token(force) {
    if (!AUTH) throw Object.assign(new Error('Giriş edilməyib'), { status: 401 });
    if (force || Date.now() > Number(AUTH.expiresAt || 0) - 120000) {
      const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FB.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: AUTH.refreshToken }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { if (r.status === 400) { saveAuth(null); showLogin('Sessiya bitib — yenidən daxil olun'); } throw Object.assign(new Error(d?.error?.message || 'Sessiya yenilənmədi'), { status: 401 }); }
      saveAuth({ ...AUTH, idToken: d.id_token, refreshToken: d.refresh_token || AUTH.refreshToken, uid: d.user_id || AUTH.uid, expiresAt: Date.now() + Number(d.expires_in || 3600) * 1000 });
    }
    return AUTH.idToken;
  }

  // ------------------------------------------------------------------ Firestore REST
  async function call(method, path, body, query, retried) {
    const url = (path.startsWith('http') ? path : `${BASE}/${path}`) + (query ? (path.includes('?') ? '&' : '?') + query : '');
    const t = await token(retried);
    const r = await fetch(url, { method, cache: 'no-store', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) });
    if (r.status === 401 && !retried) return call(method, path, body, query, true);
    const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) { /* */ }
    if (!r.ok && r.status !== 404) {
      const m = json?.error?.message || ('HTTP ' + r.status);
      throw Object.assign(new Error(/PERMISSION_DENIED|insufficient permissions/i.test(m) ? 'İcazə yoxdur (Firestore qaydaları)' : /RESOURCE_EXHAUSTED|Quota/i.test(m) ? 'Firebase gündəlik limiti bitib — sabah yenidən' : m), { status: r.status, raw: m });
    }
    return { status: r.status, json };
  }
  const fs = {
    async get(path) { const r = await call('GET', path); return r.status === 404 ? null : decDoc(r.json); },
    async list(coll, { pageSize = 300, max = 5000, orderBy = '', mask = null } = {}) {
      const out = []; let pt = '';
      do {
        const q = [`pageSize=${pageSize}`]; if (orderBy) q.push('orderBy=' + encodeURIComponent(orderBy)); if (pt) q.push('pageToken=' + encodeURIComponent(pt));
        if (mask) mask.forEach((f) => q.push('mask.fieldPaths=' + encodeURIComponent(f)));
        const r = await call('GET', coll, null, q.join('&'));
        if (r.status === 404 || !r.json) break;
        (r.json.documents || []).forEach((d) => out.push(decDoc(d)));
        pt = r.json.nextPageToken || '';
      } while (pt && out.length < max);
      return out;
    },
    async set(path, obj) { const r = await call('PATCH', path, { fields: encFields(obj) }); return decDoc(r.json); },
    async merge(path, obj, extraQuery) {
      const mask = Object.keys(obj).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : '`' + k + '`')).join('&');
      const r = await call('PATCH', path, { fields: encFields(obj) }, mask + (extraQuery ? '&' + extraQuery : ''));
      return decDoc(r.json);
    },
    async create(coll, id, obj) { const r = await call('PATCH', `${coll}/${encodeURIComponent(id)}`, { fields: encFields(obj) }, 'currentDocument.exists=false'); return decDoc(r.json); },
    async del(path) { await call('DELETE', path); return true; },
    async query(structuredQuery) {
      const r = await call('POST', `${BASE}:runQuery`, { structuredQuery });
      return (Array.isArray(r.json) ? r.json : []).filter((x) => x.document).map((x) => decDoc(x.document));
    },
  };
  // dəyişiklik nişanları — açıq kompüterlər bunu görüb dərhal yeniləyir
  const bumpSuite = (name) => fs.merge(`suiteSharedV3/_rev_${safe(name)}`, { rev: Date.now() }).catch(() => {});
  const bumpAmmo = (name) => fs.merge(`suiteSharedV3/_rev_ammo_${safe(name)}`, { rev: Date.now() }).catch(() => {});

  // AMMO SUITE modul məlumatı (cloud-sync.js formatı): suiteSharedV3/<modul>/keys
  const suiteDocId = (scope, key) => `${scope}_${b64id(key)}`;
  async function suiteKv(module) {
    const docs = await fs.list(`suiteSharedV3/${module}/keys`);
    const out = new Map();
    for (const d of docs) {
      if (!d.key || d.deleted === true) continue;
      let v = d.value;
      if (d.scope === 'local' && typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { /* mətn */ } }
      out.set(d.key, { value: v, scope: d.scope || 'chrome', updatedAt: d.updatedAt, updatedBy: d.updatedBy });
    }
    return out;
  }
  async function suiteKvPut(module, scope, key, value) {
    await fs.set(`suiteSharedV3/${module}/keys/${suiteDocId(scope, key)}`, { module, scope, key, deleted: false, updatedAt: new Date(), updatedBy: AUTH.email, value: scope === 'local' ? JSON.stringify(value) : value });
    await bumpSuite('mod_' + module);
  }
  // AMMO (Vergi) açar-dəyər formatı (ammo-cloud.js): {key, json, parts}
  async function ammoKvAll(ns) {
    const docs = await fs.list(`suiteSharedV3/${safe(ns)}/keys`);
    const parts = new Map(), out = new Map();
    docs.forEach((d) => { if (d.chunk) parts.set(d.id, d.json || ''); });
    docs.forEach((d) => {
      if (d.chunk || !d.key || d.deleted) return;
      let json = d.json || 'null';
      for (let i = 1; i < (d.parts || 1); i++) json += parts.get(`${d.id}__p${i}`) || '';
      try { out.set(d.key, { value: JSON.parse(json), updatedAt: d.updatedAt, updatedBy: d.updatedBy }); } catch (e) { /* */ }
    });
    return out;
  }
  async function ammoKvGet(ns, key) {
    const id = b64id(key).slice(0, 1400);
    const d = await fs.get(`suiteSharedV3/${safe(ns)}/keys/${id}`); if (!d || d.deleted) return undefined;
    let json = d.json || 'null';
    for (let i = 1; i < (d.parts || 1); i++) { const p = await fs.get(`suiteSharedV3/${safe(ns)}/keys/${id}__p${i}`); json += (p && p.json) || ''; }
    try { return JSON.parse(json); } catch (e) { return undefined; }
  }

  // sadə keş (oxumalara qənaət: 2 dəqiqə)
  const CACHE = new Map();
  async function cached(key, fn, ttl = 120000) {
    const c = CACHE.get(key);
    if (c && Date.now() - c.at < ttl) return c.v;
    const v = await fn(); CACHE.set(key, { v, at: Date.now() }); return v;
  }
  const dropCache = (prefix) => { for (const k of [...CACHE.keys()]) if (!prefix || k.startsWith(prefix)) CACHE.delete(k); };

  // ------------------------------------------------------------------ ümumi məlumat
  const isAdmin = () => !!ME && (ME.role === 'admin' || ADMIN_EMAILS.includes(AUTH.email));
  const users = () => cached('users', async () => (await fs.list('users')).map((u) => ({ ...u, name: u.name || u.displayName || String(u.loginEmail || u.email || '').split('@')[0] })));
  const companies = () => cached('companies', async () => (await fs.list('companies')).sort((a, b) => String(a.name).localeCompare(String(b.name), 'az')));

  // ------------------------------------------------------------------ marşrutlar və qabıq
  const SECTIONS = {
    home: { title: 'Əsas', icon: '🏠', render: viewHome },
    tasks: { title: 'Tapşırıqlar', icon: '✅', render: viewTasks },
    beyanname: { title: 'Bəyannamə nəzarət', short: 'Bəyannamə', icon: '📊', render: viewBeyanname },
    letters: { title: 'Vergi məktubları', short: 'Məktublar', icon: '📬', render: viewLetters },
    reports: { title: 'Hesabat vaxtı', icon: '⏰', render: viewReports },
    debts: { title: 'Borc xatırladıcı', icon: '💳', render: viewDebts },
    driver: { title: 'Sürücü gəliri', icon: '🚚', render: viewDriver },
    docs: { title: 'Sənəd dövriyyəsi', icon: '🗂', render: viewDocs },
    remote: { title: 'Uzaqdan əmrlər (e-taxes)', short: 'e-taxes', icon: '🛰', render: viewRemote },
    admin: { title: 'İdarəetmə', icon: '⚙', render: viewAdmin },
    more: { title: 'Daha çox', icon: '☰', render: viewMore },
  };
  const allowed = (id) => isAdmin() || EMPLOYEE_SECTIONS.includes(id) || id === 'more';
  let current = 'home', stopTimers = [];

  function tabsFor() {
    if (isAdmin()) return ['home', 'tasks', 'beyanname', 'remote', 'more'];
    const t = EMPLOYEE_SECTIONS.slice(0, 4);
    return EMPLOYEE_SECTIONS.length > 4 ? [...t, 'more'] : t;
  }
  function renderTabbar() {
    $('#tabbar').innerHTML = tabsFor().map((id) => `<button data-go="${id}" class="${current === id || (id === 'more' && !tabsFor().includes(current)) ? 'on' : ''}"><i>${SECTIONS[id].icon}</i>${esc(SECTIONS[id].short || SECTIONS[id].title)}</button>`).join('');
    $$('#tabbar [data-go]').forEach((b) => b.onclick = () => go(b.dataset.go));
  }
  function setTitle(title, sub) { $('#pageTitle').textContent = title; $('#pageSub').textContent = sub || ''; }

  async function go(id, opts = {}) {
    if (!SECTIONS[id] || !allowed(id)) id = tabsFor()[0];
    stopTimers.forEach((f) => f()); stopTimers = [];
    current = id;
    if (!opts.noHash) history.replaceState(null, '', '#' + id);
    renderTabbar();
    $('#backBtn').hidden = tabsFor().includes(id);
    setTitle(SECTIONS[id].title, '');
    const view = $('#view');
    view.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    window.scrollTo(0, 0);
    try { await SECTIONS[id].render(view); }
    catch (e) { console.error(e); view.innerHTML = `<div class="card"><h3>⚠ Yüklənmədi</h3><p class="muted">${esc(e.message || e)}</p><button class="btn" id="retry">Yenidən cəhd et</button></div>`; $('#retry').onclick = () => go(id); }
  }
  $('#backBtn').onclick = () => go('more');
  $('#refreshBtn').onclick = () => { dropCache(); go(current); };

  // aşağıdan açılan pəncərə
  function sheet(html, onBind) {
    $('#sheetBody').innerHTML = html; $('#sheet').classList.remove('hidden'); document.body.style.overflow = 'hidden';
    if (onBind) onBind($('#sheetBody'));
  }
  function closeSheet() { $('#sheet').classList.add('hidden'); document.body.style.overflow = ''; $('#sheetBody').innerHTML = ''; }
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

  function searchBox(placeholder, onInput, value = '') {
    return { html: `<div class="search"><input type="search" id="q" placeholder="${esc(placeholder)}" value="${esc(value)}"></div>`, bind: () => { const i = $('#q'); i.addEventListener('input', debounce(() => onInput(i.value.trim()), 180)); } };
  }
  const fold = (s) => String(s || '').toLocaleLowerCase('az').replace(/[əƏ]/g, 'e').replace(/[ıİ]/g, 'i').replace(/[öÖ]/g, 'o').replace(/[üÜ]/g, 'u').replace(/[şŞ]/g, 's').replace(/[çÇ]/g, 'c').replace(/[ğĞ]/g, 'g');

  // ================================================================== ƏSAS
  async function viewHome(view) {
    setTitle('Salam, ' + (ME.name || AUTH.email.split('@')[0]), fmtDate(new Date()) + ' · ' + AUTH.email);
    const installTip = !window.matchMedia('(display-mode: standalone)').matches && !navigator.standalone
      ? `<div class="install"><span style="font-size:26px">📲</span><div><b>Ana ekrana əlavə edin</b><span class="muted">${/iPhone|iPad/.test(navigator.userAgent) ? 'Safari → Paylaş (⬆) → «Ana ekrana əlavə et»' : 'Chrome → ⋮ menyu → «Ana ekrana əlavə et» / «Quraşdır»'}</span></div></div>` : '';
    view.innerHTML = `${installTip}
      <div class="grid2">
        <div class="kpi" data-go="tasks"><span>Açıq tapşırıqlar</span><b id="k-tasks">…</b><small id="k-tasks2">&nbsp;</small></div>
        <div class="kpi" data-go="letters"><span>Cavabsız məktublar</span><b id="k-letters">…</b><small id="k-letters2">&nbsp;</small></div>
        <div class="kpi" data-go="reports"><span>Hesabat vaxtı (7 gün)</span><b id="k-reports">…</b><small id="k-reports2">&nbsp;</small></div>
        <div class="kpi" data-go="debts"><span>Gecikmiş borclar</span><b id="k-debts">…</b><small id="k-debts2">&nbsp;</small></div>
      </div>
      <div class="sec-title">Ofisdə e-taxes açıq olan kompüterlər</div>
      <div class="list" id="agents"><div class="empty">Yoxlanılır…</div></div>
      <div class="sec-title">Bölmələr</div>
      <div class="list">${['beyanname', 'driver', 'docs', 'remote', 'admin'].map((id) => `<div class="item" data-go="${id}"><span style="font-size:20px">${SECTIONS[id].icon}</span><div class="main"><b>${esc(SECTIONS[id].title)}</b></div><span class="muted">›</span></div>`).join('')}</div>
      <p class="muted small" style="text-align:center">AMMO Mobil ${VERSION}</p>`;
    $$('[data-go]', view).forEach((b) => b.onclick = () => go(b.dataset.go));
    const set = (id, v, sub, cls) => { const el = $('#k-' + id); if (!el) return; el.textContent = v; if (sub != null) $('#k-' + id + '2').textContent = sub; if (cls) el.parentElement.classList.add(cls); };
    loadTasks().then((ts) => { const open = ts.filter((t) => t.status === 'new' || t.status === 'progress'); const late = open.filter((t) => daysLate(t) > 0); set('tasks', open.length, late.length ? `${late.length} gecikib` : 'gecikmə yoxdur', late.length ? 'bad' : 'ok'); }).catch((e) => set('tasks', '—', e.message));
    loadLetters().then((ls) => { const open = ls.filter(letterOpen); set('letters', open.length, open.length ? `ən köhnəsi ${Math.max(...open.map((l) => letterDays(l)))} gün` : 'hamısı cavablanıb', open.length ? 'warn' : 'ok'); }).catch((e) => set('letters', '—', e.message));
    loadReports().then((rs) => { const soon = rs.filter((r) => !r.sent && r.left <= 7); const late = soon.filter((r) => r.left < 0); set('reports', soon.length, late.length ? `${late.length} gecikib` : 'yaxın 7 gün', late.length ? 'bad' : soon.length ? 'warn' : 'ok'); }).catch((e) => set('reports', '—', e.message));
    loadDebts().then((ds) => { const od = ds.filter((d) => d.overdue.length); const sum = od.reduce((s, d) => s + d.overdueSum, 0); set('debts', od.length, od.length ? money(sum) : 'yoxdur', od.length ? 'bad' : 'ok'); }).catch((e) => set('debts', '—', e.message));
    loadAgents().then((ag) => {
      const el = $('#agents'); if (!el) return;
      el.innerHTML = ag.length ? ag.map((a) => `<div class="item"><span style="font-size:20px">${a.fresh ? '🟢' : '⚪'}</span><div class="main"><b>${esc(a.email)}</b><small>${esc(a.device || '')} · ${esc(ago(a.at))}</small><small>${(a.tabs || []).map((t) => esc(t.name || t.tin)).join(' · ') || 'kabinet yoxdur'}</small></div></div>`).join('')
        : '<div class="empty">Hazırda heç bir kompüterdə e-taxes açıq deyil.<br><span class="small">Uzaqdan əmrlər üçün ofisdə AMMO (v1.25+) ilə e-taxes kabineti açıq olmalıdır.</span></div>';
    }).catch(() => { const el = $('#agents'); if (el) el.innerHTML = '<div class="empty">—</div>'; });
  }

  // ================================================================== TAPŞIRIQLAR
  const T_STATUS = { new: ['Yeni', 'info'], progress: ['İcrada', 'warn'], done: ['İcra olunub', 'ok'], wrong: ['Yanlış', 'bad'] };
  const daysLate = (t) => { if (!t.dueAt) return 0; const end = t.status === 'done' ? (t.completedAt || t.updatedAt) : new Date().toISOString(); return Math.max(0, Math.ceil((new Date(end) - new Date(t.dueAt)) / 86400000)); };
  async function loadTasks(force) {
    if (force) dropCache('tasks');
    return cached('tasks', async () => {
      if (isAdmin()) return fs.list('tasks');
      const q = (f) => fs.query({ from: [{ collectionId: 'tasks' }], where: { fieldFilter: { field: { fieldPath: f }, op: 'EQUAL', value: { stringValue: AUTH.uid } } }, limit: 500 });
      const [a, b] = await Promise.all([q('assigneeId'), q('senderId')]);
      const m = new Map(); [...a, ...b].forEach((t) => m.set(t.id, t)); return [...m.values()];
    }, 60000);
  }
  let taskFilter = { st: 'open', q: '', mine: false };
  async function viewTasks(view) {
    const [ts, us] = await Promise.all([loadTasks(), users().catch(() => [])]);
    const person = (id) => us.find((u) => u.id === id) || { name: '—' };
    setTitle('Tapşırıqlar', `${ts.length} tapşırıq`);
    const sb = searchBox('Axtar: başlıq, şirkət, işçi…', (q) => { taskFilter.q = q; draw(); }, taskFilter.q);
    view.innerHTML = `${sb.html}
      <div class="chips">${[['open', 'Açıq'], ['late', 'Gecikən'], ['new', 'Yeni'], ['progress', 'İcrada'], ['done', 'İcra olunub'], ['all', 'Hamısı']].map(([k, t]) => `<button class="chip ${taskFilter.st === k ? 'on' : ''}" data-st="${k}">${t}</button>`).join('')}
      ${isAdmin() ? `<button class="chip ${taskFilter.mine ? 'on' : ''}" id="mine">Mənə aid</button>` : ''}</div>
      <button class="btn primary block" id="newTask" style="margin-bottom:12px">＋ Yeni tapşırıq</button>
      <div class="list" id="tlist"></div>`;
    sb.bind();
    $$('[data-st]', view).forEach((b) => b.onclick = () => { taskFilter.st = b.dataset.st; $$('[data-st]', view).forEach((x) => x.classList.toggle('on', x === b)); draw(); });
    if ($('#mine')) $('#mine').onclick = (e) => { taskFilter.mine = !taskFilter.mine; e.target.classList.toggle('on', taskFilter.mine); draw(); };
    $('#newTask').onclick = () => newTaskSheet();
    function draw() {
      const q = fold(taskFilter.q);
      let list = ts.filter((t) => {
        if (taskFilter.mine && t.assigneeId !== AUTH.uid && t.senderId !== AUTH.uid) return false;
        const st = taskFilter.st;
        if (st === 'open' && !(t.status === 'new' || t.status === 'progress')) return false;
        if (st === 'late' && !((t.status === 'new' || t.status === 'progress') && daysLate(t) > 0)) return false;
        if (['new', 'progress', 'done'].includes(st) && t.status !== st) return false;
        if (q && !fold([t.title, t.description, t.companyName, t.companyVoen, person(t.assigneeId).name, person(t.senderId).name].join(' ')).includes(q)) return false;
        return true;
      });
      list.sort((a, b) => (a.status === 'done') - (b.status === 'done') || String(a.dueAt || '').localeCompare(String(b.dueAt || '')));
      $('#tlist').innerHTML = list.length ? list.slice(0, 300).map((t) => {
        const [sn, sc] = T_STATUS[t.status] || [t.status, '']; const late = daysLate(t);
        return `<div class="item" data-id="${esc(t.id)}"><div class="main"><b>${esc(t.title)}</b><small>${esc(t.companyName || '')} · ${esc(person(t.assigneeId).name)}</small><small>Son tarix: ${fmtDate(t.dueAt)}${late && t.status !== 'done' ? ` · <span style="color:var(--bad)">${late} gün gecikib</span>` : ''}</small></div><div class="side"><span class="pill ${sc}">${esc(sn)}</span></div></div>`;
      }).join('') : '<div class="empty">Tapşırıq yoxdur</div>';
      $$('#tlist [data-id]').forEach((el) => el.onclick = () => taskSheet(ts.find((t) => t.id === el.dataset.id), person));
    }
    draw();
  }
  function taskSheet(t, person) {
    const canStatus = isAdmin() || t.assigneeId === AUTH.uid;
    const [sn, sc] = T_STATUS[t.status] || [t.status, ''];
    sheet(`<h2>${esc(t.title)}</h2><span class="pill ${sc}">${esc(sn)}</span>
      <div class="kv"><span>Şirkət</span><b>${esc(t.companyName || '—')} ${t.companyVoen ? '(' + esc(t.companyVoen) + ')' : ''}</b>
        <span>Kimdən</span><b>${esc(person(t.senderId).name)}</b><span>Kimə</span><b>${esc(person(t.assigneeId).name)}</b>
        <span>Yaradılıb</span><b>${fmtDate(t.createdAt, true)}</b><span>Son tarix</span><b>${fmtDate(t.dueAt, true)}${daysLate(t) && t.status !== 'done' ? ` · <span style="color:var(--bad)">${daysLate(t)} gün gecikib</span>` : ''}</b></div>
      ${t.description ? `<div class="card" style="white-space:pre-wrap">${esc(t.description)}</div>` : ''}
      ${(t.files || []).length ? `<div class="sec-title">Fayllar</div><div class="list">${t.files.map((f, i) => `<div class="item" data-file="${i}"><span>📎</span><div class="main"><b>${esc(f.name || 'fayl')}</b><small>${f.size ? Math.round(f.size / 1024) + ' KB' : ''}</small></div><span class="muted">Aç</span></div>`).join('')}</div>` : ''}
      ${canStatus ? `<div class="sec-title">Statusu dəyiş</div><div class="row">
        <button class="btn grow" data-set="progress">İcraya götür</button><button class="btn ok grow" data-set="done">İcra olundu</button><button class="btn danger grow" data-set="wrong">Yanlış</button></div>` : ''}
      ${(t.history || []).length ? `<div class="sec-title">Tarixçə</div>${t.history.slice(0, 12).map((h) => `<div class="hist">${fmtDate(h.at, true)} · ${esc(h.user || '')} · ${esc((T_STATUS[h.status] || [h.status])[0])}</div>`).join('')}` : ''}
      ${isAdmin() ? `<div style="margin-top:16px"><button class="btn danger block" id="delTask">Tapşırığı sil</button></div>` : ''}`,
    (root) => {
      $$('[data-set]', root).forEach((b) => b.onclick = async () => {
        b.disabled = true;
        try {
          const now = new Date().toISOString();
          const hist = [{ at: now, user: ME.name || AUTH.email, userId: AUTH.uid, status: b.dataset.set }, ...(t.history || [])];
          const upd = { status: b.dataset.set, updatedAt: now, history: hist };
          if (b.dataset.set === 'done') upd.completedAt = now;
          await fs.merge(`tasks/${encodeURIComponent(t.id)}`, upd); await bumpSuite('taskpanel');
          Object.assign(t, upd); toast('Status yeniləndi', 'ok'); closeSheet(); dropCache('tasks'); go('tasks');
        } catch (e) { toast(e.message, 'bad'); b.disabled = false; }
      });
      $$('[data-file]', root).forEach((el) => el.onclick = () => openTaskFile(t, t.files[+el.dataset.file]));
      if ($('#delTask', root)) $('#delTask', root).onclick = async () => {
        if (!confirm('Tapşırıq silinsin?')) return;
        try { await fs.del(`tasks/${encodeURIComponent(t.id)}`); await bumpSuite('taskpanel'); toast('Silindi'); closeSheet(); dropCache('tasks'); go('tasks'); } catch (e) { toast(e.message, 'bad'); }
      };
    });
  }
  async function openTaskFile(t, f) {
    try {
      toast('Fayl yüklənir…');
      let b64 = '';
      if (f.backend === 'firestoreChunks' && f.fileId) {
        const parts = [];
        for (let i = 0; i < Number(f.chunks || 0); i++) { const d = await fs.get(`taskFileChunks/${t.id}_${f.fileId}_${String(i).padStart(4, '0')}`); if (!d || typeof d.data !== 'string') throw new Error('Faylın bir hissəsi tapılmadı'); parts.push(d.data); }
        b64 = parts.join('');
      } else if (f.data) b64 = f.data;
      else throw new Error('Bu fayl yalnız göndərən kompüterdə saxlanılıb');
      openB64(b64, f.type, f.name);
    } catch (e) { toast(e.message, 'bad'); }
  }
  function openB64(b64, mime, name) {
    const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([u], { type: mime || 'application/octet-stream' }));
    const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener';
    if (!/pdf|image|text/.test(mime || '')) a.download = name || 'fayl';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 120000);
  }
  async function newTaskSheet() {
    const [us, cs] = await Promise.all([users(), companies().catch(() => [])]);
    const active = us.filter((u) => u.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name), 'az'));
    const due = new Date(Date.now() + 3 * 86400000); const dueVal = `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}T18:00`;
    sheet(`<h2>Yeni tapşırıq</h2>
      <label>Şirkət<select id="ntC"><option value="">— seçin —</option>${cs.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}${c.voen ? ' · ' + esc(c.voen) : ''}</option>`).join('')}</select></label>
      <label>Kimə<select id="ntA"><option value="">— seçin —</option>${active.map((u) => `<option value="${esc(u.id)}">${esc(u.name)} (${esc(u.loginEmail || u.email || '')})</option>`).join('')}</select></label>
      <label>Başlıq<input id="ntT" maxlength="200"></label>
      <label>Məzmun<textarea id="ntD"></textarea></label>
      <label>Son tarix<input id="ntDue" type="datetime-local" value="${dueVal}"></label>
      <label style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="ntMail" checked style="width:auto;margin:0"> İşçiyə e-poçt göndər</label>
      <button class="btn primary block" id="ntSave">Göndər</button>`, (root) => {
      $('#ntSave', root).onclick = async (e) => {
        const cId = $('#ntC').value, aId = $('#ntA').value, title = $('#ntT').value.trim(), dueAt = $('#ntDue').value;
        if (!cId || !aId || !title || !dueAt) return toast('Şirkət, işçi, başlıq və son tarix lazımdır', 'bad');
        e.target.disabled = true;
        const c = cs.find((x) => x.id === cId) || {}, a = us.find((x) => x.id === aId) || {};
        const now = new Date().toISOString();
        const task = { companyId: cId, companyName: c.name || '', companyVoen: c.voen || '', assigneeId: aId, assigneeName: a.name || '', assigneeEmail: String(a.email || a.loginEmail || '').toLowerCase(), assigneeSecondaryEmail: String(a.secondaryEmail || '').toLowerCase(),
          senderId: AUTH.uid, senderName: ME.name || AUTH.email, senderEmail: AUTH.email, title, description: $('#ntD').value.trim(), dueAt, createdAt: now, updatedAt: now, status: 'new', files: [], fileUpload: { state: 'ready', queuedAt: now }, history: [], emailDelivery: { state: 'queued', queuedAt: now, provider: 'google-apps-script' }, source: 'AMMO Mobil' };
        try {
          const r = await call('POST', 'tasks', { fields: encFields(task) });
          const id = String(r.json.name).split('/').pop();
          await bumpSuite('taskpanel');
          if ($('#ntMail').checked && task.assigneeEmail) sendTaskMail(id, task);
          toast('Tapşırıq göndərildi', 'ok'); closeSheet(); dropCache('tasks'); go('tasks');
        } catch (err) { toast(err.message, 'bad'); e.target.disabled = false; }
      };
    });
  }
  async function sendTaskMail(taskId, t) {
    const payload = { taskId, task: { title: t.title, description: t.description, companyName: t.companyName, companyVoen: t.companyVoen, assigneeName: t.assigneeName, senderName: t.senderName, dueAt: t.dueAt, createdAt: t.createdAt }, to: [t.assigneeEmail, t.assigneeSecondaryEmail].filter(Boolean), subject: `Yeni tapşırıq: ${t.title}`, attachments: [] };
    let state = 'sent';
    try { await fetch(APPS_SCRIPT_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) }); }
    catch (e) { state = 'failed'; }
    fs.merge(`tasks/${taskId}`, { emailDelivery: { state, provider: 'google-apps-script', at: new Date().toISOString(), from: 'mobile' } }).catch(() => {});
  }

  // ================================================================== BƏYANNAMƏ NƏZARƏT
  const B_STATUS = {
    'TƏSDİQLƏNDİ': ['T', 's-ok'], 'KAMERAL TƏSDİQLƏNDİ': ['KT', 's-ok'], 'ANOLOJİ TƏSDİQLƏNDİ': ['AT', 's-ok'],
    'UYĞUNSUZLUQ YOXLAMASINDA': ['U', 's-bad'], 'TƏSDİQLƏNMƏDİ': ['U', 's-bad'], 'KAMERAL': ['K', 's-warn'], 'ANOLOJİ': ['A', 's-warn'], 'TƏQDİM OLUNAN': ['Q', 's-info'],
  };
  const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'İyn', 'İyl', 'Avq', 'Sen', 'Okt', 'Noy', 'Dek'];
  const RUBS = ['1 RÜB', '2 RÜB', '3 RÜB', '4 RÜB'];
  let bFilter = { year: String(new Date().getFullYear()), q: '', bad: false };
  async function viewBeyanname(view) {
    const rows = await cached('bn', async () => (await fs.list('beyannameNezaret')).filter((r) => !r.deleted));
    const years = [...new Set(rows.flatMap((r) => ['edv', 'omv', 'vvb', 'sv', 'emlak', 'menfeet', 'torpaq'].map((k) => r[k + 'Year']).filter(Boolean)))].sort().reverse();
    if (!years.includes(bFilter.year) && years.length) bFilter.year = years[0];
    const sb = searchBox('Şirkət və ya VÖEN…', (q) => { bFilter.q = q; draw(); }, bFilter.q);
    view.innerHTML = `${sb.html}
      <div class="chips">${years.map((y) => `<button class="chip ${y === bFilter.year ? 'on' : ''}" data-y="${y}">${y}</button>`).join('')}<button class="chip ${bFilter.bad ? 'on' : ''}" id="bBad">⚠ Yalnız uyğunsuzluq</button></div>
      <div class="legend">${[['T', 's-ok', 'Təsdiq'], ['KT/AT', 's-ok', 'Kameral/Analoji təsdiq'], ['K/A', 's-warn', 'Kameral/Analoji'], ['U', 's-bad', 'Uyğunsuzluq'], ['Q', 's-info', 'Təqdim olunub']].map(([a, c, t]) => `<span class="bc ${c}" style="padding:3px 8px">${a} <small style="display:inline">${t}</small></span>`).join('')}</div>
      <div id="blist"></div>`;
    sb.bind();
    $$('[data-y]', view).forEach((b) => b.onclick = () => { bFilter.year = b.dataset.y; $$('[data-y]', view).forEach((x) => x.classList.toggle('on', x === b)); draw(); });
    $('#bBad').onclick = (e) => { bFilter.bad = !bFilter.bad; e.target.classList.toggle('on', bFilter.bad); draw(); };
    function draw() {
      const y = bFilter.year, q = fold(bFilter.q);
      const groups = new Map();
      rows.forEach((r) => {
        if (!['edv', 'omv', 'vvb', 'sv', 'emlak', 'menfeet', 'torpaq'].some((k) => r[k + 'Year'] === y)) return;
        const k = `${r.teskilat || ''}|${r.voen || ''}`;
        if (!groups.has(k)) groups.set(k, { teskilat: r.teskilat, voen: r.voen, rows: [] });
        groups.get(k).rows.push(r);
      });
      const cell = (st, label) => { const [a, c] = B_STATUS[st] || [st ? '•' : '', '']; return `<div class="bc ${c}" title="${esc(st)}">${esc(a || '–')}<small>${esc(label)}</small></div>`; };
      const find = (g, type, field, val) => { const r = g.rows.find((x) => x[type + 'Year'] === y && (!field || x[type + field] === val) && x[type + 'Status']); return r ? r[type + 'Status'] : ''; };
      let list = [...groups.values()].sort((a, b) => String(a.teskilat).localeCompare(String(b.teskilat), 'az'));
      if (q) list = list.filter((g) => fold(g.teskilat + ' ' + g.voen).includes(q));
      if (bFilter.bad) list = list.filter((g) => g.rows.some((r) => ['edv', 'omv', 'vvb', 'sv', 'emlak', 'menfeet', 'torpaq'].some((k) => r[k + 'Year'] === y && B_STATUS[r[k + 'Status']]?.[1] === 's-bad')));
      setTitle('Bəyannamə nəzarət', `${y} · ${list.length} şirkət`);
      $('#blist').innerHTML = list.length ? list.map((g) => `<div class="card">
          <h3>${esc(g.teskilat || '—')} <span class="muted small">${esc(g.voen || '')}</span></h3>
          <div class="blabel">ƏDV</div><div class="bgrid m12">${MONTHS.map((m, i) => cell(find(g, 'edv', 'Month', pad(i + 1)), m)).join('')}</div>
          ${['omv', 'vvb', 'sv'].map((k) => `<div class="blabel">${{ omv: 'ÖMV', vvb: 'VVB', sv: 'SV' }[k]}</div><div class="bgrid q4">${RUBS.map((q4) => cell(find(g, k, 'Rub', q4), q4.replace(' RÜB', '-ci rüb').replace('3-ci', '3-cü').replace('4-ci', '4-cü'))).join('')}</div>`).join('')}
          <div class="bgrid y3">${[['menfeet', 'Mənfəət'], ['emlak', 'Əmlak'], ['torpaq', 'Torpaq']].map(([k, t]) => cell(find(g, k), t)).join('')}</div>
        </div>`).join('') : '<div class="empty">Bu il üçün qeyd yoxdur</div>';
    }
    draw();
  }

  // ================================================================== VERGİ MƏKTUBLARI
  const loadLetters = () => cached('letters', async () => (await fs.list('beyannameUcotu')).filter((r) => !r.deleted));
  const isoOf = (s) => { s = String(s || ''); let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return m[0]; m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(s); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
  const letterOpen = (r) => !(r.tarixCavab && r.tarixCavab !== 'yoxdur') && r.teyinat !== 'CAVABLANDIRILIB' && !!isoOf(r.tarixGelen);
  const letterDays = (r) => { const a = isoOf(r.tarixGelen); return a ? daysBetween(a, todayISO()) : 0; };
  let lFilter = { st: 'open', q: '' };
  async function viewLetters(view) {
    const ls = await loadLetters();
    const sb = searchBox('Şirkət, VÖEN, nömrə, növ…', (q) => { lFilter.q = q; draw(); }, lFilter.q);
    view.innerHTML = `${sb.html}<div class="chips">${[['open', 'Cavabsız'], ['all', 'Hamısı']].map(([k, t]) => `<button class="chip ${lFilter.st === k ? 'on' : ''}" data-st="${k}">${t}</button>`).join('')}</div><div class="list" id="llist"></div>`;
    sb.bind();
    $$('[data-st]', view).forEach((b) => b.onclick = () => { lFilter.st = b.dataset.st; $$('[data-st]', view).forEach((x) => x.classList.toggle('on', x === b)); draw(); });
    function draw() {
      const q = fold(lFilter.q);
      let list = ls.filter((r) => (lFilter.st === 'all' || letterOpen(r)) && (!q || fold([r.teskilat, r.voen, r.nomre, r.nov, r.qeyd].join(' ')).includes(q)));
      list.sort((a, b) => isoOf(b.tarixGelen).localeCompare(isoOf(a.tarixGelen)));
      setTitle('Vergi məktubları', `${ls.filter(letterOpen).length} cavabsız · ${ls.length} cəmi`);
      $('#llist').innerHTML = list.length ? list.slice(0, 300).map((r, i) => {
        const open = letterOpen(r), d = letterDays(r);
        return `<div class="item" data-i="${i}"><div class="main"><b>${esc(r.teskilat || '—')}</b><small>${esc(r.nov || '')}${r.nomre ? ' · ' + esc(r.nomre) : ''}</small><small>Gəlib: ${fmtDate(r.tarixGelen)}${r.tarixCavab && r.tarixCavab !== 'yoxdur' ? ' · Cavab: ' + fmtDate(r.tarixCavab) : ''}</small></div><div class="side">${open ? `<span class="pill ${d > 20 ? 'bad' : d > 10 ? 'warn' : 'info'}">${d} gün</span>` : '<span class="pill ok">Cavablanıb</span>'}</div></div>`;
      }).join('') : '<div class="empty">Məktub yoxdur</div>';
      $$('#llist [data-i]').forEach((el) => el.onclick = () => { const r = list[+el.dataset.i]; sheet(`<h2>${esc(r.teskilat)}</h2><div class="kv"><span>VÖEN</span><b>${esc(r.voen || '—')}</b><span>Nömrə</span><b>${esc(r.nomre || '—')}</b><span>Növ</span><b>${esc(r.nov || '—')}</b><span>Gəlib</span><b>${fmtDate(r.tarixGelen)}</b><span>Cavab</span><b>${esc(r.tarixCavab ? fmtDate(r.tarixCavab) : '—')}</b><span>Təyinat</span><b>${esc(r.teyinat || '—')}</b></div>${r.qeyd ? `<div class="card" style="white-space:pre-wrap">${esc(r.qeyd)}</div>` : ''}`); });
    }
    draw();
  }

  // ================================================================== HESABAT VAXTI
  const HV_START = new Date(2026, 3, 1);
  const HV_MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];
  function hvRule(t = '') {
    const day = +(t.match(/ayın\s+(\d+)/i) || [])[1] || 20;
    if (t.includes('Hər ay')) return { kind: 'monthly', day };
    if (t.includes('Hər rüb')) return { kind: 'quarterly', day };
    if (t.includes('Hər il')) { let month = 2; if (t.includes('yanvar')) month = 0; else if (t.includes('fevral')) month = 1; return { kind: 'yearly', day, month }; }
    return { kind: 'single' };
  }
  const isoD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function hvOccurrences(r) {
    if (!r.form || !r.periodText) return [{ key: r.dueDate, label: r.period || 'Hesabat dövrü', dueDate: r.dueDate }];
    const rule = hvRule(r.periodText), n = new Date(), now = new Date(n.getFullYear(), n.getMonth(), n.getDate()), out = [];
    if (rule.kind === 'monthly') {
      const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      for (let d = new Date(HV_START); d <= last; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) out.push({ key: `M-${d.getFullYear()}-${d.getMonth() + 1}`, label: `${HV_MONTHS[d.getMonth()]} ${d.getFullYear()}`, dueDate: isoD(new Date(d.getFullYear(), d.getMonth() + 1, rule.day)) });
    } else if (rule.kind === 'quarterly') {
      const cq = Math.floor(now.getMonth() / 3);
      for (let q = 2; q <= cq; q++) out.push({ key: `Q-${now.getFullYear()}-${q}`, label: `${now.getFullYear()}-cı il, ${q}-ci rüb`, dueDate: isoD(new Date(now.getFullYear(), q * 3, rule.day)) });
    } else if (rule.kind === 'yearly') {
      const y = Math.max(2026, now.getFullYear());
      out.push({ key: `Y-${y}`, label: `${y}-cı il`, dueDate: isoD(new Date(y + 1, rule.month, rule.day)) });
    } else out.push({ key: r.dueDate, label: r.period || 'Dövr göstərilməyib', dueDate: r.dueDate });
    return out;
  }
  let HV_META = null;
  async function loadReports(force) {
    if (force) dropCache('hv');
    return cached('hv', async () => {
      const kv = await suiteKv('hesabat-vaxti');
      const reports = (kv.get('reports') || {}).value || [];
      const psm = kv.get('periodStatusMap') || { value: {}, scope: (kv.get('reports') || {}).scope || 'chrome' };
      HV_META = { psm: psm.value || {}, scope: psm.scope || 'chrome' };
      const today = todayISO(), out = [];
      (Array.isArray(reports) ? reports : []).filter((r) => r.enabled !== false).forEach((r) => {
        hvOccurrences(r).forEach((o) => {
          if (!o.dueDate) return;
          const id = `${r.id}::${o.key}`;
          const sent = HV_META.psm[id] === 'Göndərildi' || (r.periodStatuses || {})[o.key] === 'Göndərildi' || (r.sentPeriods || []).includes(o.key);
          out.push({ id, rid: r.id, key: o.key, company: r.company || '', voen: r.voen || '', taxType: r.taxType || r.form || '', label: o.label, due: o.dueDate, left: daysBetween(today, o.dueDate), sent });
        });
      });
      return out.sort((a, b) => a.due.localeCompare(b.due));
    }, 60000);
  }
  let hvFilter = { st: 'todo', q: '' };
  async function viewReports(view) {
    const rs = await loadReports();
    const sb = searchBox('Şirkət, VÖEN, hesabat növü…', (q) => { hvFilter.q = q; draw(); }, hvFilter.q);
    view.innerHTML = `${sb.html}<div class="chips">${[['todo', 'Göndərilməyib'], ['late', 'Gecikən'], ['week', '7 gün içində'], ['sent', 'Göndərilib']].map(([k, t]) => `<button class="chip ${hvFilter.st === k ? 'on' : ''}" data-st="${k}">${t}</button>`).join('')}</div><div class="list" id="hlist"></div>`;
    sb.bind();
    $$('[data-st]', view).forEach((b) => b.onclick = () => { hvFilter.st = b.dataset.st; $$('[data-st]', view).forEach((x) => x.classList.toggle('on', x === b)); draw(); });
    function draw() {
      const q = fold(hvFilter.q), st = hvFilter.st;
      const list = rs.filter((r) => (st === 'sent' ? r.sent : !r.sent) && (st !== 'late' || r.left < 0) && (st !== 'week' || (r.left >= 0 && r.left <= 7)) && (!q || fold([r.company, r.voen, r.taxType, r.label].join(' ')).includes(q)));
      setTitle('Hesabat vaxtı', `${rs.filter((r) => !r.sent && r.left < 0).length} gecikən · ${rs.filter((r) => !r.sent).length} göndərilməyib`);
      $('#hlist').innerHTML = list.length ? list.slice(0, 400).map((r) => `<div class="item" data-id="${esc(r.id)}"><div class="main"><b>${esc(r.company)}</b><small>${esc(r.taxType)} · ${esc(r.label)}</small><small>Son tarix: ${fmtDate(r.due)}</small></div><div class="side">${r.sent ? '<span class="pill ok">Göndərilib</span>' : `<span class="pill ${r.left < 0 ? 'bad' : r.left <= 3 ? 'warn' : 'info'}">${r.left < 0 ? -r.left + ' gün gecikib' : r.left + ' gün qalıb'}</span>`}</div></div>`).join('') : '<div class="empty">Siyahı boşdur</div>';
      $$('#hlist [data-id]').forEach((el) => el.onclick = () => {
        const r = rs.find((x) => x.id === el.dataset.id);
        sheet(`<h2>${esc(r.company)}</h2><div class="kv"><span>VÖEN</span><b>${esc(r.voen || '—')}</b><span>Hesabat</span><b>${esc(r.taxType)}</b><span>Dövr</span><b>${esc(r.label)}</b><span>Son tarix</span><b>${fmtDate(r.due)}</b></div>
          ${r.sent ? '<p class="muted">Bu dövr «Göndərildi» qeyd olunub. Geri qaytarmaq üçün AMMO SUITE → Hesabat Vaxtı panelindən istifadə edin.</p>' : `<button class="btn ok block" id="markSent">✓ Göndərildi kimi qeyd et</button>`}`, (root) => {
          if ($('#markSent', root)) $('#markSent', root).onclick = async (e) => {
            e.target.disabled = true;
            try {
              const fresh = await suiteKv('hesabat-vaxti'); const cur = fresh.get('periodStatusMap');
              const map = { ...((cur && cur.value) || {}), [r.id]: 'Göndərildi' };
              await suiteKvPut('hesabat-vaxti', (cur && cur.scope) || HV_META.scope || 'chrome', 'periodStatusMap', map);
              r.sent = true; toast('Qeyd olundu — kompüterlərdə ~1 dəqiqəyə görünəcək', 'ok'); closeSheet(); draw();
            } catch (err) { toast(err.message, 'bad'); e.target.disabled = false; }
          };
        });
      });
    }
    draw();
  }

  // ================================================================== BORC XATIRLADICI
  async function loadDebts() {
    return cached('debts', async () => {
      const kv = await suiteKv('borc-xatirlatici');
      const recs = (kv.get('records') || {}).value || [];
      const today = todayISO();
      return (Array.isArray(recs) ? recs : []).map((r) => {
        const ins = Array.isArray(r.installments) && r.installments.length ? r.installments : [{ dueDate: r.dueDate, amount: n0(r.amount), status: r.status === 'paid' ? 'paid' : 'open' }];
        const open = ins.filter((i) => i.status !== 'paid');
        const overdue = open.filter((i) => i.dueDate && String(i.dueDate).slice(0, 10) < today);
        const next = open.map((i) => String(i.dueDate || '')).filter(Boolean).sort()[0] || '';
        return { ...r, ins, open, overdue, next, outstanding: r2(open.reduce((s, i) => s + n0(i.amount), 0)), overdueSum: r2(overdue.reduce((s, i) => s + n0(i.amount), 0)) };
      }).filter((r) => r.open.length);
    });
  }
  let dFilter = 'receivable';
  async function viewDebts(view) {
    const ds = await loadDebts();
    view.innerHTML = `<div class="chips">${[['receivable', 'Alacaqlar'], ['payable', 'Verəcəklər'], ['overdue', 'Gecikənlər']].map(([k, t]) => `<button class="chip ${dFilter === k ? 'on' : ''}" data-st="${k}">${t}</button>`).join('')}</div><div id="dsum"></div><div class="list" id="dlist"></div>`;
    $$('[data-st]', view).forEach((b) => b.onclick = () => { dFilter = b.dataset.st; $$('[data-st]', view).forEach((x) => x.classList.toggle('on', x === b)); draw(); });
    function draw() {
      const list = ds.filter((r) => dFilter === 'overdue' ? r.overdue.length : r.type === dFilter).sort((a, b) => b.overdueSum - a.overdueSum || a.next.localeCompare(b.next));
      const byCur = {}; list.forEach((r) => { const c = r.currency || 'AZN'; byCur[c] = r2((byCur[c] || 0) + r.outstanding); });
      setTitle('Borc xatırladıcı', `${list.length} qeyd`);
      $('#dsum').innerHTML = `<div class="card"><span class="muted small">Qalıq cəmi</span><div style="font-size:20px;font-weight:700">${Object.entries(byCur).map(([c, v]) => money(v, c)).join(' · ') || '0'}</div></div>`;
      $('#dlist').innerHTML = list.length ? list.map((r, i) => `<div class="item" data-i="${i}"><div class="main"><b>${esc(r.person || '—')}</b><small>${esc(r.category || '')}${r.note ? ' · ' + esc(r.note) : ''}</small><small>Növbəti: ${fmtDate(r.next)}</small></div><div class="side"><b>${money(r.outstanding, r.currency || 'AZN')}</b>${r.overdue.length ? `<br><span class="pill bad">${r.overdue.length} gecikib</span>` : ''}</div></div>`).join('') : '<div class="empty">Qeyd yoxdur</div>';
      $$('#dlist [data-i]').forEach((el) => el.onclick = () => { const r = list[+el.dataset.i]; sheet(`<h2>${esc(r.person)}</h2><div class="kv"><span>Növ</span><b>${r.type === 'receivable' ? 'Alacaq' : 'Verəcək'}</b><span>Telefon</span><b>${r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : '—'}</b><span>Qalıq</span><b>${money(r.outstanding, r.currency || 'AZN')}</b></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tarix</th><th class="n">Məbləğ</th><th>Status</th></tr></thead><tbody>${r.ins.map((x) => `<tr><td>${fmtDate(x.dueDate)}</td><td class="n">${money(x.amount, '')}</td><td>${x.status === 'paid' ? '<span class="pill ok">Ödənib</span>' : String(x.dueDate || '').slice(0, 10) < todayISO() ? '<span class="pill bad">Gecikib</span>' : '<span class="pill">Açıq</span>'}</td></tr>`).join('')}</tbody></table></div><p class="muted small">Ödənişi qeyd etmək üçün AMMO SUITE → Borc Xatırladıcı.</p>`); });
    }
    draw();
  }

  // ================================================================== SÜRÜCÜ GƏLİRİ
  async function viewDriver(view) {
    const kv = await cached('drv', () => suiteKv('surucu-gelir'));
    const settings = (kv.get('sgSettings') || {}).value || {};
    const rows = [];
    for (const [k, v] of kv) if (k.startsWith('sgArchive_') && Array.isArray(v.value)) rows.push(...v.value);
    const calc = (r) => {
      const inc = n0(r.income), sv = n0(r.service), ot = n0(r.other);
      if (r.manual) return r2(n0(r.manualNet));
      const cash = r2(inc * n0(r.cashRate ?? settings.cashRate ?? 2) / 100), tax = r2(inc * n0(r.taxRate ?? settings.taxRate ?? 10) / 100);
      return r2(inc - cash - tax - sv - ot);
    };
    const byDate = new Map();
    rows.forEach((r) => { const d = String(r.postingDate || '').slice(0, 10); if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push(r); });
    const dates = [...byDate.keys()].sort().reverse();
    setTitle('Sürücü gəliri', `${dates.length} hesabat · ${rows.length} sətir`);
    view.innerHTML = dates.length ? `<div class="list">${dates.map((d) => { const rs = byDate.get(d); const inc = rs.reduce((s, r) => s + n0(r.income), 0), net = rs.reduce((s, r) => s + calc(r), 0); return `<div class="item" data-d="${d}"><div class="main"><b>${fmtDate(d)}</b><small>${rs.length} sürücü · ${rs.reduce((s, r) => s + n0(r.trips), 0)} reys</small></div><div class="side"><b>${money(inc)}</b><br><span class="muted">Əlinə: ${money(net)}</span></div></div>`; }).join('')}</div>` : '<div class="empty">Arxiv boşdur</div>';
    $$('[data-d]', view).forEach((el) => el.onclick = () => {
      const rs = byDate.get(el.dataset.d).slice().sort((a, b) => n0(b.income) - n0(a.income));
      const inc = rs.reduce((s, r) => s + n0(r.income), 0);
      sheet(`<h2>Hesabat ${fmtDate(el.dataset.d)}</h2><div class="kv"><span>Gəlirlər</span><b>${money(inc)}</b><span>10% gəlir vergisi</span><b>${money(inc * n0(settings.taxRate ?? 10) / 100)}</b><span>Əlinə çatan</span><b>${money(rs.reduce((s, r) => s + calc(r), 0))}</b></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Sürücü</th><th class="n">Reys</th><th class="n">Gəlir</th><th class="n">Əlinə</th></tr></thead><tbody>${rs.map((r) => `<tr><td>${esc(r.driverName || '—')}<div class="small muted">${esc((r.plates || []).join(', '))}</div></td><td class="n">${n0(r.trips)}</td><td class="n">${money(r.income, '')}</td><td class="n">${money(calc(r), '')}</td></tr>`).join('')}</tbody></table></div>`);
    });
  }

  // ================================================================== SƏNƏD DÖVRİYYƏSİ (AMMO arxivi)
  let docQ = '';
  async function viewDocs(view) {
    const [docsMap, subjMap] = await cached('dd', () => Promise.all([ammoKvAll('ammoDD_docs'), ammoKvAll('ammoDD_subjects').catch(() => new Map())]), 300000);
    const subjects = new Map([...subjMap.values()].map((x) => [x.value && x.value.id, x.value]));
    const docs = [...docsMap.values()].map((x) => x.value).filter((d) => d && !d.deleted).sort((a, b) => String(b.date || b.createdAt || '').localeCompare(String(a.date || a.createdAt || '')));
    const sb = searchBox('Başlıq, nömrə, kontragent, VÖEN…', (q) => { docQ = q; draw(); }, docQ);
    view.innerHTML = `${sb.html}<div class="list" id="dd"></div>`; sb.bind();
    function draw() {
      const q = fold(docQ);
      const list = docs.filter((d) => { if (!q) return true; const s = subjects.get(d.subj) || {}; return fold([d.title, d.number, d.regNo, d.cp && d.cp.name, d.cp && d.cp.voen, d.person, s.name, s.voen, d.note, (d.tags || []).join(' ')].join(' ')).includes(q); });
      setTitle('Sənəd dövriyyəsi', `${list.length} sənəd`);
      $('#dd').innerHTML = list.length ? list.slice(0, 200).map((d, i) => { const s = subjects.get(d.subj) || {}; return `<div class="item" data-i="${i}"><span style="font-size:20px">${d.direction === 'in' ? '📥' : d.direction === 'out' ? '📤' : '📄'}</span><div class="main"><b>${esc(d.title || d.number || '—')}</b><small>${esc(s.name || '')}${d.cp && d.cp.name ? ' ↔ ' + esc(d.cp.name) : ''}</small><small>${fmtDate(d.date)}${d.number ? ' · №' + esc(d.number) : ''}${d.expiry ? ' · bitir ' + fmtDate(d.expiry) : ''}</small></div><div class="side">${d.amount ? money(d.amount, d.currency || '₼') : ''}</div></div>`; }).join('') + (list.length > 200 ? '<div class="empty small">İlk 200 göstərilir — axtarışla daraldın</div>' : '') : '<div class="empty">Sənəd tapılmadı</div>';
      $$('#dd [data-i]').forEach((el) => el.onclick = () => {
        const d = list[+el.dataset.i], s = subjects.get(d.subj) || {};
        sheet(`<h2>${esc(d.title || '—')}</h2><div class="kv"><span>Subyekt</span><b>${esc(s.name || '—')}</b><span>Kontragent</span><b>${esc((d.cp && d.cp.name) || d.person || '—')} ${d.cp && d.cp.voen ? '(' + esc(d.cp.voen) + ')' : ''}</b><span>Tarix</span><b>${fmtDate(d.date)}</b><span>Nömrə</span><b>${esc(d.number || d.regNo || '—')}</b>${d.amount ? `<span>Məbləğ</span><b>${money(d.amount, d.currency || '₼')}</b>` : ''}${d.expiry ? `<span>Bitmə</span><b>${fmtDate(d.expiry)}</b>` : ''}</div>${d.note ? `<div class="card" style="white-space:pre-wrap">${esc(d.note)}</div>` : ''}
          ${(d.files || []).length ? `<div class="sec-title">Fayllar</div><div class="list">${d.files.map((f, i) => `<div class="item" data-f="${i}"><span>📎</span><div class="main"><b>${esc(f.name || 'fayl')}</b><small>${f.size ? Math.round(f.size / 1024) + ' KB' : ''}</small></div><span class="muted">Aç</span></div>`).join('')}</div>` : ''}`, (root) => {
          $$('[data-f]', root).forEach((x) => x.onclick = async () => {
            const f = d.files[+x.dataset.f];
            try { toast('Fayl yüklənir…'); const v = await ammoKvGet('ammoDD_files', f.id); if (!v || !v.b64) throw new Error(v && v.tooBig ? 'Fayl 25 MB-dan böyükdür — yalnız kompüterdə' : 'Fayl buludda tapılmadı'); openB64(v.b64, v.mime || f.mime, v.name || f.name); }
            catch (e) { toast(e.message, 'bad'); }
          });
        });
      });
    }
    draw();
  }

  // ================================================================== UZAQDAN ƏMRLƏR
  const OPS = {
    profile: { t: 'Kabinet məlumatı', d: 'Şirkət profili, öhdəliklər, bank hesabları' },
    debts: { t: 'Borclar (şəxsi hesab)', d: 'Vergi və sosial öhdəliklər, artıq ödəmə' },
    mail: { t: 'Kabinetdəki məktublar', d: 'Oxunmamış və son məktublar' },
    declarations: { t: 'Bəyannamələr', d: 'Seçilmiş il üzrə status, növ, məbləğ', year: true },
    cash804: { t: 'Daxil olan pullar (804)', d: 'Rüblər üzrə bank+POS daxilolmaları', year: true },
    audit: { t: 'Tam audit (mal qalığı, gəlir-xərc)', d: 'Qaimələr, mal qalığı, 804, çatışmayan bəyannamələr — böyük şirkətdə bir neçə dəqiqə', year: true },
  };
  const C_STATUS = { new: ['Gözləyir', 'info'], running: ['İcra olunur', 'warn'], done: ['Hazırdır', 'ok'], error: ['Xəta', 'bad'] };
  async function loadAgents() {
    const kv = await ammoKvAll('ammoRemoteAgents');
    return [...kv.values()].map((x) => x.value).filter((a) => a && a.at && Date.now() - new Date(a.at).getTime() < 3 * 86400000)
      .map((a) => ({ ...a, fresh: Date.now() - new Date(a.at).getTime() < 5 * 60000 })).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }
  async function loadCommands() {
    return fs.query({ from: [{ collectionId: 'remoteCommands' }], orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }], limit: 40 });
  }
  async function viewRemote(view) {
    const [cs, agents, cmds] = await Promise.all([companies().catch(() => []), loadAgents().catch(() => []), loadCommands().catch((e) => { if (/İcazə/.test(e.message)) throw new Error('remoteCommands üçün Firestore qaydası əlavə edilməyib — təlimatdakı qaydaları yayımlayın.'); throw e; })]);
    const online = agents.filter((a) => a.fresh);
    const openTins = new Map(); online.forEach((a) => (a.tabs || []).forEach((t) => openTins.set(String(t.tin), t.name || t.tin)));
    const y = new Date().getFullYear();
    view.innerHTML = `<div class="card"><h3>Yeni əmr</h3>
        <label>Şirkət (VÖEN)<select id="rTin"><option value="">— kabineti açıq olan istənilən şirkət —</option>
          ${openTins.size ? `<optgroup label="🟢 İndi açıqdır">${[...openTins].map(([tin, name]) => `<option value="${esc(tin)}">${esc(name)} · ${esc(tin)}</option>`).join('')}</optgroup>` : ''}
          <optgroup label="Bütün şirkətlər">${cs.filter((c) => c.voen).map((c) => `<option value="${esc(c.voen)}">${esc(c.name)} · ${esc(c.voen)}</option>`).join('')}</optgroup></select></label>
        <label>Əməliyyat<select id="rOp">${Object.entries(OPS).map(([k, o]) => `<option value="${k}">${esc(o.t)}</option>`).join('')}</select></label>
        <p class="muted small" id="rOpD"></p>
        <label id="rYearL">İl<select id="rYear">${[y, y - 1, y - 2, y - 3].map((x) => `<option>${x}</option>`).join('')}</select></label>
        <button class="btn primary block" id="rSend">Göndər</button>
        <p class="muted small" style="margin:10px 0 0">${online.length ? `🟢 ${online.length} kompüter hazırdır: ${online.map((a) => esc(a.email)).join(', ')}` : '⚪ Hazırda ofisdə e-taxes açıq olan kompüter yoxdur — əmr növbədə qalacaq və kabinet açılan kimi icra olunacaq.'}</p>
      </div>
      <div class="sec-title">Son əmrlər</div><div class="list" id="clist"></div>`;
    const opSel = $('#rOp');
    const syncOp = () => { const o = OPS[opSel.value]; $('#rOpD').textContent = o.d; $('#rYearL').classList.toggle('hidden', !o.year); };
    opSel.onchange = syncOp; syncOp();
    $('#rSend').onclick = async (e) => {
      const op = opSel.value, tin = $('#rTin').value, year = +$('#rYear').value;
      const name = (cs.find((c) => String(c.voen) === tin) || {}).name || openTins.get(tin) || '';
      const params = OPS[op].year ? { year } : {};
      e.target.disabled = true;
      try {
        const id = `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        await fs.create('remoteCommands', id, { op, params, target: { tin, name }, status: 'new', createdBy: AUTH.email, createdAt: new Date(), progress: '' });
        await bumpAmmo('remote');
        toast('Əmr göndərildi', 'ok'); go('remote');
      } catch (err) { toast(err.message, 'bad'); e.target.disabled = false; }
    };
    const drawList = (list) => {
      $('#clist').innerHTML = list.length ? list.map((c) => { const [sn, sc] = C_STATUS[c.status] || [c.status, '']; return `<div class="item" data-id="${esc(c.id)}"><div class="main"><b>${esc((OPS[c.op] || {}).t || c.op)}${c.params && c.params.year ? ' · ' + c.params.year : ''}</b><small>${esc((c.target && (c.target.name || c.target.tin)) || 'istənilən kabinet')}</small><small>${fmtDate(c.createdAt, true)}${c.status === 'running' && c.progress ? ' · ' + esc(c.progress) : ''}</small></div><div class="side"><span class="pill ${sc}">${esc(sn)}</span></div></div>`; }).join('') : '<div class="empty">Hələ əmr yoxdur</div>';
      $$('#clist [data-id]').forEach((el) => el.onclick = () => commandSheet(list.find((c) => c.id === el.dataset.id)));
    };
    drawList(cmds);
    // gözləyən əmr varsa hər 8 saniyədə yenilə
    let alive = true; stopTimers.push(() => { alive = false; });
    const tick = async () => {
      if (!alive) return;
      const list = await loadCommands().catch(() => null);
      if (!alive || !list) return;
      drawList(list);
      if (list.some((c) => c.status === 'new' || c.status === 'running')) setTimeout(tick, 8000);
    };
    if (cmds.some((c) => c.status === 'new' || c.status === 'running')) setTimeout(tick, 8000);
  }
  function commandSheet(c) {
    const [sn, sc] = C_STATUS[c.status] || [c.status, ''];
    let res = null; try { res = c.result ? JSON.parse(c.result) : null; } catch (e) { res = null; }
    sheet(`<h2>${esc((OPS[c.op] || {}).t || c.op)}</h2><span class="pill ${sc}">${esc(sn)}</span>
      <div class="kv"><span>Şirkət</span><b>${esc((c.target && (c.target.name || c.target.tin)) || 'istənilən')}</b><span>Göndərilib</span><b>${fmtDate(c.createdAt, true)}</b>${c.runner ? `<span>İcra edən</span><b>${esc(c.runner.email || '')} · ${esc(c.runner.device || '')}</b>` : ''}${c.finishedAt ? `<span>Bitib</span><b>${fmtDate(c.finishedAt, true)}</b>` : ''}</div>
      ${c.status === 'running' && c.progress ? `<div class="card">⏳ ${esc(c.progress)}</div>` : ''}
      ${c.error ? `<div class="card" style="color:var(--bad)">⚠ ${esc(c.error)}</div>` : ''}
      ${res ? renderResult(c.op, res) : ''}
      ${c.status === 'running' && Date.now() - new Date(c.startedAt || c.createdAt).getTime() > 20 * 60000 ? '<p class="muted small">20 dəqiqədən çoxdur icra olunur — ola bilsin kompüter bağlanıb. «Təkrarla» ilə yenidən göndərin.</p>' : ''}
      <div class="row" style="margin-top:14px">${c.status !== 'running' || Date.now() - new Date(c.startedAt || c.createdAt).getTime() > 20 * 60000 ? `<button class="btn grow" id="cRepeat">↻ Təkrarla</button>` : ''}<button class="btn danger grow" id="cDel">Sil</button></div>`, (root) => {
      if ($('#cRepeat', root)) $('#cRepeat', root).onclick = async () => {
        try { const id = `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; await fs.create('remoteCommands', id, { op: c.op, params: c.params || {}, target: c.target || { tin: '' }, status: 'new', createdBy: AUTH.email, createdAt: new Date(), progress: '' }); await bumpAmmo('remote'); closeSheet(); go('remote'); toast('Yenidən göndərildi', 'ok'); } catch (e) { toast(e.message, 'bad'); }
      };
      $('#cDel', root).onclick = async () => { try { await fs.del(`remoteCommands/${c.id}`); closeSheet(); go('remote'); } catch (e) { toast(e.message, 'bad'); } };
    });
  }
  const tbl = (head, rows) => `<div class="tbl-wrap"><table class="tbl"><thead><tr>${head.map((h) => `<th class="${h.startsWith('#') ? 'n' : ''}">${esc(h.replace(/^#/, ''))}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v, i) => `<td class="${head[i].startsWith('#') ? 'n' : ''}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  function renderResult(op, r) {
    const head = r.company || r.tin ? `<div class="card"><b>${esc(r.company || '')}</b> <span class="muted">${esc(r.tin || '')}</span></div>` : '';
    if (op === 'profile') {
      const m = r.main || {};
      const LBL = { companyName: 'Ad', individualName: 'Ad', tin: 'VÖEN', taxpayerRegistrationDate: 'Uçota alınıb', legalAddress: 'Hüquqi ünvan', actualAddress: 'Faktiki ünvan', taxAuthorityName: 'Vergi orqanı', legalForm: 'Hüquqi forma', activityStatus: 'Fəaliyyət', vatPayer: 'ƏDV ödəyicisi' };
      const nice = (k) => LBL[k] || k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
      const lines = (arr) => arr.map((o) => `<div class="item" style="cursor:default"><div class="main"><small style="color:var(--ink)">${Object.values(o).map((v) => esc(v)).join(' · ')}</small></div></div>`).join('');
      const block = (title, arr) => (arr || []).length ? `<div class="sec-title">${title} (${arr.length})</div><div class="list">${lines(arr)}</div>` : '';
      return head + `<div class="kv">${Object.entries(m).map(([k, v]) => `<span>${esc(nice(k))}</span><b>${esc(v)}</b>`).join('')}</div>
        ${block('Öhdəliklər', r.obligations)}${block('Bank hesabları', r.banks)}${block('Lisenziyalar', r.licenses)}${block('Filiallar', r.branches)}${block('Obyektlər', r.objects)}${block('Kassa aparatları', r.cash)}${block('POS terminallar', r.pos)}
        ${Object.keys(r.errors || {}).length ? `<p class="muted small">Oxunmayan bölmələr: ${esc(Object.entries(r.errors).map(([k, v]) => k + ' — ' + v).join('; '))}</p>` : ''}`;
    }
    if (op === 'debts') {
      const t = r.totals || {};
      return head + `<div class="grid2"><div class="kpi ${t.debt ? 'bad' : 'ok'}"><span>Borc cəmi</span><b style="font-size:18px">${money(t.debt)}</b><small>əsas ${money(t.principal)}</small></div><div class="kpi ok"><span>Artıq ödəmə</span><b style="font-size:18px">${money(t.overpay)}</b><small>${esc(r.asOf ? 'tarix: ' + fmtDate(r.asOf) : '')}</small></div></div>
        ${(r.tax || []).length ? tbl(['Vergi', '#Borc', '#Artıq'], r.tax.map((x) => [esc(x.name || x.code), money(x.total, ''), money(x.overpay, '')])) : '<p class="muted">Vergi borcu yoxdur</p>'}
        ${(r.social || []).length ? `<div class="sec-title">Sosial</div>${tbl(['Növ', '#Ödənilməli'], r.social.map((x) => [esc(x.name), money(x.toPay, '')]))}` : ''}`;
    }
    if (op === 'mail') return head + `<div class="card">Oxunmamış: <b>${n0(r.unread)}</b> · cəmi ${n0(r.total)}</div>` + tbl(['Tarix', 'Mövzu'], (r.list || []).slice(0, 60).map((m) => [fmtDate(m.date), `${m.read ? '' : '🔵 '}${esc(m.subject)}${m.deadline ? `<div class="small" style="color:var(--bad)">Son tarix: ${fmtDate(m.deadline)}</div>` : ''}`]));
    if (op === 'declarations') return head + tbl(['Vergi', 'Dövr', 'Status', '#Məbləğ'], (r.list || []).map((d) => [esc(d.tax), esc(d.ptype === 'MONTH' ? pad(d.month) + '.' + d.year : d.ptype === 'QUARTER' ? Math.ceil(d.month / 3) + '-rüb ' + d.year : d.year), `${esc(d.statusName)}${d.how ? ' · ' + esc(d.how) : ''}${d.violation ? ' <span class="pill bad">uyğunsuzluq</span>' : ''}`, d.amount != null ? money(d.amount, '') : '']));
    if (op === 'cash804') return head + tbl(['Rüb', '#804', 'Mənbə'], (r.list || []).map((x) => [`${x.q}-rüb ${x.year}`, x.v804 == null ? '—' : money(x.v804, ''), esc({ filed: 'bəyannamə', draft: 'qaralama', auto: 'avtomatik', none: '—', error: 'xəta: ' + (x.error || '') }[x.src] || x.src)])) + (r.notes || []).map((n) => `<p class="muted small">${esc(n)}</p>`).join('');
    if (op === 'audit') {
      const a = r.audit || {}, inc = a.income || {};
      return head + `<p class="muted small">Dövr: ${fmtDate(r.period && r.period.fromISO)} – ${fmtDate(r.period && r.period.toISO)}</p>
        <div class="grid2"><div class="kpi"><span>Gəlir</span><b style="font-size:17px">${money(inc.total)}</b><small>${n0(inc.count)} qaimə</small></div><div class="kpi"><span>Xərc</span><b style="font-size:17px">${money(a.expenseTotal)}</b></div>
        <div class="kpi ${n0(a.profit) < 0 ? 'bad' : 'ok'}"><span>Mənfəət</span><b style="font-size:17px">${money(a.profit)}</b><small>vergi (20%) ${money(a.tax)}</small></div><div class="kpi"><span>Mal qalığı (dəyər)</span><b style="font-size:17px">${money(r.stockValue)}</b><small>${n0(r.stockCount)} mal kodu</small></div></div>
        ${r.debts && r.debts.totals ? `<div class="card">Borc: <b>${money(r.debts.totals.debt)}</b> · Artıq ödəmə: <b>${money(r.debts.totals.overpay)}</b> · Oxunmamış məktub: <b>${n0(r.mailUnread)}</b></div>` : ''}
        ${(r.missing || []).length ? `<div class="sec-title">Təqdim edilməmiş bəyannamələr</div>${tbl(['Vergi', 'Dövr', 'Vəziyyət'], r.missing.map((m) => [esc(m.tax), esc(m.period), `<span class="pill ${m.state === 'missing' || m.state === 'draftLate' ? 'bad' : 'warn'}">${esc({ missing: 'verilməyib', draftLate: 'qaralama (gecikib)', draft: 'qaralama', due: 'vaxtı çatmayıb', unknown: 'naməlum' }[m.state] || m.state)}</span>`]))}` : ''}
        ${(r.stock || []).length ? `<div class="sec-title">Mal qalığı — ən böyük ${r.stock.length}</div>${tbl(['Mal', '#Qalıq', '#Dəyər'], r.stock.map((s) => [`${esc(s.name)}<div class="small muted">${esc(s.code || '')}</div>`, `${n0(s.rest).toLocaleString('az-AZ')} ${esc(s.unit || '')}`, money(s.restV, '')]))}` : ''}
        ${(r.cash || []).length ? `<div class="sec-title">Daxil olan pullar (804)</div>${tbl(['Rüb', '#Məbləğ'], r.cash.map((x) => [`${x.q}-rüb ${x.year}`, x.v804 == null ? '—' : money(x.v804, '')]))}` : ''}
        ${(r.notes || []).map((n) => `<p class="muted small">${esc(n)}</p>`).join('')}`;
    }
    return `<pre class="res">${esc(JSON.stringify(r, null, 2).slice(0, 20000))}</pre>`;
  }

  // ================================================================== İDARƏETMƏ (yalnız admin)
  const AMMO_PANELS = [
    ['invoices', 'Elektron Qaimələr'], ['returns', 'Qaimələrin Qaytarılması'], ['acts', 'Aktlar'], ['declarations', 'Bəyannamələr'], ['hftta', 'HF və TTA'],
    ['subaccount', 'Sub-uçot Köçürmələr'], ['quicksubmit', 'Sürətli təqdim etmə'], ['audit', 'İlkin audit'], ['bank', 'Bank Çıxarışı'], ['evez', 'ƏDV Əvəzləşməsi'],
    ['edv', 'ƏDV Analiz'], ['sened', 'Sənəd hazırla'], ['dovriyye', 'Sənəd dövriyyəsi'], ['social', 'Sosial şəbəkə analizi'], ['links', 'Linklər'],
    ['taxrep_profit', 'Mənfəət hesabatı'], ['taxrep_income', 'Gəlir hesabatı'],
  ];
  let adminTab = 'suite';
  async function viewAdmin(view) {
    if (!isAdmin()) throw new Error('Yalnız admin üçündür');
    view.innerHTML = `<div class="chips">${[['suite', 'SUITE panelləri'], ['ammo', 'AMMO panelləri'], ['users', 'İstifadəçilər'], ['devices', 'Cihazlar'], ['update', 'Yeniləmə']].map(([k, t]) => `<button class="chip ${adminTab === k ? 'on' : ''}" data-t="${k}">${t}</button>`).join('')}</div><div id="adm"><div class="loading"><div class="spinner"></div></div></div>`;
    $$('[data-t]', view).forEach((b) => b.onclick = () => { adminTab = b.dataset.t; go('admin'); });
    const el = $('#adm');
    if (adminTab === 'suite') return adminSuitePanels(el);
    if (adminTab === 'ammo') return adminAmmoPanels(el);
    if (adminTab === 'users') return adminUsers(el);
    if (adminTab === 'devices') return adminDevices(el);
    return adminUpdate(el);
  }
  async function adminSuitePanels(el) {
    const mods = (await fs.list('suiteModules')).sort((a, b) => n0(a.order) - n0(b.order));
    setTitle('İdarəetmə', 'AMMO SUITE panelləri — bütün kompüterlər');
    el.innerHTML = `<p class="muted small">Açarı bağlayanda panel bütün işçilərdə ~5 saniyəyə yox olur.</p><div class="list">${mods.map((m) => `<div class="item" style="cursor:default"><span style="font-size:20px">${esc(m.icon || '◻')}</span><div class="main"><b>${esc(m.title || m.id)}</b><small>${(m.allowedEmails || []).length ? 'Yalnız: ' + esc(m.allowedEmails.join(', ')) : 'Hamı görür'}</small></div><label class="sw"><input type="checkbox" data-mod="${esc(m.id)}" ${m.enabled !== false ? 'checked' : ''}><i></i></label></div>`).join('')}</div>`;
    $$('[data-mod]', el).forEach((x) => x.onchange = async () => {
      try { await fs.merge(`suiteModules/${encodeURIComponent(x.dataset.mod)}`, { enabled: x.checked }); await bumpSuite('suiteModules'); toast(x.checked ? 'Panel açıldı' : 'Panel bağlandı', 'ok'); }
      catch (e) { x.checked = !x.checked; toast(e.message, 'bad'); }
    });
  }
  async function getAmmoConf() {
    let d = null; try { d = await fs.get('ammoVergiConfig/main'); } catch (e) { if (e.status !== 403) throw e; }
    if (!d || !d.json) d = await fs.get('suiteSharedV3/ammoVergiAdmin').catch(() => null);
    let c = {}; try { c = d && d.json ? JSON.parse(d.json) : {}; } catch (e) { c = {}; }
    return { panels: {}, update: {}, social: {}, ...c };
  }
  async function saveAmmoConf(conf) {
    const clean = { ...conf }; delete clean._at; delete clean._where;
    clean.updatedAt = new Date().toISOString(); clean.updatedBy = AUTH.email;
    const body = { json: JSON.stringify(clean), updatedAt: new Date(), updatedBy: AUTH.email };
    try { await fs.set('ammoVergiConfig/main', body); } catch (e) { if (e.status !== 403) throw e; }
    await fs.set('suiteSharedV3/ammoVergiAdmin', body);
    await bumpAmmo('config');
  }
  async function adminAmmoPanels(el) {
    const conf = await getAmmoConf();
    setTitle('İdarəetmə', 'AMMO (Vergi) panelləri — bütün kompüterlər');
    el.innerHTML = `<p class="muted small">Dəyişikliklər bütün kompüterlərə ~1 dəqiqəyə tətbiq olunur. Admin hər şeyi görür.</p><div class="list">${AMMO_PANELS.map(([id, name]) => { const p = conf.panels[id] || {}; return `<div class="item" style="cursor:default"><div class="main"><b>${esc(name)}</b><small>${p.off ? 'Bağlıdır' : (p.emails || []).length ? 'Yalnız: ' + esc(p.emails.join(', ')) : 'Hamı görür'}</small></div><label class="sw"><input type="checkbox" data-p="${id}" ${p.off ? '' : 'checked'}><i></i></label></div>`; }).join('')}</div>`;
    $$('[data-p]', el).forEach((x) => x.onchange = async () => {
      try { const c = await getAmmoConf(); c.panels = c.panels || {}; c.panels[x.dataset.p] = { ...(c.panels[x.dataset.p] || {}), off: !x.checked }; await saveAmmoConf(c); toast(x.checked ? 'Panel açıldı' : 'Panel bağlandı', 'ok'); }
      catch (e) { x.checked = !x.checked; toast(e.message, 'bad'); }
    });
  }
  async function adminUsers(el) {
    dropCache('users');
    const us = (await users()).sort((a, b) => String(a.loginEmail || a.email).localeCompare(String(b.loginEmail || b.email)));
    setTitle('İdarəetmə', `İstifadəçilər · ${us.length}`);
    el.innerHTML = `<p class="muted small">Açarı bağlamaq işçini dayandırır — AMMO SUITE və AMMO-da məlumata girişi kəsilir.</p><div class="list">${us.map((u) => { const em = String(u.loginEmail || u.email || '').toLowerCase(); const adm = u.role === 'admin' || ADMIN_EMAILS.includes(em); return `<div class="item" style="cursor:default"><div class="main"><b>${esc(u.name)}</b><small>${esc(em)} · ${adm ? 'admin' : 'işçi'}</small></div><label class="sw"><input type="checkbox" data-u="${esc(u.id)}" ${u.active ? 'checked' : ''} ${adm ? 'disabled' : ''}><i></i></label></div>`; }).join('')}</div>`;
    $$('[data-u]', el).forEach((x) => x.onchange = async () => {
      try { await fs.merge(`users/${encodeURIComponent(x.dataset.u)}`, { active: x.checked }); dropCache('users'); toast(x.checked ? 'Aktiv edildi' : 'Dayandırıldı', 'ok'); }
      catch (e) { x.checked = !x.checked; toast(e.message, 'bad'); }
    });
  }
  async function latestSuiteVersion() {
    try { const r = await fetch('https://memmed91.github.io/ammo-suite-update/update.json', { cache: 'no-store' }); if (r.ok) return (await r.json()).version || ''; } catch (e) { /* */ }
    return '';
  }
  async function adminDevices(el) {
    const [devs, ammoDevs, latest] = await Promise.all([fs.list('devices'), ammoKvAll('ammoVergiDevices').catch(() => new Map()), latestSuiteVersion()]);
    setTitle('İdarəetmə', 'Cihazlar və versiyalar');
    const ad = [...ammoDevs.values()].map((x) => x.value).filter(Boolean).sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));
    el.innerHTML = `<div class="sec-title">AMMO SUITE ${latest ? `· serverdə ${esc(latest)}` : ''}</div><div class="list">${devs.sort((a, b) => String(a.email).localeCompare(String(b.email))).map((d) => `<div class="item" style="cursor:default"><div class="main"><b>${esc(d.email || d.id)}</b><small>${esc(d.deviceLabel || '—')} · ${esc(ago(d.lastSeenAt))}</small><small><span class="pill ${latest && d.appVersion && d.appVersion !== latest ? 'warn' : 'ok'}">${esc(d.appVersion || '—')}</span> ${d.deviceId ? '🔒 bağlıdır' : 'boşdur'}</small></div><div class="side">${d.deviceId ? `<button class="btn sm" data-reset="${esc(d.id)}" data-email="${esc(d.email)}">Sıfırla</button>` : ''}</div></div>`).join('') || '<div class="empty">Cihaz yoxdur</div>'}</div>
      <div class="sec-title">AMMO (Vergi)</div><div class="list">${ad.map((d) => `<div class="item" style="cursor:default"><div class="main"><b>${esc(d.email)}</b><small>${esc(d.device || '—')} · ${esc(ago(d.lastSeen))}</small></div><div class="side"><span class="pill">${esc(d.version || '—')}</span></div></div>`).join('') || '<div class="empty">Cihaz yoxdur</div>'}</div>`;
    $$('[data-reset]', el).forEach((b) => b.onclick = async () => {
      if (!confirm(`${b.dataset.email} — cihaz bağlantısı silinsin? Növbəti dəfə hansı kompüterdə daxil olsa, ona bağlanacaq.`)) return;
      try { await fs.merge(`devices/${encodeURIComponent(b.dataset.reset)}`, { deviceId: '' }); toast('Cihaz sıfırlandı', 'ok'); go('admin'); } catch (e) { toast(e.message, 'bad'); }
    });
  }
  async function adminUpdate(el) {
    const [devs, acc, conf] = await Promise.all([fs.list('devices').catch(() => []), fs.list('updateAccess').catch(() => []), getAmmoConf()]);
    const accMap = new Map(acc.map((a) => [a.id, a.updateable !== false]));
    const emails = [...new Set(devs.map((d) => String(d.email || '').toLowerCase()).filter(Boolean).concat(acc.map((a) => a.id)))].sort();
    const blocked = new Set((conf.update.blocked || []).map((x) => String(x).toLowerCase()));
    const ammoEmails = [...new Set(emails.concat([...blocked]))].sort();
    setTitle('İdarəetmə', 'Yeniləməni bloklamaq');
    el.innerHTML = `<div class="sec-title">AMMO SUITE — yeniləmə icazəsi</div><div class="list">${emails.map((e) => `<div class="item" style="cursor:default"><div class="main"><b>${esc(e)}</b><small>${accMap.get(e) === false ? 'Yeniləmə bağlıdır' : 'Yeniləmə alır'}</small></div><label class="sw"><input type="checkbox" data-acc="${esc(e)}" ${accMap.get(e) === false ? '' : 'checked'}><i></i></label></div>`).join('') || '<div class="empty">—</div>'}</div>
      <div class="sec-title">AMMO (Vergi) — yeniləmə icazəsi</div><div class="list">${ammoEmails.map((e) => `<div class="item" style="cursor:default"><div class="main"><b>${esc(e)}</b><small>${blocked.has(e) ? 'Yeniləmə bağlıdır' : 'Yeniləmə alır'}</small></div><label class="sw"><input type="checkbox" data-blk="${esc(e)}" ${blocked.has(e) ? '' : 'checked'}><i></i></label></div>`).join('') || '<div class="empty">—</div>'}</div>
      <div class="card"><label style="display:flex;gap:10px;align-items:center;margin:0"><input type="checkbox" id="autoApply" style="width:auto;margin:0" ${conf.update.autoApply === false ? '' : 'checked'}> AMMO: yeni versiyanı avtomatik quraşdır</label></div>`;
    $$('[data-acc]', el).forEach((x) => x.onchange = async () => {
      try { await fs.set(`updateAccess/${encodeURIComponent(x.dataset.acc)}`, { updateable: x.checked, changedAt: new Date() }); toast(x.checked ? 'Yeniləmə açıldı' : 'Yeniləmə bağlandı', 'ok'); }
      catch (e) { x.checked = !x.checked; toast(e.message, 'bad'); }
    });
    $$('[data-blk]', el).forEach((x) => x.onchange = async () => {
      try { const c = await getAmmoConf(); const s = new Set((c.update.blocked || []).map((v) => String(v).toLowerCase())); x.checked ? s.delete(x.dataset.blk) : s.add(x.dataset.blk); c.update = { ...c.update, blocked: [...s] }; await saveAmmoConf(c); toast(x.checked ? 'Yeniləmə açıldı' : 'Yeniləmə bağlandı', 'ok'); }
      catch (e) { x.checked = !x.checked; toast(e.message, 'bad'); }
    });
    $('#autoApply').onchange = async (e) => {
      try { const c = await getAmmoConf(); c.update = { ...c.update, autoApply: e.target.checked }; await saveAmmoConf(c); toast('Yadda saxlanıldı', 'ok'); } catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'bad'); }
    };
  }

  // ================================================================== DAHA ÇOX
  async function viewMore(view) {
    setTitle('Daha çox', AUTH.email);
    const ids = Object.keys(SECTIONS).filter((id) => !['more'].includes(id) && allowed(id) && !tabsFor().includes(id));
    view.innerHTML = `<div class="list">${ids.map((id) => `<div class="item" data-go="${id}"><span style="font-size:20px">${SECTIONS[id].icon}</span><div class="main"><b>${esc(SECTIONS[id].title)}</b></div><span class="muted">›</span></div>`).join('')}</div>
      <div class="list"><div class="item" id="logout"><span style="font-size:20px">🚪</span><div class="main"><b>Çıxış</b><small>${esc(AUTH.email)}</small></div></div></div>
      <p class="muted small" style="text-align:center">AMMO Mobil ${VERSION} · ${esc(FB.projectId)}</p>`;
    $$('[data-go]', view).forEach((b) => b.onclick = () => go(b.dataset.go));
    $('#logout').onclick = () => { if (confirm('Çıxış edilsin?')) { saveAuth(null); ME = null; CACHE.clear(); showLogin(); } };
  }

  // ================================================================== başlanğıc
  function showLogin(msg) {
    $('#boot').classList.add('hidden'); $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
    $('#loginMsg').textContent = msg || '';
    try { $('#loginEmail').value = localStorage.getItem('ammoMobLastEmail') || ''; } catch (e) { /* */ }
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn'); btn.disabled = true; $('#loginMsg').textContent = '';
    const email = $('#loginEmail').value.trim().toLowerCase();
    try { await signIn(email, $('#loginPass').value); try { localStorage.setItem('ammoMobLastEmail', email); } catch (err) { /* */ } $('#loginPass').value = ''; await start(); }
    catch (err) { $('#loginMsg').textContent = err.message; }
    finally { btn.disabled = false; }
  });
  async function start() {
    AUTH = AUTH || loadAuth();
    if (!AUTH) return showLogin();
    try {
      const p = await fs.get(`users/${AUTH.uid}`);
      const adminEmail = ADMIN_EMAILS.includes(AUTH.email);
      if (!p && !adminEmail) { saveAuth(null); return showLogin('Bu hesabın AMMO profili yoxdur. Əvvəlcə AMMO SUITE-ə daxil olun.'); }
      ME = { ...(p || {}), name: (p && (p.name || p.displayName)) || AUTH.email.split('@')[0], role: (p && p.role) || (adminEmail ? 'admin' : 'employee') };
      if (!adminEmail && p.active !== true) { saveAuth(null); return showLogin('Hesab aktiv deyil — admin aktivləşdirməlidir.'); }
    } catch (e) {
      if (e.status === 401) return showLogin('Sessiya bitib — yenidən daxil olun');
      $('#boot').classList.add('hidden');
      $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
      $('#view').innerHTML = `<div class="card"><h3>⚠ Bağlantı yoxdur</h3><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Yenidən</button></div>`;
      return;
    }
    $('#boot').classList.add('hidden'); $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
    const want = (location.hash || '').slice(1);
    go(SECTIONS[want] ? want : (isAdmin() ? 'home' : tabsFor()[0]));
  }
  window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (ME && SECTIONS[id] && id !== current) go(id, { noHash: true }); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ME && ['home', 'tasks', 'remote'].includes(current) && $('#sheet').classList.contains('hidden')) { dropCache('tasks'); go(current, { noHash: true }); } });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  start();

  // test üçün
  window.__AMMO_MOBIL__ = { fs, hvOccurrences, renderResult, version: VERSION, uid };
})();
