/* Google Drive sync — OAuth2 + Drive API v3
   Uses Google Identity Services (GIS) loaded from accounts.google.com/gsi/client.
   Client ID is base64-encoded to reduce visual scanning surface. */
(function () {
  'use strict';

  var CLIENT_ID_B64 = 'MTA2NzA3NTQ5NTIwMC1wMGhhdXJuanRwMzJvZm51YWVuNzQ5NzBybDN1OHY1di5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==';
  var SCOPES = 'https://www.googleapis.com/auth/drive.file';
  var ROOT_FOLDER = 'BBS Backups';

  var tokenClient = null;
  var accessToken = null;

  function decode() {
    try { return atob(CLIENT_ID_B64); } catch (e) { return null; }
  }

  function api(url, opts) {
    return fetch(url, Object.assign({}, opts, {
      headers: Object.assign({}, (opts && opts.headers) || {}, { Authorization: 'Bearer ' + accessToken }),
    }));
  }

  function acquireToken(interactive) {
    if (!tokenClient) {
      var id = decode();
      if (!id || typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2)
        return Promise.reject(new Error('Google Identity Services not loaded. Check network / script tag.'));
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: id,
        scope: SCOPES,
        callback: function (resp) {
          if (resp.access_token) accessToken = resp.access_token;
        },
      });
    }
    return new Promise(function (resolve, reject) {
      tokenClient.callback = function (resp) {
        if (resp.error) { reject(new Error(resp.error)); return; }
        accessToken = resp.access_token;
        resolve();
      };
      tokenClient.requestAccessToken({ prompt: interactive ? '' : 'none' });
    });
  }

  function ensureToken() {
    if (accessToken) {
      return api('https://www.googleapis.com/drive/v3/about?fields=user').then(function (r) {
        if (r.ok) return;
        accessToken = null;
        return acquireToken(true);
      });
    }
    return acquireToken(false).catch(function () { return acquireToken(true); });
  }

  /* Find or create the root 'BBS Backups' folder. */
  function ensureRootFolder() {
    var q = encodeURIComponent("name='" + ROOT_FOLDER + "' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    return api('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id)').then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.files && data.files.length) return data.files[0].id;
        return api('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: ROOT_FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
        }).then(function (r) { return r.json(); }).then(function (f) { return f.id; });
      });
  }

  /* Find or create a subfolder by name under a parent folder. */
  function ensureSubFolder(parentId, name) {
    var esc = name.replace(/'/g, "\\'");
    var q = encodeURIComponent("name='" + esc + "' and '" + parentId + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false");
    return api('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id)').then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.files && data.files.length) return data.files[0].id;
        return api('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
        }).then(function (r) { return r.json(); }).then(function (f) { return f.id; });
      });
  }

  function multipartUpload(fileName, folderId, jsonStr) {
    var boundary = 'bbs_drive_boundary';
    var body = [
      '--' + boundary,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify({ name: fileName, parents: [folderId] }),
      '--' + boundary,
      'Content-Type: application/json',
      '',
      jsonStr,
      '--' + boundary + '--',
    ].join('\r\n');
    return api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      body: body,
      headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
    }).then(function (r) { return r.json(); });
  }

  /* ──────── Shared dialog helpers ──────── */
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

  /* ──────── Project picker dialog ──────── */
  function pickProject(projects) {
    if (!projects || !projects.length)
      return Promise.reject(new Error('no projects'));
    return showDialog(
      'Restore from Google Drive',
      'Select a project to restore:',
      projects,
      function (p) {
        var name = p.name || 'Unknown project';
        var count = p.fileCount != null ? ' (' + p.fileCount + ' backup' + (p.fileCount === 1 ? '' : 's') + ')' : '';
        var time = p.createdTime ? fmtDate(p.createdTime) : '';
        return '<button type="button" data-drive-val="' + p.id + '" style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;padding:10px 12px;background:transparent;border:1px solid var(--border);border-radius:8px;color:var(--text);cursor:pointer;font-size:13px;text-align:left;transition:background .15s" onmouseover="this.style.background=\'var(--accent)\'" onmouseout="this.style.background=\'transparent\'">' +
          '<span style="font-weight:600">' + escapeHtml(name) + '</span>' +
          '<span style="font-size:10px;color:var(--muted)">' + escapeHtml(time) + count + '</span>' +
        '</button>';
      }
    );
  }

  /* ──────── Backup file picker dialog ──────── */
  function pickFile(files) {
    if (!files || !files.length)
      return Promise.reject(new Error('no backups'));
    return showDialog(
      'Select Backup',
      'Choose a backup to restore:',
      files,
      function (f) {
        var name = f.name || 'unknown';
        var time = f.createdTime ? fmtDate(f.createdTime) : '';
        return '<button type="button" data-drive-val="' + f.id + '" style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;padding:10px 12px;background:transparent;border:1px solid var(--border);border-radius:8px;color:var(--text);cursor:pointer;font-size:13px;text-align:left;transition:background .15s" onmouseover="this.style.background=\'var(--accent)\'" onmouseout="this.style.background=\'transparent\'">' +
          '<span style="font-weight:600">' + escapeHtml(name) + '</span>' +
          (time ? '<span style="font-size:10px;color:var(--muted)">' + escapeHtml(time) + '</span>' : '') +
        '</button>';
      }
    );
  }

  /* ────────────── Public API ────────────── */

  window.GoogleDrive = {
    /* Save a JSON-serialisable object to Drive under a project subfolder.
       @param label       e.g. "bbs" or "cfs"
       @param data        the object to serialise
       @param projectName project name — used as subfolder name; required
       @return Promise<string> — the saved file name */
    save: function (label, data, projectName) {
      return ensureToken().then(function () { return ensureRootFolder(); }).then(function (rootId) {
        return ensureSubFolder(rootId, projectName || 'Unnamed Project');
      }).then(function (folderId) {
        var now = new Date();
        var ts = now.getFullYear() + '-' +
          String(now.getMonth() + 1).padStart(2, '0') + '-' +
          String(now.getDate()).padStart(2, '0') + '_' +
          String(now.getHours()).padStart(2, '0') + '-' +
          String(now.getMinutes()).padStart(2, '0');
        var name = label + '_backup_' + ts + '.json';
        return multipartUpload(name, folderId, JSON.stringify(data, null, 2)).then(function () { return name; });
      });
    },

    /* List project subfolders under the root folder.
       @return Promise<Array<{id,name,createdTime,fileCount}>> */
    listProjects: function () {
      return ensureToken().then(function () { return ensureRootFolder(); }).then(function (rootId) {
        var q = encodeURIComponent("'" + rootId + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false");
        return api('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name,createdTime)&orderBy=name')
          .then(function (r) { return r.json(); });
      }).then(function (data) {
        var folders = data.files || [];
        var qs = folders.map(function (f) {
          var q = encodeURIComponent("'" + f.id + "' in parents and trashed=false");
          return api('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id)&pageSize=1')
            .then(function (r) { return r.json(); })
            .then(function (d) { f.fileCount = (d.files || []).length; return f; });
        });
        return Promise.all(qs);
      });
    },

    /* List backup files in a project folder.
       @param folderId  the project subfolder ID
       @return Promise<Array<{id,name,createdTime}>> */
    listBackups: function (folderId) {
      return ensureToken().then(function () {
        var q = encodeURIComponent("'" + folderId + "' in parents and trashed=false");
        return api('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name,createdTime)&orderBy=createdTime%20desc')
          .then(function (r) { return r.json(); });
      }).then(function (data) { return data.files || []; });
    },

    /* Download a backup and parse as JSON. */
    load: function (fileId) {
      return ensureToken().then(function () {
        return api('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media').then(function (r) { return r.text(); });
      }).then(function (text) { return JSON.parse(text); });
    },

    /* Delete a backup file. */
    'delete': function (fileId) {
      return ensureToken().then(function () {
        return api('https://www.googleapis.com/drive/v3/files/' + fileId, { method: 'DELETE' });
      });
    },

    /* Show a project picker dialog. Returns Promise<string> — the selected folderId.
       Rejects with 'canceled' if user cancels. */
    pickProject: function (projects) {
      return pickProject(projects);
    },

    /* Show a file picker dialog. Returns Promise<string> — the selected fileId.
       Rejects with 'canceled' if user cancels. */
    pickFile: function (files) {
      return pickFile(files);
    },

    /* Revoke the current token. */
    signOut: function () {
      if (!accessToken) return Promise.resolve();
      return fetch('https://oauth2.googleapis.com/revoke?token=' + accessToken, { method: 'POST' }).then(function () {
        accessToken = null;
      }).catch(function () { accessToken = null; });
    },

    /* Check whether a valid token exists. */
    isSignedIn: function () {
      if (!accessToken) return Promise.resolve(false);
      return api('https://www.googleapis.com/drive/v3/about?fields=user').then(function (r) { return r.ok; }).catch(function () { return false; });
    },
  };
})();
