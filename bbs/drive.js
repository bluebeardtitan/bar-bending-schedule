/* Google Drive sync — OAuth2 implicit grant (redirect flow) + Drive API v3
   Uses a full-page redirect to Google for auth (no popup), then returns to the
   same page with the access token in the URL fragment.  Token is cached in
   localStorage across page reloads (same key scheme as scheme-database). */
(function () {
  'use strict';

  var CLIENT_ID_B64 = 'MTA2NzA3NTQ5NTIwMC1wMGhhdXJuanRwMzJvZm51YWVuNzQ5NzBybDN1OHY1di5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==';
  var SCOPES = 'https://www.googleapis.com/auth/drive.file';
  var TOKEN_KEY = 'bbs_gdrive_token';
  var EXPIRY_KEY = 'bbs_gdrive_token_expiry';
  var PENDING_KEY = 'bbs_gdrive_pending_action';
  var MAK_FOLDER = 'MAK-Projects';
  var BBS_FOLDER = 'Bar-Bending-Schedule-Backups';

  var accessToken = null;

  function decode() {
    try { return atob(CLIENT_ID_B64); } catch (e) { return null; }
  }

  function api(url, opts) {
    return fetch(url, Object.assign({}, opts, {
      headers: Object.assign({}, (opts && opts.headers) || {}, { Authorization: 'Bearer ' + accessToken }),
    }));
  }

  /* ──────── OAuth redirect flow ──────── */

  function getRedirectUri() {
    return window.location.origin + window.location.pathname;
  }

  /* Initiate Google OAuth — redirects the page to Google's consent screen. */
  function oauthSignIn() {
    var clientId = decode();
    if (!clientId) { alert('Invalid client ID configuration.'); return; }
    var form = document.createElement('form');
    form.setAttribute('method', 'GET');
    form.setAttribute('action', 'https://accounts.google.com/o/oauth2/v2/auth');
    var params = {
      client_id: clientId,
      redirect_uri: getRedirectUri(),
      response_type: 'token',
      scope: SCOPES,
      include_granted_scopes: 'true',
      prompt: 'consent',
    };
    for (var p in params) {
      var input = document.createElement('input');
      input.setAttribute('type', 'hidden');
      input.setAttribute('name', p);
      input.setAttribute('value', params[p]);
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  }

  /* Extract token from URL fragment after OAuth redirect. */
  function extractTokenFromHash() {
    var hash = window.location.hash;
    if (!hash || !hash.includes('access_token')) return false;
    var params = new URLSearchParams(hash.substring(1));
    var token = params.get('access_token');
    var expiresIn = parseInt(params.get('expires_in') || '3600', 10);
    if (token) {
      var expiry = Date.now() + (expiresIn - 60) * 1000;
      try {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(EXPIRY_KEY, String(expiry));
      } catch (e) { /* localStorage may be unavailable */ }
      accessToken = token;
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      return true;
    }
    return false;
  }

  /* Load a previously cached token from localStorage. */
  function loadCachedToken() {
    if (accessToken) return true;
    try {
      var token = localStorage.getItem(TOKEN_KEY);
      var expiry = parseInt(localStorage.getItem(EXPIRY_KEY) || '0', 10);
      if (token && expiry > Date.now()) {
        accessToken = token;
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  /* ──────── Folder helpers ──────── */

  function ensureFolder(name, parentId) {
    var esc = name.replace(/'/g, "\\'");
    var parts = "name='" + esc + "' and mimeType='application/vnd.google-apps.folder' and trashed=false";
    if (parentId) parts += " and '" + parentId + "' in parents";
    else parts += " and 'root' in parents";
    var q = encodeURIComponent(parts);
    return api('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id)').then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.files && data.files.length) return data.files[0].id;
        var body = { name: name, mimeType: 'application/vnd.google-apps.folder' };
        if (parentId) body.parents = [parentId];
        return api('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then(function (r) { return r.json(); }).then(function (f) { return f.id; });
      });
  }

  function ensureBackupsRoot() {
    return ensureFolder(MAK_FOLDER).then(function (makId) {
      return ensureFolder(BBS_FOLDER, makId);
    });
  }

  function ensureProjectFolder(parentId, uuid, projName) {
    var esc = uuid.replace(/'/g, "\\'");
    var q = encodeURIComponent("name='" + esc + "' and '" + parentId + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false");
    return api('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id)').then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.files && data.files.length) return data.files[0].id;
        return api('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: uuid,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
            properties: { projectName: projName },
          }),
        }).then(function (r) { return r.json(); }).then(function (f) { return f.id; });
      });
  }

  /* ──────── Upload ──────── */

  /* Create a file (no parent → goes to root), move it to the target folder,
     then upload the content.  The explicit addParents/removeParents step
     ensures the file ends up in the right folder regardless of whether the
     initial create honours the parents field. */
  function createThenUpload(fileName, folderId, jsonStr) {
    return api('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fileName }),
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (e) { throw new Error('Create failed: ' + (e.error && e.error.message || r.statusText)); });
      return r.json();
    }).then(function (file) {
      var moveUrl = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(file.id) +
        '?addParents=' + encodeURIComponent(folderId) +
        '&removeParents=root';
      return api(moveUrl, { method: 'PATCH' }).then(function (r) {
        if (!r.ok) return r.json().then(function (e) { throw new Error('Move failed: ' + (e.error && e.error.message || r.statusText)); });
        return file;
      });
    }).then(function (file) {
      return api('https://www.googleapis.com/upload/drive/v3/files/' + file.id + '?uploadType=media', {
        method: 'PATCH',
        body: jsonStr,
        headers: { 'Content-Type': 'application/json' },
      }).then(function (r) {
        if (!r.ok) return r.json().then(function (e) { throw new Error('Upload failed: ' + (e.error && e.error.message || r.statusText)); });
        return r.json();
      });
    });
  }

  /* ──────── Dialog helpers ──────── */

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString();
  }

  function showDialog(title, subtitle, items, renderItem) {
    return new Promise(function (resolve, reject) {
      var dlg = document.createElement('dialog');
      dlg.style.cssText = 'padding:0;border-radius:14px;border:1px solid var(--border);background:var(--panel);color:var(--text);box-shadow:0 28px 70px rgba(0,0,0,.5);max-width:520px;width:90vw';
      dlg.innerHTML =
        '<div style="padding:16px">' +
          '<h3 style="margin:0 0 4px;font-size:15px;font-weight:700">' + escapeHtml(title) + '</h3>' +
          (subtitle ? '<p style="margin:0 0 12px;font-size:12px;color:var(--muted)">' + escapeHtml(subtitle) + '</p>' : '') +
          '<div style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:4px" id="driveDialogList">' +
            items.map(renderItem).join('') +
          '</div>' +
          '<div style="display:flex;gap:6px;margin-top:12px;justify-content:flex-end">' +
            '<button class="btn small ghost" id="driveDialogCancel" type="button" style="margin-left:auto">Cancel</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(dlg);

      function cleanup() {
        if (dlg && dlg.parentNode) dlg.parentNode.removeChild(dlg);
      }

      dlg.addEventListener('close', cleanup);

      var btns = dlg.querySelectorAll('[data-drive-val]');
      btns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var val = this.getAttribute('data-drive-val');
          dlg.close();
          cleanup();
          resolve(val);
        });
      });

      var cancelBtn = dlg.querySelector('#driveDialogCancel');
      if (cancelBtn) cancelBtn.addEventListener('click', function () { dlg.close(); cleanup(); reject(new Error('canceled')); });

      dlg.addEventListener('close', function () { cleanup(); if (reject) { reject(new Error('canceled')); reject = null; } });

      dlg.showModal();
    });
  }

  function pickProject(projects) {
    if (!projects || !projects.length) return Promise.reject(new Error('no projects'));
    return showDialog('Restore from Google Drive', 'Select a project to restore:', projects, function (p) {
      var displayName = p.projectName || p.name || 'Unknown';
      var uuid = p.name || '';
      var count = p.fileCount != null ? ' (' + p.fileCount + ' backup' + (p.fileCount === 1 ? '' : 's') + ')' : '';
      return '<button type="button" data-drive-val="' + p.id + '" style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;padding:10px 12px;background:transparent;border:1px solid var(--border);border-radius:8px;color:var(--text);cursor:pointer;font-size:13px;text-align:left;transition:background .15s" onmouseover="this.style.background=\'var(--accent)\'" onmouseout="this.style.background=\'transparent\'">' +
        '<span style="font-weight:600">' + escapeHtml(displayName) + '</span>' +
        '<span style="font-size:10px;color:var(--muted)">' + escapeHtml(uuid) + ' · ' + escapeHtml(count) + '</span>' +
      '</button>';
    });
  }

  function pickFile(files) {
    if (!files || !files.length) return Promise.reject(new Error('no backups'));
    return showDialog('Select Backup', 'Choose a backup to restore:', files, function (f) {
      var name = f.name || 'unknown';
      var time = f.createdTime ? fmtDate(f.createdTime) : '';
      return '<button type="button" data-drive-val="' + f.id + '" style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;padding:10px 12px;background:transparent;border:1px solid var(--border);border-radius:8px;color:var(--text);cursor:pointer;font-size:13px;text-align:left;transition:background .15s" onmouseover="this.style.background=\'var(--accent)\'" onmouseout="this.style.background=\'transparent\'">' +
        '<span style="font-weight:600">' + escapeHtml(name) + '</span>' +
        (time ? '<span style="font-size:10px;color:var(--muted)">' + escapeHtml(time) + '</span>' : '') +
      '</button>';
    });
  }

  /* ────────────── Public API ────────────── */

  window.GoogleDrive = {
    /* Init — call once on page load. Extracts token from redirect hash and
       loads any cached token from localStorage. Returns { signedIn, justAuthenticated }:
       justAuthenticated is true only when the token was just extracted from an
       OAuth redirect (as opposed to a token already cached from an earlier
       session) — that's the caller's cue to resume whatever action was stashed
       via requestAuth(pendingAction) before the redirect. */
    init: function () {
      var justAuthenticated = extractTokenFromHash();
      if (!justAuthenticated) loadCachedToken();
      return { signedIn: !!accessToken, justAuthenticated: justAuthenticated };
    },

    /* Reads and clears the action name stashed by requestAuth() right before
       an OAuth redirect (sessionStorage survives the same-tab navigation,
       unlike in-memory JS state, which is why this is needed at all). */
    takePendingAction: function () {
      var v = null;
      try {
        v = sessionStorage.getItem(PENDING_KEY);
        sessionStorage.removeItem(PENDING_KEY);
      } catch (e) { /* ignore */ }
      return v;
    },

    /* Check whether a valid token exists (local check, no network call). */
    isSignedIn: function () {
      return !!accessToken;
    },

    /* Authorize: if a cached token exists and is fresh, resolve immediately.
       Otherwise redirect to Google for consent.  This never returns to the
       calling code — the page navigates away.
       `pendingAction` ('backup' | 'restore') is stashed so init() can hand it
       back via takePendingAction() once we return from the redirect. */
    requestAuth: function (pendingAction) {
      if (loadCachedToken()) return Promise.resolve();
      if (pendingAction) {
        try { sessionStorage.setItem(PENDING_KEY, pendingAction); } catch (e) { /* ignore */ }
      }
      oauthSignIn();
      return new Promise(function () {}); // never resolves — page redirects
    },

    /* Disconnect: clear cached token. */
    signOut: function () {
      accessToken = null;
      try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(EXPIRY_KEY);
      } catch (e) { /* ignore */ }
      return Promise.resolve();
    },

    /* Save data to Drive under MAK-Projects/Bar-Bending-Schedule-Backups/<uuid>. */
    save: function (label, data, uuid, projectName) {
      return ensureBackupsRoot().then(function (rootId) {
        return ensureProjectFolder(rootId, uuid, projectName || 'Unnamed Project');
      }).then(function (folderId) {
        var now = new Date();
        var ts = now.getFullYear() + '-' +
          String(now.getMonth() + 1).padStart(2, '0') + '-' +
          String(now.getDate()).padStart(2, '0') + '_' +
          String(now.getHours()).padStart(2, '0') + '-' +
          String(now.getMinutes()).padStart(2, '0');
        var name = label + '_backup_' + ts + '.json';
        return createThenUpload(name, folderId, JSON.stringify(data, null, 2)).then(function () { return name; });
      });
    },

    /* List project subfolders under Bar-Bending-Schedule-Backups. */
    listProjects: function () {
      return ensureBackupsRoot().then(function (rootId) {
        var q = encodeURIComponent("'" + rootId + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false");
        return api('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name,properties,createdTime)&orderBy=name')
          .then(function (r) { return r.json(); });
      }).then(function (data) {
        var folders = data.files || [];
        var qs = folders.map(function (f) {
          f.projectName = (f.properties && f.properties.projectName) || f.name;
          var q = encodeURIComponent("'" + f.id + "' in parents and trashed=false");
          return api('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id)&pageSize=1')
            .then(function (r) { return r.json(); })
            .then(function (d) { f.fileCount = (d.files || []).length; return f; });
        });
        return Promise.all(qs);
      });
    },

    /* List backup files in a project folder. */
    listBackups: function (folderId) {
      var q = encodeURIComponent("'" + folderId + "' in parents and trashed=false");
      return api('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name,createdTime)&orderBy=createdTime%20desc')
        .then(function (r) { return r.json(); }).then(function (data) { return data.files || []; });
    },

    /* Download a backup and parse as JSON. */
    load: function (fileId) {
      return api('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media')
        .then(function (r) { return r.text(); }).then(function (text) { return JSON.parse(text); });
    },

    /* Delete a backup file. */
    'delete': function (fileId) {
      return api('https://www.googleapis.com/drive/v3/files/' + fileId, { method: 'DELETE' });
    },

    /* Dialog pickers. */
    pickProject: function (projects) { return pickProject(projects); },
    pickFile: function (files) { return pickFile(files); },
  };
})();
