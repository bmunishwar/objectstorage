// S3 Explorer front-end — vanilla JS, no dependencies.
'use strict';

const state = {
  buckets: [],
  activeBucket: '',
  prefix: '',
  folders: [],
  files: [],
  selected: new Set(), // keys of selected items, prefixed with 'f:' folder or 'o:' object
  viewMode: 'grid',
  recentOps: [],
  logPollTimer: null,
  logCollapsed: false,
};

// ---------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------

// api() / formatBytes() / formatDate() / basename() / escapeHtml() / toast() live in common.js.
window.onApiResult = recordOp;

/** Uploads a single file via multipart form data with progress reporting. */
function apiUpload(file, bucket, key, onProgress) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api.php');
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.onload = () => {
      let json;
      try { json = JSON.parse(xhr.responseText); } catch { json = { success: false, error: 'Invalid server response' }; }
      recordOp('upload', json.success, json.operation_ms ?? (performance.now() - start));
      if (json.success) resolve(json.data);
      else { toast('error', json.error || 'Upload failed'); reject(new Error(json.error)); }
    };
    xhr.onerror = () => { recordOp('upload', false, performance.now() - start); reject(new Error('Network error')); };
    const fd = new FormData();
    fd.append('action', 'upload');
    fd.append('bucket', bucket);
    fd.append('key', key);
    fd.append('file', file);
    xhr.send(fd);
  });
}

// ---------------------------------------------------------------
// Recent operations (sidebar)
// ---------------------------------------------------------------

/** Records an operation in the recent-ops list and re-renders the sidebar. */
function recordOp(action, success, ms) {
  state.recentOps.unshift({ action, success, ms: Math.round(ms) });
  state.recentOps = state.recentOps.slice(0, 10);
  renderRecentOps();
}

function renderRecentOps() {
  const el = document.getElementById('recentOps');
  el.innerHTML = state.recentOps.map((op) => `
    <div class="flex items-center justify-between gap-2">
      <span class="truncate ${op.success ? 'text-slate-300' : 'text-red-300'}">${escapeHtml(op.action)}</span>
      <span class="shrink-0 ${op.success ? 'text-emerald-400' : 'text-red-400'}">${op.success ? '✓' : '✗'} ${op.ms}ms</span>
    </div>
  `).join('') || '<p class="text-slate-600">No operations yet.</p>';
}

// ---------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------

async function loadBuckets() {
  try {
    const data = await api('list_buckets');
    state.buckets = data.buckets;
    renderBucketList();
    renderBucketSelect();
    if (!state.activeBucket && state.buckets.length > 0) {
      selectBucket(state.buckets[0].name);
    }
  } catch { /* toast already shown */ }
}

function renderBucketList() {
  const el = document.getElementById('bucketList');
  el.innerHTML = state.buckets.map((b) => `
    <div class="group flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer ${b.name === state.activeBucket ? 'bg-sky-600/20 text-sky-300' : 'hover:bg-slate-800 text-slate-300'}" data-bucket="${escapeHtml(b.name)}">
      <span class="truncate flex items-center gap-1.5">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>
        <span class="truncate" title="${escapeHtml(b.name)}">${escapeHtml(b.name)}</span>
      </span>
      <button class="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-900/50 text-slate-500 hover:text-red-400 shrink-0" data-delete-bucket="${escapeHtml(b.name)}" title="Delete bucket">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  `).join('') || '<p class="text-slate-600 text-xs px-2">No buckets yet.</p>';

  el.querySelectorAll('[data-bucket]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-delete-bucket]')) return;
      selectBucket(row.dataset.bucket);
    });
  });
  el.querySelectorAll('[data-delete-bucket]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.dataset.deleteBucket;
      if (!confirm(`Delete bucket "${name}"? This cannot be undone.`)) return;
      try {
        await api('delete_bucket', { name });
        toast('success', `Bucket "${name}" deleted.`);
        if (state.activeBucket === name) state.activeBucket = '';
        await loadBuckets();
      } catch { /* toast shown */ }
    });
  });
}

