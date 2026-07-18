// S3 Explorer — Admin dashboard: buckets -> bucket detail -> object detail drill-down.
'use strict';

const adminState = {
  view: 'buckets', // 'buckets' | 'bucket' | 'object'
  bucket: '',
  key: '',
  objects: [],
  nextToken: null,
  isTruncated: false,
  prefixFilter: '',
  loadingMore: false,
};

// ---------------------------------------------------------------
// Navigation (view state <-> URL, so links/back-button work)
// ---------------------------------------------------------------

function navigate(view, params = {}, pushHistory = true) {
  adminState.view = view;
  adminState.bucket = params.bucket ?? '';
  adminState.key = params.key ?? '';

  if (pushHistory) {
    const qs = new URLSearchParams({ view, ...(adminState.bucket ? { bucket: adminState.bucket } : {}), ...(adminState.key ? { key: adminState.key } : {}) });
    history.pushState({ view, bucket: adminState.bucket, key: adminState.key }, '', `admin.php?${qs}`);
  }

  render();
}

window.addEventListener('popstate', (e) => {
  const s = e.state || { view: 'buckets' };
  navigate(s.view, { bucket: s.bucket, key: s.key }, false);
});

function initFromLocation() {
  const qs = new URLSearchParams(window.location.search);
  const view = qs.get('view') || 'buckets';
  navigate(view, { bucket: qs.get('bucket') || '', key: qs.get('key') || '' }, false);
}

// ---------------------------------------------------------------
// Breadcrumb
// ---------------------------------------------------------------

