/* AppDB — IndexedDB key-value store shared by BBS and CFS pages.
   Database: 'bbs_app' v1, object store 'kv'. Values stored as-is (no JSON). */
(function () {
  'use strict';

  const DB_NAME = 'bbs_app', DB_VER = 1;
  let _ready = null;

  function openDB() {
    if (_ready) return _ready;
    _ready = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        if (!e.target.result.objectStoreNames.contains('kv')) e.target.result.createObjectStore('kv');
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = () => reject(req.error);
    });
    return _ready;
  }

  async function txn(mode, fn) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const r = fn(db.transaction('kv', mode).objectStore('kv'));
      r.onsuccess = () => res(r.result ?? null);
      r.onerror   = () => rej(r.error);
    });
  }

  window.AppDB = {
    get:   key    => txn('readonly',  s => s.get(key)),
    set:   (k, v) => txn('readwrite', s => s.put(v, k)),
    clear: ()     => txn('readwrite', s => s.clear()),
  };
})();