function renderBucketSelect() {
  const sel = document.getElementById('bucketSelect');
  sel.innerHTML = '<option value="">Select bucket…</option>' +
    state.buckets.map((b) => `<option value="${escapeHtml(b.name)}" ${b.name === state.activeBucket ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('');
}

async function selectBucket(name) {
  state.activeBucket = name;
  state.prefix = '';
  state.selected.clear();
  renderBucketList();
  renderBucketSelect();
  await Promise.all([loadObjects(), loadStats()]);
}

async function loadStats() {
  if (!state.activeBucket) return;
  try {
    const data = await api('storage_stats', { bucket: state.activeBucket });
    document.getElementById('statTotal').textContent = formatBytes(data.total_bytes);
    document.getElementById('statObjects').textContent = data.file_count.toLocaleString();
    document.getElementById('statFolders').textContent = data.folder_count.toLocaleString();
  } catch {
    document.getElementById('statTotal').textContent = '—';
    document.getElementById('statObjects').textContent = '—';
    document.getElementById('statFolders').textContent = '—';
  }
}

// ---------------------------------------------------------------
// Object listing / navigation
// ---------------------------------------------------------------

async function loadObjects() {
  if (!state.activeBucket) {
    state.folders = [];
    state.files = [];
    renderBreadcrumb();
    renderFiles();
    return;
  }
  try {
    const data = await api('list_objects', { bucket: state.activeBucket, prefix: state.prefix, delimiter: '/' });
    state.folders = data.folders;
    state.files = data.files;
    state.selected.clear();
    renderBreadcrumb();
    renderFiles();
    renderActionBar();
  } catch { /* toast shown */ }
}

function renderBreadcrumb() {
  const el = document.getElementById('breadcrumb');
  const segments = state.prefix.split('/').filter(Boolean);
  let html = `<button class="hover:text-sky-400 font-medium ${state.prefix === '' ? 'text-slate-100' : ''}" data-prefix="">${escapeHtml(state.activeBucket || 'bucket')}</button>`;
  let acc = '';
  segments.forEach((seg, i) => {
    acc += seg + '/';
    const isLast = i === segments.length - 1;
    html += `<span class="text-slate-600 px-1">/</span><button class="hover:text-sky-400 ${isLast ? 'text-slate-100' : ''}" data-prefix="${escapeHtml(acc)}">${escapeHtml(seg)}</button>`;
  });
  el.innerHTML = html;
  el.querySelectorAll('[data-prefix]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.prefix = btn.dataset.prefix;
      loadObjects();
    });
  });
}

function itemKey(type, key) { return `${type}:${key}`; }

function renderFiles() {
  const empty = state.folders.length === 0 && state.files.length === 0;
  document.getElementById('emptyState').classList.toggle('hidden', !empty || !state.activeBucket);
  document.getElementById('emptyState').classList.toggle('flex', empty && !!state.activeBucket);
  document.getElementById('grid').classList.toggle('hidden', empty || state.viewMode !== 'grid');
  document.getElementById('listTable').classList.toggle('hidden', empty || state.viewMode !== 'list');

  if (state.viewMode === 'grid') renderGrid(); else renderList();
}

function folderCardHtml(folder) {
  const name = basename(folder.prefix);
  const key = itemKey('f', folder.prefix);
  const selected = state.selected.has(key);
  return `
    <div class="group relative flex flex-col items-center gap-1.5 p-3 rounded-lg border cursor-pointer select-none ${selected ? 'border-sky-500 bg-sky-600/10' : 'border-slate-800 hover:border-slate-700 hover:bg-slate-900'}" data-type="folder" data-key="${escapeHtml(folder.prefix)}" title="${escapeHtml(name)}">
      <input type="checkbox" class="absolute top-1.5 left-1.5 accent-sky-500" ${selected ? 'checked' : ''} data-select-checkbox>
      <svg xmlns="http://www.w3.org/2000/svg" class="w-10 h-10 text-sky-400" viewBox="0 0 24 24" fill="currentColor"><path d="M19.5 21a3 3 0 0 0 3-3v-4.5a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3V18a3 3 0 0 0 3 3h15ZM1.5 10.146V6a3 3 0 0 1 3-3h5.379a2.25 2.25 0 0 1 1.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 0 1 3 3v1.146A4.483 4.483 0 0 0 19.5 9h-15a4.483 4.483 0 0 0-3 1.146Z" /></svg>
      <span class="text-xs text-center truncate w-full">${escapeHtml(name)}</span>
    </div>`;
}

function fileCardHtml(file) {
  const name = basename(file.key);
  const key = itemKey('o', file.key);
  const selected = state.selected.has(key);
  return `
    <div class="group relative flex flex-col items-center gap-1.5 p-3 rounded-lg border cursor-pointer select-none ${selected ? 'border-sky-500 bg-sky-600/10' : 'border-slate-800 hover:border-slate-700 hover:bg-slate-900'}" data-type="file" data-key="${escapeHtml(file.key)}" title="${escapeHtml(name)}">
      <input type="checkbox" class="absolute top-1.5 left-1.5 accent-sky-500" ${selected ? 'checked' : ''} data-select-checkbox>
      <svg xmlns="http://www.w3.org/2000/svg" class="w-10 h-10 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m5.231 13.481L15 17.25m-1.519-3.129L12 14.25m2.481-3.129L18 14.25M8.25 3H6.75a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 6.75 21h10.5a2.25 2.25 0 0 0 2.25-2.25V11.25a9 9 0 0 0-9-9Z" /></svg>
      <span class="text-xs text-center truncate w-full">${escapeHtml(name)}</span>
      <span class="text-[10px] text-slate-500">${formatBytes(file.size)}</span>
    </div>`;
}

function renderGrid() {
  const grid = document.getElementById('grid');
  grid.innerHTML = state.folders.map(folderCardHtml).join('') + state.files.map(fileCardHtml).join('');
  wireItemEvents(grid);
}

function renderList() {
  const body = document.getElementById('listBody');
  const rows = [];
  state.folders.forEach((folder) => {
    const name = basename(folder.prefix);
    const key = itemKey('f', folder.prefix);
    const selected = state.selected.has(key);
    rows.push(`
      <tr class="border-b border-slate-900 hover:bg-slate-900 cursor-pointer ${selected ? 'bg-sky-600/10' : ''}" data-type="folder" data-key="${escapeHtml(folder.prefix)}">
        <td class="py-1.5 pr-2"><input type="checkbox" class="accent-sky-500" ${selected ? 'checked' : ''} data-select-checkbox></td>
        <td class="py-1.5 pr-4 flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-sky-400 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M19.5 21a3 3 0 0 0 3-3v-4.5a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3V18a3 3 0 0 0 3 3h15ZM1.5 10.146V6a3 3 0 0 1 3-3h5.379a2.25 2.25 0 0 1 1.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 0 1 3 3v1.146A4.483 4.483 0 0 0 19.5 9h-15a4.483 4.483 0 0 0-3 1.146Z" /></svg><span class="truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</span></td>
        <td class="py-1.5 pr-4 text-slate-500">—</td>
        <td class="py-1.5 pr-4 text-slate-500">—</td>
      </tr>`);
  });
  state.files.forEach((file) => {
    const name = basename(file.key);
    const key = itemKey('o', file.key);
    const selected = state.selected.has(key);
    rows.push(`
      <tr class="border-b border-slate-900 hover:bg-slate-900 cursor-pointer ${selected ? 'bg-sky-600/10' : ''}" data-type="file" data-key="${escapeHtml(file.key)}">
        <td class="py-1.5 pr-2"><input type="checkbox" class="accent-sky-500" ${selected ? 'checked' : ''} data-select-checkbox></td>
        <td class="py-1.5 pr-4 flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-slate-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m5.231 13.481L15 17.25m-1.519-3.129L12 14.25m2.481-3.129L18 14.25M8.25 3H6.75a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 6.75 21h10.5a2.25 2.25 0 0 0 2.25-2.25V11.25a9 9 0 0 0-9-9Z" /></svg><span class="truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</span></td>
        <td class="py-1.5 pr-4 text-slate-500">${formatBytes(file.size)}</td>
        <td class="py-1.5 pr-4 text-slate-500">${formatDate(file.last_modified)}</td>
      </tr>`);
  });
  body.innerHTML = rows.join('');
  wireItemEvents(body);
}

function wireItemEvents(container) {
  container.querySelectorAll('[data-key]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const type = el.dataset.type;
      const key = el.dataset.key;
      const isCheckbox = e.target.matches('[data-select-checkbox]');

      if (!isCheckbox && type === 'folder' && !e.shiftKey && !e.ctrlKey && !e.metaKey && state.selected.size === 0) {
        state.prefix = key;
        loadObjects();
        return;
      }

      const skey = itemKey(type === 'folder' ? 'f' : 'o', key);
      if (e.shiftKey || e.ctrlKey || e.metaKey || isCheckbox) {
        if (state.selected.has(skey)) state.selected.delete(skey);
        else state.selected.add(skey);
      } else {
        state.selected.clear();
        state.selected.add(skey);
      }
      renderFiles();
      renderActionBar();
    });
  });
}

// ---------------------------------------------------------------
// Action bar
// ---------------------------------------------------------------

function renderActionBar() {
  const bar = document.getElementById('actionBar');
  const label = document.getElementById('actionBarLabel');
  const buttons = document.getElementById('actionBarButtons');
  const count = state.selected.size;

  if (count === 0) {
    bar.classList.add('hidden');
    bar.classList.remove('flex');
    return;
  }
  bar.classList.remove('hidden');
  bar.classList.add('flex');

  const items = [...state.selected].map((k) => {
    const [type, ...rest] = k.split(':');
    return { type, key: rest.join(':') };
  });

  if (count === 1 && items[0].type === 'o') {
    const key = items[0].key;
    label.textContent = `Selected: ${basename(key)}`;
    buttons.innerHTML = btn('Download', 'download') + btn('Copy', 'copy') + btn('Move', 'move') +
      btn('Presigned URL', 'presign') + btn('Info', 'info') + btn('Delete', 'delete', true);
    buttons.querySelector('[data-act="download"]').onclick = () => downloadFile(key);
    buttons.querySelector('[data-act="copy"]').onclick = () => openCopyMoveModal(key, 'copy');
    buttons.querySelector('[data-act="move"]').onclick = () => openCopyMoveModal(key, 'move');
    buttons.querySelector('[data-act="presign"]').onclick = () => openPresignedUrlModal(key);
    buttons.querySelector('[data-act="info"]').onclick = () => openObjectInfoModal(key);
    buttons.querySelector('[data-act="delete"]').onclick = () => deleteSelected();
  } else if (count === 1 && items[0].type === 'f') {
    const prefix = items[0].key;
    label.textContent = `Selected: ${basename(prefix)}/`;
    buttons.innerHTML = btn('Open', 'open') + btn('Delete Folder', 'delete', true);
    buttons.querySelector('[data-act="open"]').onclick = () => { state.prefix = prefix; loadObjects(); };
    buttons.querySelector('[data-act="delete"]').onclick = () => deleteSelected();
  } else {
    label.textContent = `${count} items selected`;
    buttons.innerHTML = btn('Bulk Delete', 'delete', true);
    buttons.querySelector('[data-act="delete"]').onclick = () => deleteSelected();
  }
}

function btn(label, act, danger = false) {
  const cls = danger
    ? 'bg-red-900/40 hover:bg-red-900/70 text-red-300'
    : 'bg-slate-800 hover:bg-slate-700 text-slate-200';
  return `<button data-act="${act}" class="px-2.5 py-1 rounded-md text-xs font-medium ${cls}">${label}</button>`;
}

function downloadFile(key) {
  window.open(`api.php?${new URLSearchParams({ action: 'download', bucket: state.activeBucket, key })}`, '_blank');
}

async function deleteSelected() {
  const items = [...state.selected].map((k) => {
    const [type, ...rest] = k.split(':');
    return { type, key: rest.join(':') };
  });
  const count = items.length;
  const label = count === 1 ? basename(items[0].key) : `${count} items`;
  if (!confirm(`Delete ${label}? This cannot be undone.`)) return;

  try {
    for (const item of items) {
      if (item.type === 'f') {
        await api('delete_folder', { bucket: state.activeBucket, prefix: item.key });
      }
    }
    const objectKeys = items.filter((i) => i.type === 'o').map((i) => i.key);
    if (objectKeys.length > 0) {
      await api('delete_objects', { bucket: state.activeBucket, keys: objectKeys });
    }
    toast('success', `Deleted ${label}.`);
    state.selected.clear();
    await Promise.all([loadObjects(), loadStats()]);
  } catch { /* toast shown */ }
}

// ---------------------------------------------------------------
// Modals
// ---------------------------------------------------------------

function openModal(html) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div id="modalBackdrop" class="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4">
      <div id="modalPanel" class="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        ${html}
      </div>
    </div>`;
  document.getElementById('modalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modalBackdrop') closeModal();
  });
}