function renderBreadcrumb() {
  const el = document.getElementById('adminBreadcrumb');
  let html = `<button class="hover:text-sky-400 font-medium ${adminState.view === 'buckets' ? 'text-slate-100' : ''}" data-nav="buckets">All Buckets</button>`;
  if (adminState.bucket) {
    html += `<span class="text-slate-600 px-1">/</span><button class="hover:text-sky-400 font-medium ${adminState.view === 'bucket' ? 'text-slate-100' : ''}" data-nav="bucket">${escapeHtml(adminState.bucket)}</button>`;
  }
  if (adminState.key) {
    html += `<span class="text-slate-600 px-1">/</span><span class="text-slate-100 truncate max-w-md" title="${escapeHtml(adminState.key)}">${escapeHtml(basename(adminState.key))}</span>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.nav === 'buckets') navigate('buckets');
      else if (btn.dataset.nav === 'bucket') navigate('bucket', { bucket: adminState.bucket });
    });
  });
}

// ---------------------------------------------------------------
// Root render dispatch
// ---------------------------------------------------------------

function render() {
  renderBreadcrumb();
  if (adminState.view === 'bucket' && adminState.bucket) renderBucketView();
  else if (adminState.view === 'object' && adminState.bucket && adminState.key) renderObjectView();
  else renderBucketsView();
}

function spinner() {
  return `<div class="flex items-center justify-center py-16"><svg class="spin w-6 h-6 text-sky-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M12 3a9 9 0 1 0 9 9" /></svg></div>`;
}

// ---------------------------------------------------------------
// View 1: All buckets
// ---------------------------------------------------------------

async function renderBucketsView() {
  const content = document.getElementById('adminContent');
  content.innerHTML = `
    <h1 class="text-lg font-semibold text-slate-100 mb-1">All Buckets</h1>
    <p class="text-slate-500 text-xs mb-4">Click a bucket to see its stats, metadata, and object listing.</p>
    <div id="bucketsTableWrap">${spinner()}</div>
  `;

  try {
    const data = await api('list_buckets');
    const wrap = document.getElementById('bucketsTableWrap');
    if (data.buckets.length === 0) {
      wrap.innerHTML = `<p class="text-slate-500 text-sm">No buckets found in this account.</p>`;
      return;
    }
    wrap.innerHTML = `
      <div class="border border-slate-800 rounded-lg overflow-hidden">
        <table class="w-full text-sm border-collapse">
          <thead>
            <tr class="text-left text-slate-500 bg-slate-925 border-b border-slate-800">
              <th class="py-2.5 px-4">Bucket Name</th>
              <th class="py-2.5 px-4">Created</th>
              <th class="py-2.5 px-4 w-24"></th>
            </tr>
          </thead>
          <tbody>
            ${data.buckets.map((b) => `
              <tr class="border-b border-slate-900 last:border-0 hover:bg-slate-900 cursor-pointer" data-bucket="${escapeHtml(b.name)}">
                <td class="py-2.5 px-4 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-sky-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>
                  <span class="text-slate-200">${escapeHtml(b.name)}</span>
                </td>
                <td class="py-2.5 px-4 text-slate-500">${formatDate(b.creation_date)}</td>
                <td class="py-2.5 px-4 text-sky-400 text-xs">View →</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    wrap.querySelectorAll('[data-bucket]').forEach((row) => {
      row.addEventListener('click', () => navigate('bucket', { bucket: row.dataset.bucket }));
    });
  } catch {
    document.getElementById('bucketsTableWrap').innerHTML = `<p class="text-red-400 text-sm">Failed to load buckets.</p>`;
  }
}

// ---------------------------------------------------------------
// View 2: Bucket detail — metadata + stats + object listing
// ---------------------------------------------------------------

async function renderBucketView() {
  const bucket = adminState.bucket;
  const content = document.getElementById('adminContent');
  content.innerHTML = `
    <h1 class="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>
      ${escapeHtml(bucket)}
    </h1>
    <div id="bucketMeta" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">${spinner()}</div>
    <div id="bucketAcl" class="flex items-center gap-2 mb-6"></div>
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-sm font-semibold text-slate-300">Objects</h2>
      <input type="text" id="prefixFilter" value="${escapeHtml(adminState.prefixFilter)}" placeholder="Filter by prefix…" class="bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1 text-xs w-56 focus:outline-none focus:ring-1 focus:ring-sky-500">
    </div>
    <div id="objectsTableWrap">${spinner()}</div>
  `;

  document.getElementById('prefixFilter').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      adminState.prefixFilter = e.target.value;
      loadObjectsPage(bucket, true);
    }
  });

  const metaEl = document.getElementById('bucketMeta');
  try {
    const [info, size, stats] = await Promise.all([
      api('bucket_info', { name: bucket }),
      api('bucket_size', { name: bucket }),
      api('storage_stats', { bucket }),
    ]);
    metaEl.innerHTML = [
      metaCard('Region', info.region),
      metaCard('Versioning', info.versioning),
      metaCard('Created', formatDate(info.creation_date)),
      metaCard('Total Size', formatBytes(size.total_bytes)),
      metaCard('Objects', size.object_count.toLocaleString()),
      metaCard('Folders', stats.folder_count.toLocaleString()),
    ].join('');
  } catch {
    metaEl.innerHTML = `<p class="text-red-400 text-sm col-span-full">Failed to load bucket metadata.</p>`;
  }

  renderBucketAcl(bucket);
  await loadObjectsPage(bucket, true);
}

function renderBucketAcl(bucket) {
  const el = document.getElementById('bucketAcl');
  el.innerHTML = `
    <span class="text-xs text-slate-500">Bucket visibility:</span>
    <select id="aclSelect" class="bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500">
      <option value="private">Private</option>
      <option value="public-read">Public Read</option>
    </select>
    <button id="btnApplyAcl" class="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium">Apply</button>
  `;
  document.getElementById('btnApplyAcl').addEventListener('click', async () => {
    const acl = document.getElementById('aclSelect').value;
    if (!confirm(`Set bucket "${bucket}" ACL to "${acl}"?`)) return;
    try {
      await api('set_bucket_acl', { name: bucket, acl });
      toast('success', `Bucket ACL set to "${acl}".`);
    } catch { /* toast shown */ }
  });
}

function metaCard(label, value) {
  return `
    <div class="border border-slate-800 rounded-lg p-3 bg-slate-925">
      <p class="text-[10px] uppercase tracking-wider text-slate-500 mb-1">${escapeHtml(label)}</p>
      <p class="text-slate-100 font-medium truncate" title="${escapeHtml(String(value))}">${escapeHtml(String(value))}</p>
    </div>`;
}

async function loadObjectsPage(bucket, reset) {
  if (reset) {
    adminState.objects = [];
    adminState.nextToken = null;
    adminState.isTruncated = false;
  }
  const wrap = document.getElementById('objectsTableWrap');
  if (reset) wrap.innerHTML = spinner();

  try {
    const data = await api('admin_list_objects', {
      bucket,
      prefix: adminState.prefixFilter,
      continuation_token: adminState.nextToken || '',
      max_keys: 500,
    });
    adminState.objects = adminState.objects.concat(data.files);
    adminState.nextToken = data.next_token;
    adminState.isTruncated = data.is_truncated;
    renderObjectsTable();
  } catch {
    wrap.innerHTML = `<p class="text-red-400 text-sm">Failed to load objects.</p>`;
  }
}

function renderObjectsTable() {
  const wrap = document.getElementById('objectsTableWrap');
  if (adminState.objects.length === 0) {
    wrap.innerHTML = `<p class="text-slate-500 text-sm py-6 text-center border border-slate-800 rounded-lg">No objects found${adminState.prefixFilter ? ` for prefix "${escapeHtml(adminState.prefixFilter)}"` : ''}.</p>`;
    return;
  }
  wrap.innerHTML = `
    <div class="border border-slate-800 rounded-lg overflow-hidden">
      <table class="w-full text-sm border-collapse">
        <thead>
          <tr class="text-left text-slate-500 bg-slate-925 border-b border-slate-800">
            <th class="py-2.5 px-4">Key</th>
            <th class="py-2.5 px-4">Size</th>
            <th class="py-2.5 px-4">Last Modified</th>
            <th class="py-2.5 px-4">Storage Class</th>
          </tr>
        </thead>
        <tbody>
          ${adminState.objects.map((f) => `
            <tr class="border-b border-slate-900 last:border-0 hover:bg-slate-900 cursor-pointer" data-key="${escapeHtml(f.key)}">
              <td class="py-2 px-4 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-slate-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m5.231 13.481L15 17.25m-1.519-3.129L12 14.25m2.481-3.129L18 14.25M8.25 3H6.75a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 6.75 21h10.5a2.25 2.25 0 0 0 2.25-2.25V11.25a9 9 0 0 0-9-9Z" /></svg>
                <span class="truncate max-w-lg" title="${escapeHtml(f.key)}">${escapeHtml(f.key)}</span>
              </td>
              <td class="py-2 px-4 text-slate-500">${formatBytes(f.size)}</td>
              <td class="py-2 px-4 text-slate-500">${formatDate(f.last_modified)}</td>
              <td class="py-2 px-4 text-slate-500">${escapeHtml(f.storage_class)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${adminState.isTruncated ? `<div class="p-3 text-center border-t border-slate-800"><button id="btnLoadMore" class="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium">Load more</button></div>` : ''}
    </div>
    <p class="text-xs text-slate-600 mt-2">${adminState.objects.length.toLocaleString()} object(s) loaded${adminState.isTruncated ? ' (more available)' : ''}.</p>
  `;

  wrap.querySelectorAll('[data-key]').forEach((row) => {
    row.addEventListener('click', () => navigate('object', { bucket: adminState.bucket, key: row.dataset.key }));
  });

  const loadMoreBtn = document.getElementById('btnLoadMore');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', async () => {
      loadMoreBtn.textContent = 'Loading…';
      loadMoreBtn.disabled = true;
      await loadObjectsPage(adminState.bucket, false);
    });
  }
}

// ---------------------------------------------------------------
// View 3: Object detail — full stats + inline preview
// ---------------------------------------------------------------

async function renderObjectView() {
  const { bucket, key } = adminState;
  const content = document.getElementById('adminContent');
  content.innerHTML = `
    <h1 class="text-lg font-semibold text-slate-100 mb-4 break-all">${escapeHtml(basename(key))}</h1>
    <div class="grid grid-cols-1 lg:grid-cols-5 gap-5">
      <div class="lg:col-span-2 space-y-4">
        <div id="objectMeta" class="border border-slate-800 rounded-lg p-4 bg-slate-925 space-y-2">${spinner()}</div>
        <div id="objectActions" class="flex flex-wrap gap-2"></div>
      </div>
      <div class="lg:col-span-3">
        <h2 class="text-sm font-semibold text-slate-300 mb-2">Preview</h2>
        <div id="objectPreview" class="border border-slate-800 rounded-lg bg-slate-925 min-h-[240px] flex items-center justify-center overflow-hidden">${spinner()}</div>
      </div>
    </div>
  `;

  const metaEl = document.getElementById('objectMeta');
  const actionsEl = document.getElementById('objectActions');
  const previewEl = document.getElementById('objectPreview');

  let info;
  try {
    info = await api('object_info', { bucket, key });
  } catch {
    metaEl.innerHTML = `<p class="text-red-400 text-sm">Failed to load object info.</p>`;
    previewEl.innerHTML = `<p class="text-red-400 text-sm">Unavailable.</p>`;
    return;
  }

  metaEl.innerHTML = [
    infoRow('Key', info.key),
    infoRow('Bucket', bucket),
    infoRow('Size', formatBytes(info.size)),
    infoRow('Content-Type', info.content_type),
    infoRow('ETag', info.etag),
    infoRow('Last Modified', formatDate(info.last_modified)),
    infoRow('Storage Class', info.storage_class),
  ].join('');

  const downloadUrl = 'api.php?' + new URLSearchParams({ action: 'download', bucket, key });
  const inlineUrl = 'api.php?' + new URLSearchParams({ action: 'download', bucket, key, disposition: 'inline' });

  actionsEl.innerHTML = `
    <a href="${downloadUrl}" class="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium">Download</a>
    <button id="btnAdminPresign" class="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium">Copy Presigned URL</button>
    <button id="btnAdminDelete" class="px-3 py-1.5 rounded-md bg-red-900/40 hover:bg-red-900/70 text-red-300 text-xs font-medium">Delete</button>
  `;

  document.getElementById('btnAdminPresign').addEventListener('click', async () => {
    try {
      const data = await api('presigned_url', { bucket, key, expiry_seconds: 3600 });
      await navigator.clipboard.writeText(data.url);
      toast('success', 'Presigned URL copied to clipboard (1h expiry).');
    } catch { /* toast shown */ }
  });

  document.getElementById('btnAdminDelete').addEventListener('click', async () => {
    if (!confirm(`Delete "${key}"? This cannot be undone.`)) return;
    try {
      await api('delete_object', { bucket, key });
      toast('success', 'Object deleted.');
      navigate('bucket', { bucket });
    } catch { /* toast shown */ }
  });

  renderPreview(previewEl, info, inlineUrl);
}

function infoRow(label, value) {
  return `<div class="flex justify-between gap-4 border-b border-slate-800/60 pb-1.5 last:border-0 last:pb-0"><span class="text-slate-500 shrink-0">${escapeHtml(label)}</span><span class="text-slate-200 text-right break-all">${escapeHtml(String(value))}</span></div>`;
}

// renderPreview() lives in common.js (shared with large-upload.js).

document.addEventListener('DOMContentLoaded', initFromLocation);
