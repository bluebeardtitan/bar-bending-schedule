/* =====================================================================
   AppDB — shared IndexedDB key-value store for BBS and CFS pages.

   API (all on window.AppDB):
     await AppDB.get(key)              → stored value or null
     AppDB.set(key, val)               → Promise (fire-and-forget ok)
     AppDB.del(key)                    → Promise
     AppDB.clear()                     → Promise — clears ALL stored data
     await AppDB.migrateFromLS(mappings)
       mappings: [[lsKey, dbKey, parseJSON?], ...]
       Copies each key from localStorage into IDB once, then removes from LS.
       Uses the first dbKey + '__migrated' as the completion flag.

   Database: 'bbs_app' v1, single object store 'kv'.
   Stores structured JS values directly (no JSON serialisation overhead).
   ===================================================================== */
(function () {
  'use strict';

  const DB_NAME = 'bbs_app', DB_VER = 1;
  let _ready = null;

  function openDB() {
    if (_ready) return _ready;
    _ready = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = () => reject(req.error);
      req.onblocked = () => console.warn('AppDB: upgrade blocked by another open tab');
    });
    return _ready;
  }

  async function get(key) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const r = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      r.onsuccess = () => res(r.result ?? null);
      r.onerror   = () => rej(r.error);
    });
  }

  async function set(key, val) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const r = db.transaction('kv', 'readwrite').objectStore('kv').put(val, key);
      r.onsuccess = () => res();
      r.onerror   = () => rej(r.error);
    });
  }

  async function del(key) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const r = db.transaction('kv', 'readwrite').objectStore('kv').delete(key);
      r.onsuccess = () => res();
      r.onerror   = () => rej(r.error);
    });
  }

  async function clear() {
    const db = await openDB();
    return new Promise((res, rej) => {
      const r = db.transaction('kv', 'readwrite').objectStore('kv').clear();
      r.onsuccess = () => res();
      r.onerror   = () => rej(r.error);
    });
  }

  /* One-time migration from localStorage. The flag is stored in IDB so the
     migration never repeats, even if the user clears localStorage manually. */
  async function migrateFromLS(mappings) {
    const flagKey = mappings[0][1] + '__migrated';
    if (await get(flagKey)) return;
    for (const [lsKey, dbKey, parse] of mappings) {
      const raw = localStorage.getItem(lsKey);
      if (raw !== null) {
        try { await set(dbKey, parse ? JSON.parse(raw) : raw); } catch (_) {}
        localStorage.removeItem(lsKey);
      }
    }
    await set(flagKey, true);
  }

  window.AppDB = { get, set, del, clear, migrateFromLS, ready: openDB };
})();