function closeModal() {
  document.getElementById('modalRoot').innerHTML = '';
}

function modalHeader(title) {
  return `
    <div class="flex items-center justify-between px-4 py-3 border-b border-slate-800">
      <h3 class="font-semibold text-slate-100">${escapeHtml(title)}</h3>
      <button data-close-modal class="text-slate-500 hover:text-slate-200">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

function wireModalClose() {
  document.querySelectorAll('[data-close-modal]').forEach((el) => el.addEventListener('click', closeModal));
}

// --- Upload modal ---

function openUploadModal() {
  openModal(`
    ${modalHeader('Upload Files')}
    <div class="p-4 space-y-3">
      <p class="text-xs text-slate-500">Target: <span class="text-slate-300">${escapeHtml(state.activeBucket)}/${escapeHtml(state.prefix)}</span></p>
      <div id="dropZone" class="border-2 border-dashed border-slate-700 rounded-lg p-8 text-center cursor-pointer hover:border-sky-500 transition">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-10 h-10 mx-auto text-slate-600 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
        <p class="text-sm text-slate-400">Drag files here or click to browse</p>
        <input type="file" id="fileInput" multiple class="hidden">
      </div>
      <div id="uploadProgressList" class="space-y-2 max-h-48 overflow-y-auto"></div>
    </div>
  `);
  wireModalClose();

  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => uploadFiles([...fileInput.files]));
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('border-sky-500'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-sky-500'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-sky-500');
    uploadFiles([...e.dataTransfer.files]);
  });
}

async function uploadFiles(files) {
  const list = document.getElementById('uploadProgressList');
  for (const file of files) {
    const key = state.prefix + file.name;
    const row = document.createElement('div');
    row.className = 'text-xs';
    row.innerHTML = `
      <div class="flex justify-between mb-1"><span class="truncate">${escapeHtml(file.name)}</span><span data-pct>0%</span></div>
      <div class="h-1.5 bg-slate-800 rounded-full overflow-hidden"><div data-bar class="h-full bg-sky-500 transition-all" style="width:0%"></div></div>`;
    list?.appendChild(row);
    const bar = row.querySelector('[data-bar]');
    const pct = row.querySelector('[data-pct]');
    try {
      await apiUpload(file, state.activeBucket, key, (p) => {
        if (bar) bar.style.width = p + '%';
        if (pct) pct.textContent = p + '%';
      });
      if (pct) pct.textContent = 'Done';
    } catch {
      if (pct) pct.textContent = 'Failed';
    }
  }
  toast('success', `Uploaded ${files.length} file(s).`);
  await Promise.all([loadObjects(), loadStats()]);
}

// --- New folder modal ---

function openNewFolderModal() {
  openModal(`
    ${modalHeader('New Folder')}
    <form id="newFolderForm" class="p-4 space-y-3">
      <label class="block text-xs text-slate-400">Folder name</label>
      <input type="text" id="newFolderName" class="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500" placeholder="reports" autofocus>
      <p id="newFolderError" class="text-xs text-red-400 hidden"></p>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" data-close-modal class="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs">Cancel</button>
        <button type="submit" class="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium">Create</button>
      </div>
    </form>
  `);
  wireModalClose();
  document.getElementById('newFolderName').focus();
  document.getElementById('newFolderForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('newFolderName').value;
    const errorEl = document.getElementById('newFolderError');
    if (!name || name.trim() !== name || name.includes('/') || name.trim() === '') {
      errorEl.textContent = 'Folder name must not be empty, have leading/trailing spaces, or contain slashes.';
      errorEl.classList.remove('hidden');
      return;
    }
    try {
      await api('create_folder', { bucket: state.activeBucket, prefix: state.prefix + name });
      toast('success', `Folder "${name}" created.`);
      closeModal();
      await Promise.all([loadObjects(), loadStats()]);
    } catch { /* toast shown */ }
  });
}

// --- Object info modal ---

async function openObjectInfoModal(key) {
  try {
    const info = await api('object_info', { bucket: state.activeBucket, key });
    openModal(`
      ${modalHeader('Object Info')}
      <div class="p-4 space-y-2 text-sm">
        ${infoRow('Key', info.key)}
        ${infoRow('ETag', info.etag)}
        ${infoRow('Size', formatBytes(info.size))}
        ${infoRow('Content-Type', info.content_type)}
        ${infoRow('Last Modified', formatDate(info.last_modified))}
        ${infoRow('Storage Class', info.storage_class)}
      </div>
    `);
    wireModalClose();
  } catch { /* toast shown */ }
}

function infoRow(label, value) {
  return `<div class="flex justify-between gap-4 border-b border-slate-800 pb-1.5"><span class="text-slate-500">${escapeHtml(label)}</span><span class="text-slate-200 text-right break-all">${escapeHtml(String(value))}</span></div>`;
}

// --- Presigned URL modal ---

function openPresignedUrlModal(key) {
  openModal(`
    ${modalHeader('Presigned URL')}
    <div class="p-4 space-y-3">
      <label class="block text-xs text-slate-400">Expiry</label>
      <select id="presignExpiry" class="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm">
        <option value="900">15 minutes</option>
        <option value="3600">1 hour</option>
        <option value="86400">24 hours</option>
        <option value="custom">Custom…</option>
      </select>
      <input type="number" id="presignCustom" class="hidden w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm" placeholder="Seconds">
      <button id="btnGeneratePresign" class="w-full px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium">Generate URL</button>
      <div id="presignResult" class="hidden space-y-2">
        <label class="block text-xs text-slate-400">Shareable URL</label>
        <div class="flex gap-2">
          <input type="text" id="presignUrlField" readonly class="flex-1 bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-xs">
          <button id="btnCopyPresign" class="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs">Copy</button>
        </div>
      </div>
    </div>
  `);
  wireModalClose();

  const select = document.getElementById('presignExpiry');
  const custom = document.getElementById('presignCustom');
  select.addEventListener('change', () => custom.classList.toggle('hidden', select.value !== 'custom'));

  document.getElementById('btnGeneratePresign').addEventListener('click', async () => {
    const expiry = select.value === 'custom' ? parseInt(custom.value || '900', 10) : parseInt(select.value, 10);
    try {
      const data = await api('presigned_url', { bucket: state.activeBucket, key, expiry_seconds: expiry });
      document.getElementById('presignResult').classList.remove('hidden');
      document.getElementById('presignUrlField').value = data.url;
    } catch { /* toast shown */ }
  });

  document.addEventListener('click', function copyHandler(e) {
    if (e.target.id === 'btnCopyPresign') {
      const field = document.getElementById('presignUrlField');
      field.select();
      navigator.clipboard.writeText(field.value).then(() => toast('success', 'URL copied to clipboard.'));
    }
  }, { once: false });
}

// --- Copy / Move modal ---

function openCopyMoveModal(key, mode) {
  openModal(`
    ${modalHeader(mode === 'copy' ? 'Copy Object' : 'Move Object')}
    <form id="copyMoveForm" class="p-4 space-y-3">
      <p class="text-xs text-slate-500">Source: <span class="text-slate-300">${escapeHtml(key)}</span></p>
      <label class="block text-xs text-slate-400">Destination key</label>
      <input type="text" id="destKey" value="${escapeHtml(key)}" class="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500">
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" data-close-modal class="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs">Cancel</button>
        <button type="submit" class="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium">${mode === 'copy' ? 'Copy' : 'Move'}</button>
      </div>
    </form>
  `);
  wireModalClose();
  const input = document.getElementById('destKey');
  input.focus();
  input.setSelectionRange(input.value.lastIndexOf('/') + 1, input.value.length);

  document.getElementById('copyMoveForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dstKey = input.value.trim();
    if (!dstKey) return;
    try {
      const action = mode === 'copy' ? 'copy_object' : 'move_object';
      await api(action, { bucket: state.activeBucket, src_key: key, dst_key: dstKey });
      toast('success', `${mode === 'copy' ? 'Copied' : 'Moved'} to ${dstKey}.`);
      closeModal();
      state.selected.clear();
      await Promise.all([loadObjects(), loadStats()]);
    } catch { /* toast shown */ }
  });
}

// --- Create bucket modal ---

function openCreateBucketModal() {
  openModal(`
    ${modalHeader('Create Bucket')}
    <form id="createBucketForm" class="p-4 space-y-3">
      <label class="block text-xs text-slate-400">Bucket name</label>
      <input type="text" id="newBucketName" class="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500" placeholder="my-new-bucket">
      <p id="bucketNameError" class="text-xs text-red-400 hidden"></p>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" data-close-modal class="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs">Cancel</button>
        <button type="submit" class="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium">Create</button>
      </div>
    </form>
  `);
  wireModalClose();
  document.getElementById('newBucketName').focus();
  document.getElementById('createBucketForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('newBucketName').value.trim();
    const errorEl = document.getElementById('bucketNameError');
    const valid = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name);
    if (!valid) {
      errorEl.textContent = 'Bucket names must be 3-63 chars, lowercase letters, numbers, dots, hyphens.';
      errorEl.classList.remove('hidden');
      return;
    }
    try {
      await api('create_bucket', { name });
      toast('success', `Bucket "${name}" created.`);
      closeModal();
      await loadBuckets();
      selectBucket(name);
    } catch { /* toast shown */ }
  });
}

// --- Config modal ---

async function openConfigModal() {
  let cfg = {};
  try {
    const data = await api('get_config');
    cfg = data.config;
  } catch { /* toast shown */ }

  openModal(`
    ${modalHeader('Configuration')}
    <form id="configForm" class="p-4 space-y-3">
      ${configField('endpoint', 'Endpoint', cfg.endpoint)}
      ${configField('region', 'Region', cfg.region)}
      ${configField('bucket', 'Default Bucket', cfg.bucket)}
      ${configField('access_key', 'Access Key', cfg.access_key)}
      ${configField('secret_key', 'Secret Key', '', 'password')}
      <label class="flex items-center gap-2 text-xs text-slate-400">
        <input type="checkbox" id="cfg_path_style" ${cfg.path_style ? 'checked' : ''} class="accent-sky-500">
        Use path-style endpoint (required for MinIO)
      </label>
      <div id="testConnResult" class="text-xs hidden"></div>
      <div class="flex justify-between items-center gap-2 pt-2">
        <button type="button" id="btnTestConnection" class="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs">Test Connection</button>
        <div class="flex gap-2">
          <button type="button" data-close-modal class="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs">Cancel</button>
          <button type="submit" class="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium">Save</button>
        </div>
      </div>
    </form>
  `);
  wireModalClose();

  document.getElementById('btnTestConnection').addEventListener('click', async () => {
    const resultEl = document.getElementById('testConnResult');
    resultEl.classList.remove('hidden');
    resultEl.textContent = 'Testing…';
    resultEl.className = 'text-xs text-slate-400';
    try {
      const data = await api('test_connection');
      resultEl.textContent = `Connected. ${data.buckets} bucket(s) visible.`;
      resultEl.className = 'text-xs text-emerald-400';
    } catch (err) {
      resultEl.textContent = `Failed: ${err.message}`;
      resultEl.className = 'text-xs text-red-400';
    }
  });

  document.getElementById('configForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      endpoint: document.getElementById('cfg_endpoint').value,
      region: document.getElementById('cfg_region').value,
      bucket: document.getElementById('cfg_bucket').value,
      access_key: document.getElementById('cfg_access_key').value,
      path_style: document.getElementById('cfg_path_style').checked,
    };
    const secret = document.getElementById('cfg_secret_key').value;
    if (secret) payload.secret_key = secret;
    try {
      await api('save_config', payload);
      toast('success', 'Configuration saved. Reloading…');
      closeModal();
      setTimeout(() => window.location.reload(), 800);
    } catch { /* toast shown */ }
  });
}

function configField(id, label, value, type = 'text') {
  return `
    <div>
      <label class="block text-xs text-slate-400 mb-1">${escapeHtml(label)}</label>
      <input type="${type}" id="cfg_${id}" value="${escapeHtml(value ?? '')}" class="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500" ${type === 'password' ? 'placeholder="•••••••• (leave blank to keep)"' : ''}>
    </div>`;
}

// ---------------------------------------------------------------
// Live log console
// ---------------------------------------------------------------

const LOG_COLORS = { DEBUG: 'text-slate-500', INFO: 'text-cyan-400', SUCCESS: 'text-emerald-400', ERROR: 'text-red-400' };

async function pollLogs() {
  try {
    const data = await api('get_logs', { lines: 100 });
    renderLogs(data.lines);
  } catch { /* silent — polling */ }
}

function renderLogs(lines) {
  const body = document.getElementById('logBody');
  const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 20;
  body.innerHTML = lines.map((line) => {
    const match = line.match(/\[([A-Z]+)\]/);
    const level = match ? match[1] : 'INFO';
    const cls = LOG_COLORS[level] || 'text-slate-400';
    return `<div class="${cls}">${escapeHtml(line)}</div>`;
  }).join('');
  if (atBottom) body.scrollTop = body.scrollHeight;
}

function startLogPolling() {
  pollLogs();
  state.logPollTimer = setInterval(pollLogs, 3000);
}

// ---------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------

function init() {
  document.getElementById('bucketSelect').addEventListener('change', (e) => selectBucket(e.target.value));
  document.getElementById('btnConfig').addEventListener('click', openConfigModal);
  document.getElementById('btnNewBucket').addEventListener('click', openCreateBucketModal);
  document.getElementById('btnUpload').addEventListener('click', () => {
    if (!state.activeBucket) { toast('warning', 'Select a bucket first.'); return; }
    openUploadModal();
  });
  document.getElementById('btnEmptyUpload').addEventListener('click', () => {
    if (!state.activeBucket) { toast('warning', 'Select a bucket first.'); return; }
    openUploadModal();
  });
  document.getElementById('btnNewFolder').addEventListener('click', () => {
    if (!state.activeBucket) { toast('warning', 'Select a bucket first.'); return; }
    openNewFolderModal();
  });
  document.getElementById('btnRefresh').addEventListener('click', () => { loadObjects(); loadStats(); });
  document.getElementById('btnViewGrid').addEventListener('click', () => setViewMode('grid'));
  document.getElementById('btnViewList').addEventListener('click', () => setViewMode('list'));

  document.getElementById('btnToggleLog').addEventListener('click', toggleLogConsole);
  document.getElementById('btnClearLog').addEventListener('click', () => { document.getElementById('logBody').innerHTML = ''; });
  document.getElementById('btnDownloadLog').addEventListener('click', () => {
    window.open('api.php?' + new URLSearchParams({ action: 'get_logs', lines: 100000 }), '_blank');
  });

  // Drag-and-drop upload onto main panel
  const mainPanel = document.getElementById('mainPanel');
  ['dragenter', 'dragover'].forEach((evt) => mainPanel.addEventListener(evt, (e) => {
    e.preventDefault();
    if (state.activeBucket) mainPanel.classList.add('drag-active');
  }));
  ['dragleave', 'drop'].forEach((evt) => mainPanel.addEventListener(evt, (e) => {
    e.preventDefault();
    mainPanel.classList.remove('drag-active');
  }));
  mainPanel.addEventListener('drop', (e) => {
    if (!state.activeBucket) { toast('warning', 'Select a bucket first.'); return; }
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length === 0) return;
    openUploadModal();
    setTimeout(() => uploadFiles(files), 50);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if (e.key === 'Escape') {
      closeModal();
      return;
    }
    if (typing) return;

    if (e.key === 'F5' || (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey)) {
      e.preventDefault();
      loadObjects();
      loadStats();
    }
    if (e.key === 'Delete' && state.selected.size > 0) {
      deleteSelected();
    }
  });

  startLogPolling();
  loadBuckets();
}

function setViewMode(mode) {
  state.viewMode = mode;
  document.getElementById('btnViewGrid').classList.toggle('bg-slate-800', mode === 'grid');
  document.getElementById('btnViewGrid').classList.toggle('text-sky-400', mode === 'grid');
  document.getElementById('btnViewGrid').classList.toggle('text-slate-400', mode !== 'grid');
  document.getElementById('btnViewList').classList.toggle('bg-slate-800', mode === 'list');
  document.getElementById('btnViewList').classList.toggle('text-sky-400', mode === 'list');
  document.getElementById('btnViewList').classList.toggle('text-slate-400', mode !== 'list');
  renderFiles();
}

function toggleLogConsole() {
  state.logCollapsed = !state.logCollapsed;
  const console_ = document.getElementById('logConsole');
  const icon = document.getElementById('logToggleIcon');
  if (state.logCollapsed) {
    console_.style.height = '34px';
    icon.style.transform = 'rotate(-90deg)';
    document.getElementById('logBody').classList.add('hidden');
  } else {
    console_.style.height = '180px';
    icon.style.transform = 'rotate(0deg)';
    document.getElementById('logBody').classList.remove('hidden');
  }
}

document.addEventListener('DOMContentLoaded', init);
