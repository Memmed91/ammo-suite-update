/* AMMO Mobil — Chrome genişlənmə API-lərinin brauzer əvəzi.
 * AMMO SUITE panelləri (modules/*) telefonda adi veb səhifə kimi açılır; onlar chrome.storage və
 * chrome.runtime gözləyir. Bu fayl həmin API-ləri təqlid edir:
 *   • chrome.storage.local → IndexedDB (telefonda qalır) + cloud-sync.js vasitəsilə Firebase ilə eyni
 *   • suiteAuth → AMMO Mobil girişi (localStorage: ammoMobAuth) — ayrıca giriş lazım deyil
 *   • tabs.create / downloads → yeni pəncərə / fayl yükləmə; bildiriş, alarm və s. — səssiz keçir */
(function () {
  'use strict';
  if (window.__AMMO_SHIM__) return;
  window.__AMMO_SHIM__ = true;

  const SHIM_URL = (document.currentScript && document.currentScript.src) || '';
  const ROOT = SHIM_URL ? SHIM_URL.replace(/chrome-shim\.js.*$/, '') : location.href.replace(/suite\/.*$/, ''); // .../mobil/
  const IS_AMMO = /\/ammo\//.test(location.pathname);       // AMMO (Vergi) səhifələri
  const SUITE = ROOT + (IS_AMMO ? 'ammo/' : 'suite/');
  const AUTH_KEY = 'ammoMobAuth';

  // ------------------------------------------------------------------ yaddaş (IndexedDB)
  const DB_NAME = 'ammo-chrome-storage', STORE = 'kv';
  let dbP = null;
  const openDb = () => dbP || (dbP = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  let mem = null;
  const ready = (async () => {
    const m = new Map();
    try {
      const db = await openDb();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readonly'); const os = tx.objectStore(STORE);
        const rq = os.openCursor();
        rq.onsuccess = () => { const c = rq.result; if (c) { m.set(c.key, c.value); c.continue(); } else res(); };
        rq.onerror = () => rej(rq.error);
      });
    } catch (e) { /* gizli rejim — yalnız yaddaşda */ }
    // AMMO Mobil girişi = AMMO SUITE girişi
    try {
      const a = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
      if (a && a.idToken) { m.set('suiteAuth', { ...(m.get('suiteAuth') || {}), ...a }); m.set('ammoAuth', { ...(m.get('ammoAuth') || {}), ...a, at: Date.now() }); }
    } catch (e) { /* */ }
    mem = m;
  })();
  async function persist(set, del) {
    try {
      const db = await openDb();
      await new Promise((res) => {
        const tx = db.transaction(STORE, 'readwrite'); const os = tx.objectStore(STORE);
        for (const [k, v] of set) os.put(v, k);
        for (const k of del) os.delete(k);
        tx.oncomplete = res; tx.onerror = res; tx.onabort = res;
      });
    } catch (e) { /* */ }
  }
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const listeners = new Set();
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('ammo-chrome-storage') : null;
  function emit(changes, remote) {
    if (!Object.keys(changes).length) return;
    listeners.forEach((fn) => { try { fn(changes, 'local'); } catch (e) { console.warn(e); } });
    if (!remote && bc) try { bc.postMessage(changes); } catch (e) { /* */ }
  }
  if (bc) bc.onmessage = async (ev) => {
    await ready; const ch = ev.data || {};
    for (const [k, c] of Object.entries(ch)) { if ('newValue' in c) mem.set(k, c.newValue); else mem.delete(k); }
    emit(ch, true);
  };
  const cbify = (p, cb) => { if (typeof cb === 'function') p.then((v) => cb(v), () => cb()); return p; };

  const local = {
    get(keys, cb) {
      return cbify((async () => {
        await ready; const out = {};
        if (keys == null) { for (const [k, v] of mem) out[k] = clone(v); return out; }
        if (typeof keys === 'string') keys = [keys];
        if (Array.isArray(keys)) { for (const k of keys) if (mem.has(k)) out[k] = clone(mem.get(k)); return out; }
        for (const [k, d] of Object.entries(keys)) out[k] = mem.has(k) ? clone(mem.get(k)) : d;
        return out;
      })(), cb);
    },
    set(items, cb) {
      return cbify((async () => {
        await ready; const changes = {}, set = [];
        for (const [k, v] of Object.entries(items || {})) {
          const nv = clone(v); changes[k] = { oldValue: mem.get(k), newValue: nv }; mem.set(k, nv); set.push([k, nv]);
          if ((k === 'suiteAuth' || k === 'ammoAuth') && nv && nv.idToken) { try { const cur = JSON.parse(localStorage.getItem(AUTH_KEY) || '{}'); localStorage.setItem(AUTH_KEY, JSON.stringify({ ...cur, idToken: nv.idToken, refreshToken: nv.refreshToken || cur.refreshToken, uid: nv.uid || cur.uid, expiresAt: nv.expiresAt || cur.expiresAt, email: nv.email || cur.email })); } catch (e) { /* */ } }
        }
        await persist(set, []); emit(changes);
      })(), cb);
    },
    remove(keys, cb) {
      return cbify((async () => {
        await ready; const changes = {}, del = [];
        for (const k of [].concat(keys || [])) { if (k === 'suiteAuth' || k === 'ammoAuth') continue; if (mem.has(k)) { changes[k] = { oldValue: mem.get(k) }; mem.delete(k); del.push(k); } }
        await persist([], del); emit(changes);
      })(), cb);
    },
    clear(cb) { return cbify((async () => { await ready; const keys = [...mem.keys()].filter((k) => k !== 'suiteAuth' && k !== 'ammoAuth'); return local.remove(keys); })(), cb); },
    getBytesInUse(k, cb) { return cbify(Promise.resolve(0), cb); },
  };

  // ------------------------------------------------------------------ digər API-lər
  const noopEvent = () => ({ addListener() {}, removeListener() {}, hasListener() { return false; } });
  const openUrl = (url) => { if (!url) return; const u = /^https?:|^blob:|^data:/.test(url) ? url : SUITE + String(url).replace(/^\//, ''); window.open(u, '_blank', 'noopener'); };
  const APPS_SCRIPT = 'https://script.google.com/macros/s/AKfycbzNfq2z5uxaU1CLxjGG1gVS1K1FaiRA5dFKvmUkzDNGRz1f2qsHOVdFu3-sy4zygkZN/exec';
  async function sendMessage(msg) {
    const t = msg && msg.type;
    if (t === 'SEND_TASK_EMAIL') {
      try { await fetch(APPS_SCRIPT, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(msg.payload || {}) }); return { success: true }; }
      catch (e) { return { success: false, error: String(e.message || e) }; }
    }
    if (t === 'gmail-status') return { connected: false };
    if (t === 'AMMO_NET' && msg.req) { // AMMO (Vergi): Firebase sorğuları fon skripti əvəzinə birbaşa
      const q = msg.req; const init = { method: q.method || 'GET', headers: q.headers || {}, cache: 'no-store' };
      if (q.body != null) init.body = typeof q.body === 'string' ? q.body : JSON.stringify(q.body);
      try {
        const res = await fetch(q.url, init); const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) { /* mətn */ }
        return { ok: res.ok, status: res.status, json, text: json ? '' : text.slice(0, 4000) };
      } catch (e) { return { error: String(e.message || e) }; }
    }
    if (t === 'AMMO_OPEN_PAGE' && msg.page) { location.href = SUITE + String(msg.page).replace(/^\//, '') + (msg.query ? '?' + msg.query : ''); return { ok: true }; }
    if (t === 'AMMO_OPEN_URL' && msg.url) { openUrl(msg.url); return { ok: true }; }
    if (t === 'AMMO_CLOUD_CHANGED') return { ok: true };
    if (t === 'AMMO_FLUSH_NOW') return { ok: true };
    return { ok: false, error: 'Bu əməliyyat yalnız kompüterdəki AMMO SUITE-də işləyir' };
  }

  window.chrome = window.chrome || {};
  Object.assign(window.chrome, {
    storage: { local, sync: local, session: local, onChanged: { addListener(fn) { listeners.add(fn); }, removeListener(fn) { listeners.delete(fn); }, hasListener(fn) { return listeners.has(fn); } } },
    runtime: {
      id: 'ammo-mobil-web', lastError: undefined,
      getURL(p) { p = String(p || '').replace(/^\//, ''); if (p === 'suite.html' || p.startsWith('suite.html')) return ROOT + '#panels'; return SUITE + p; },
      getManifest() { return { version: 'mobil', name: IS_AMMO ? 'AMMO (mobil)' : 'AMMO SUITE (mobil)', manifest_version: 3 }; },
      sendMessage(msg, a, b) { const cb = typeof a === 'function' ? a : b; return cbify(sendMessage(msg), cb); },
      getPlatformInfo(cb) { return cbify(Promise.resolve({ os: /Android/i.test(navigator.userAgent) ? 'android' : /iPhone|iPad/.test(navigator.userAgent) ? 'ios' : 'win', arch: 'arm' }), cb); },
      onMessage: noopEvent(), onInstalled: noopEvent(), onStartup: noopEvent(), connect() { return { postMessage() {}, onMessage: noopEvent(), onDisconnect: noopEvent(), disconnect() {} }; },
      reload() { location.reload(); },
    },
    tabs: {
      create(o, cb) { openUrl(o && o.url); return cbify(Promise.resolve({ id: 0 }), cb); },
      update(id, o, cb) { if (typeof id === 'object') { cb = o; o = id; } openUrl(o && o.url); return cbify(Promise.resolve({ id: 0 }), cb); },
      query(q, cb) { return cbify(Promise.resolve([]), cb); }, get(id, cb) { return cbify(Promise.resolve(null), cb); }, remove(id, cb) { return cbify(Promise.resolve(), cb); },
      sendMessage() { return Promise.reject(new Error('tab yoxdur')); }, onUpdated: noopEvent(), onRemoved: noopEvent(),
    },
    windows: { create(o, cb) { openUrl(o && o.url); return cbify(Promise.resolve({ id: 0 }), cb); }, update(id, o, cb) { return cbify(Promise.resolve(), cb); }, getAll(o, cb) { if (typeof o === 'function') cb = o; return cbify(Promise.resolve([]), cb); } },
    downloads: {
      download(o, cb) {
        const a = document.createElement('a'); a.href = o.url; a.download = String(o.filename || 'fayl').split(/[\\/]/).pop(); document.body.appendChild(a); a.click(); a.remove();
        return cbify(Promise.resolve(1), cb);
      },
    },
    notifications: { create(id, o, cb) { if (typeof id === 'object') cb = o; return cbify(Promise.resolve('n'), cb); }, clear(id, cb) { return cbify(Promise.resolve(true), cb); }, getAll(cb) { return cbify(Promise.resolve({}), cb); }, onClicked: noopEvent(), onButtonClicked: noopEvent() },
    alarms: { create() {}, clear(n, cb) { return cbify(Promise.resolve(true), cb); }, get(n, cb) { return cbify(Promise.resolve(null), cb); }, onAlarm: noopEvent() },
    extension: { isAllowedFileSchemeAccess(cb) { return cbify(Promise.resolve(false), cb); }, getURL(p) { return SUITE + String(p || '').replace(/^\//, ''); } },
    identity: { getRedirectURL() { return ''; }, getAuthToken(o, cb) { const p = Promise.reject(new Error('Gmail girişi telefonda yoxdur')); if (cb) { p.catch(() => cb()); return; } return p; }, removeCachedAuthToken(o, cb) { return cbify(Promise.resolve(), cb); }, clearAllCachedAuthTokens(cb) { return cbify(Promise.resolve(), cb); }, getProfileUserInfo(o, cb) { if (typeof o === 'function') cb = o; return cbify(Promise.resolve({ email: '' }), cb); } },
    scripting: { executeScript() { return Promise.reject(new Error('Telefonda mümkün deyil')); } },
    action: { onClicked: noopEvent(), setBadgeText() {}, setBadgeBackgroundColor() {} },
  });

  // ------------------------------------------------------------------ «Geri» düyməsi
  function backButton() {
    if (window.top !== window || document.getElementById('ammoMobBack')) return;
    const b = document.createElement('a');
    b.id = 'ammoMobBack'; b.href = ROOT + '#panels'; b.textContent = '‹ AMMO';
    Object.assign(b.style, { position: 'fixed', left: '10px', bottom: '14px', zIndex: 2147483647, background: '#0d1b33', color: '#fff', font: '700 15px system-ui,sans-serif', padding: '10px 14px', borderRadius: '22px', textDecoration: 'none', boxShadow: '0 6px 18px rgba(0,0,0,.3)', opacity: '.92' });
    document.body.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', backButton); else backButton();
})();
