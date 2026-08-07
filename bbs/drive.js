/* Google Drive sync — OAuth2 + Drive API v3
   Uses Google Identity Services (GIS) loaded from accounts.google.com/gsi/client.
   Client ID is base64-encoded to reduce visual scanning surface. */
(function () {
  'use strict';

  var CLIENT_ID_B64 = 'MTA2NzA3NTQ5NTIwMC1wMGhhdXJuanRwMzJvZm51YWVuNzQ5NzBybDN1OHY1di5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==';
  var SCOPES = 'https://www.googleapis.com/auth/drive.file';
  var PARENT_FOLDER = 'MAK-Projects';
  var ROOT_FOLDER = 'BBS-Backups';
  var MANIFEST_NAME = 'manifest.json';

  /* Projects are identified by a stable UUID (kept in projectInfo.driveProjectId
     locally), not by folder name — see manifest.json inside ROOT_FOLDER, which
     maps uuid -> {name, folderId, ...}. The Drive folder name is just a
     human-readable label and is free to be truncated/renamed without breaking
     the link, since lookups always go through the manifest by id.

     Drive itself allows names up to ~32,767 characters, so that's not the real
     ceiling — the real one is the OS path length if the user's Drive is synced
     locally via Drive for Desktop (Windows MAX_PATH is ~260 chars total, and
     users report trouble well before that). We don't know the local sync-root
     prefix length from here, so budget conservatively and leave headroom for it. */
  var LONGEST_BACKUP_FILENAME_LEN = 'xxx_backup_9999-99-99_99-99.json'.length; // 32
  var SAFE_PATH_BUDGET = 180; // budget for "PARENT_FOLDER/ROOT_FOLDER/<project folder>/<file>", leaving ~80 chars of headroom below Windows' 260-char MAX_PATH for the local sync-root path
  var MAX_FOLDER_NAME_LEN = Math.max(20, SAFE_PATH_BUDGET - PARENT_FOLDER.length - ROOT_FOLDER.length - LONGEST_BACKUP_FILENAME_LEN - 3 /* path separators */);

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

  /* Find or create a top-level folder by name (created under Drive root if missing). */
  function ensureTopFolder(name) {
    var q = encodeURIComponent("name='" + name + "' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    return api('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id)').then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.files && data.files.length) return data.files[0].id;
        return api('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, mimeType: 'application/vnd.google-apps.folder' }),
        }).then(function (r) { return r.json(); }).then(function (f) { return f.id; });
      });
  }

  /* Find or create the root 'MAK-Projects/BBS-Backups' folder path. */
  function ensureRootFolder() {
    return ensureTopFolder(PARENT_FOLDER).then(function (parentId) {
      return ensureSubFolder(parentId, ROOT_FOLDER);
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

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /* Trim a project name down to a folder name that keeps the full Drive path
     (including the backup filename) safely under the OS path-length budget. */
  function truncateFolderName(name) {
    var n = String(name || '').trim();
    if (n.length > MAX_FOLDER_NAME_LEN) n = n.slice(0, MAX_FOLDER_NAME_LEN).trim();
    return n || 'Unnamed Project';
  }

  function createFolder(parentId, name) {
    return api('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
    }).then(function (r) { return r.json(); }).then(function (f) { return f.id; });
  }

  function renameFile(fileId, newName) {
    return api('https://www.googleapis.com/drive/v3/files/' + fileId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    }).then(function (r) { return r.json(); });
  }

  /* Returns file metadata, or null if it no longer exists / isn't accessible. */
  function getFileMeta(fileId) {
    return api('https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=id,trashed')
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function updateFileContent(fileId, jsonStr) {
    return api('https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media', {
      method: 'PATCH',
      body: jsonStr,
      headers: { 'Content-Type': 'application/json' },
    }).then(function (r) { return r.json(); });
  }

  function findManifestFile(rootId) {
    var q = encodeURIComponent("name='" + MANIFEST_NAME + "' and '" + rootId + "' in parents and trashed=false");
    return api('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id)').then(function (r) { return r.json(); })
      .then(function (data) { return (data.files && data.files[0] && data.files[0].id) || null; });
  }

  /* Load manifest.json from the root folder, creating an empty one if it
     doesn't exist yet.
     @return Promise<{manifest, fileId}> */
  function getManifest(rootId) {
    return findManifestFile(rootId).then(function (fileId) {
      if (fileId) {
        return api('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media').then(function (r) { return r.text(); })
          .then(function (text) {
            var manifest;
            try { manifest = JSON.parse(text); } catch (e) { manifest = null; }
            if (!manifest || !manifest.projects) manifest = { version: 1, projects: {} };
            return { manifest: manifest, fileId: fileId };
          });
      }
      var manifest = { version: 1, projects: {} };
      return multipartUpload(MANIFEST_NAME, rootId, JSON.stringify(manifest, null, 2)).then(function (f) {
        return { manifest: manifest, fileId: f.id };
      });
    });
  }

  function persistManifest(fileId, manifest) {
    return updateFileContent(fileId, JSON.stringify(manifest, null, 2));
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
       Projects are keyed by a stable UUID (see manifest.json), not by name,
       so renaming a project just relabels its existing folder instead of
       creating a new one.
       @param label       e.g. "bbs" or "cfs"
       @param data        the object to serialise
       @param projectName current display name of the project
       @param projectId   stable per-project UUID from projectInfo.driveProjectId;
                           pass a falsy value to have one minted here
       @return Promise<{fileName, projectId}> */
    save: function (label, data, projectName, projectId) {
      var name = String(projectName || '').trim() || 'Unnamed Project';
      var pid = projectId || uuid();
      var rootId, manifestState;

      return ensureToken().then(function () { return ensureRootFolder(); }).then(function (rId) {
        rootId = rId;
        return getManifest(rootId);
      }).then(function (state) {
        manifestState = state;
        var manifest = state.manifest;
        var entry = manifest.projects[pid];

        if (entry) {
          return getFileMeta(entry.folderId).then(function (meta) {
            if (!meta || meta.trashed) {
              return createFolder(rootId, truncateFolderName(name)).then(function (id) {
                entry.folderId = id;
                entry.folderName = truncateFolderName(name);
                return id;
              });
            }
            if (entry.name !== name) {
              var newFolderName = truncateFolderName(name);
              return renameFile(entry.folderId, newFolderName).then(function () {
                entry.folderName = newFolderName;
                return entry.folderId;
              });
            }
            return entry.folderId;
          });
        }

        var folderName = truncateFolderName(name);
        return createFolder(rootId, folderName).then(function (id) {
          entry = { name: name, folderName: folderName, folderId: id, updatedAt: null, backupCount: 0 };
          manifest.projects[pid] = entry;
          return id;
        });
      }).then(function (folderId) {
        var now = new Date();
        var ts = now.getFullYear() + '-' +
          String(now.getMonth() + 1).padStart(2, '0') + '-' +
          String(now.getDate()).padStart(2, '0') + '_' +
          String(now.getHours()).padStart(2, '0') + '-' +
          String(now.getMinutes()).padStart(2, '0');
        var fileName = label + '_backup_' + ts + '.json';
        return multipartUpload(fileName, folderId, JSON.stringify(data, null, 2)).then(function () {
          var entry = manifestState.manifest.projects[pid];
          entry.name = name;
          entry.updatedAt = now.toISOString();
          entry.backupCount = (entry.backupCount || 0) + 1;
          return persistManifest(manifestState.fileId, manifestState.manifest).then(function () {
            return { fileName: fileName, projectId: pid };
          });
        });
      });
    },

    /* List projects from manifest.json.
       @return Promise<Array<{id,name,createdTime,fileCount}>> — id is the
               Drive folder ID (same shape pickProject/listBackups expect) */
    listProjects: function () {
      return ensureToken().then(function () { return ensureRootFolder(); }).then(function (rootId) {
        return getManifest(rootId);
      }).then(function (state) {
        var projects = state.manifest.projects;
        return Object.keys(projects).map(function (id) {
          var e = projects[id];
          return { id: e.folderId, name: e.name, createdTime: e.updatedAt, fileCount: e.backupCount || 0 };
        }).sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
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
