// S3 Explorer — Large Upload Demo: direct browser-to-S3 upload via presigned URLs
// (single PUT for small files, chunked multipart for large ones). The PHP backend
// only ever signs URLs with the real AWS credentials — file bytes flow straight
// from this browser to the S3-compatible endpoint, never through our server.
'use strict';

// Mirrors config.php's defaults; the server remains the authoritative check either way.
const SMALL_FILE_THRESHOLD = 8 * 1024 * 1024; // 8MB
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024; // 5GB
const PART_CONCURRENCY = 4;
const PART_MAX_ATTEMPTS = 3;

const state = {
  bucket: '',
  buckets: [],
  files: [],
  selectedKey: null,
};

// ---------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------

async function loadBuckets() {
  try {
    const data = await api('list_buckets');
    state.buckets = data.buckets;
    const sel = document.getElementById('bucketSelect');
    sel.innerHTML = '<option value="">Select bucket…</option>' +
      state.buckets.map((b) => `<option value="${escapeHtml(b.name)}">${escapeHtml(b.name)}</option>`).join('');
    if (state.buckets.length > 0) {
      sel.value = state.buckets[0].name;
      onBucketChange(state.buckets[0].name);
    }
  } catch { /* toast shown */ }
}

function onBucketChange(bucket) {
  state.bucket = bucket;
  state.selectedKey = null;
  resetPreview();
  if (!bucket) return;
  checkCors(bucket);
  loadFileList(bucket);
}

// ---------------------------------------------------------------
// CORS status banner
// ---------------------------------------------------------------

async function checkCors(bucket) {
  const banner = document.getElementById('corsBanner');
  banner.classList.remove('hidden');
  banner.className = 'mb-4 border rounded-lg px-4 py-3 text-sm border-slate-700 bg-slate-900 text-slate-400';
  banner.textContent = 'Checking bucket CORS configuration…';

  try {
    const data = await api('cors_status', { bucket });
    if (data.configured) {
      banner.className = 'mb-4 border rounded-lg px-4 py-3 text-sm border-emerald-800 bg-emerald-950/40 text-emerald-300';
      banner.textContent = 'CORS is configured on this bucket — direct browser-to-S3 uploads should work.';
    } else {
      banner.className = 'mb-4 border rounded-lg px-4 py-3 text-sm border-amber-800 bg-amber-950/40 text-amber-300 flex items-center justify-between gap-3 flex-wrap';
      banner.innerHTML = `
        <span>This bucket has no CORS rule — direct browser uploads will fail with a network/CORS error until one is added.</span>
        <button id="btnFixCors" class="px-3 py-1.5 rounded-md bg-amber-800/60 hover:bg-amber-800 text-amber-100 text-xs font-medium shrink-0">Fix CORS automatically</button>
      `;
      document.getElementById('btnFixCors').addEventListener('click', fixCors);
    }
  } catch (err) {
    banner.className = 'mb-4 border rounded-lg px-4 py-3 text-sm border-red-800 bg-red-950/40 text-red-300';
    banner.textContent = `Could not check CORS status: ${err.message}`;
  }
}

async function fixCors() {
  try {
    await api('enable_cors', { bucket: state.bucket, origin: window.location.origin });
    toast('success', 'CORS rule added for this origin.');
    await checkCors(state.bucket);
  } catch { /* toast shown */ }
}

// ---------------------------------------------------------------
// File list
// ---------------------------------------------------------------

async function loadFileList(bucket) {
  const wrap = document.getElementById('fileListWrap');
  wrap.innerHTML = `<p class="text-slate-600 text-sm py-4 text-center">Loading…</p>`;
  try {
    const data = await api('list_objects', { bucket, prefix: 'large-uploads/', delimiter: '' });
    state.files = data.files;
    renderFileList();
  } catch {
    wrap.innerHTML = `<p class="text-red-400 text-sm py-4 text-center">Failed to load files.</p>`;
  }
}

function renderFileList() {
  const wrap = document.getElementById('fileListWrap');
  if (state.files.length === 0) {
    wrap.innerHTML = `<p class="text-slate-600 text-sm py-6 text-center border border-slate-800 rounded-lg">No files uploaded yet.</p>`;
    return;
  }
  wrap.innerHTML = `
    <div class="border border-slate-800 rounded-lg overflow-hidden divide-y divide-slate-900">
      ${state.files.map((f) => `
        <div class="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-900 cursor-pointer ${f.key === state.selectedKey ? 'bg-sky-600/10' : ''}" data-key="${escapeHtml(f.key)}">
          <div class="min-w-0">
            <p class="truncate text-slate-200" title="${escapeHtml(f.key)}">${escapeHtml(basename(f.key))}</p>
            <p class="text-[11px] text-slate-500">${formatBytes(f.size)} · ${formatDate(f.last_modified)}</p>
          </div>
          <button class="shrink-0 p-1 rounded hover:bg-red-900/50 text-slate-500 hover:text-red-400" data-delete-key="${escapeHtml(f.key)}" title="Delete">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      `).join('')}
    </div>
  `;
  wrap.querySelectorAll('[data-key]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-delete-key]')) return;
      viewFile(row.dataset.key);
    });
  });
  wrap.querySelectorAll('[data-delete-key]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteFile(btn.dataset.deleteKey);
    });
  });
}

async function deleteFile(key) {
  if (!confirm(`Delete "${basename(key)}"? This cannot be undone.`)) return;
  try {
    await api('delete_object', { bucket: state.bucket, key });
    toast('success', 'File deleted.');
    if (state.selectedKey === key) resetPreview();
    await loadFileList(state.bucket);
  } catch { /* toast shown */ }
}

// ---------------------------------------------------------------
// Preview
// ---------------------------------------------------------------

function resetPreview() {
  state.selectedKey = null;
  document.getElementById('fileMeta').classList.add('hidden');
  document.getElementById('previewPanel').innerHTML = `<p class="text-slate-600 text-sm p-6 text-center">Upload or select a file to preview it here.</p>`;
}

async function viewFile(key) {
  state.selectedKey = key;
  renderFileList();

  const metaEl = document.getElementById('fileMeta');
  const previewEl = document.getElementById('previewPanel');
  metaEl.classList.remove('hidden');
  metaEl.innerHTML = `<p class="text-slate-500">Loading metadata…</p>`;
  previewEl.innerHTML = `<div class="flex items-center justify-center py-16"><svg class="spin w-6 h-6 text-sky-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M12 3a9 9 0 1 0 9 9" /></svg></div>`;

  try {
    const info = await api('object_info', { bucket: state.bucket, key });
    metaEl.innerHTML = `
      <div class="flex justify-between gap-3"><span class="text-slate-500">Key</span><span class="text-slate-200 text-right break-all">${escapeHtml(info.key)}</span></div>
      <div class="flex justify-between gap-3"><span class="text-slate-500">Size</span><span class="text-slate-200">${formatBytes(info.size)}</span></div>
      <div class="flex justify-between gap-3"><span class="text-slate-500">Content-Type</span><span class="text-slate-200">${escapeHtml(info.content_type)}</span></div>
      <div class="flex justify-between gap-3"><span class="text-slate-500">Last Modified</span><span class="text-slate-200">${formatDate(info.last_modified)}</span></div>
    `;
    const inlineUrl = 'api.php?' + new URLSearchParams({ action: 'download', bucket: state.bucket, key, disposition: 'inline' });
    renderPreview(previewEl, info, inlineUrl);
  } catch {
    metaEl.innerHTML = `<p class="text-red-400">Failed to load metadata.</p>`;
    previewEl.innerHTML = `<p class="text-red-400 text-sm p-6">Failed to load preview.</p>`;
  }
}

// ---------------------------------------------------------------
// Upload orchestration
// ---------------------------------------------------------------

function setProgressUI(visible, label, pct, detail) {
  const wrap = document.getElementById('uploadProgress');
  wrap.classList.toggle('hidden', !visible);
  if (!visible) return;
  document.getElementById('uploadProgressLabel').textContent = label;
  document.getElementById('uploadProgressPct').textContent = `${pct}%`;
  document.getElementById('uploadProgressBar').style.width = `${pct}%`;
  document.getElementById('uploadProgressDetail').textContent = detail || '';
}

async function handleFileSelected(file) {
  if (!state.bucket) {
    toast('warning', 'Select a bucket first.');
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    toast('error', `File is ${formatBytes(file.size)}, which exceeds the ${formatBytes(MAX_UPLOAD_BYTES)} demo limit.`);
    return;
  }

  const contentType = file.type || 'application/octet-stream';
  setProgressUI(true, file.name, 0, '');

  try {
    const key = file.size <= SMALL_FILE_THRESHOLD
      ? await uploadSmallFile(file, contentType)
      : await uploadLargeFile(file, contentType);

    toast('success', `Uploaded "${file.name}".`);
    setProgressUI(false);
    await loadFileList(state.bucket);
    await viewFile(key);
  } catch (err) {
    toast('error', `Upload failed: ${err.message}`);
    setProgressUI(false);
  }
}

/** Small-file path: one presigned PUT, uploaded directly to the S3 endpoint. */
async function uploadSmallFile(file, contentType) {
  const presign = await api('presign_put', {
    bucket: state.bucket,
    filename: file.name,
    content_type: contentType,
    size: file.size,
  });

  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presign.url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        setProgressUI(true, file.name, pct, `${formatBytes(e.loaded)} / ${formatBytes(e.total)}`);
      }
    });
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Upload failed with HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Network error during upload (check bucket CORS configuration)'));
    xhr.send(file);
  });

  return presign.key;
}

/** Large-file path: chunked multipart upload, parts sent directly to the S3 endpoint with limited concurrency. */
async function uploadLargeFile(file, contentType) {
  const init = await api('init_multipart_upload', {
    bucket: state.bucket,
    filename: file.name,
    content_type: contentType,
    size: file.size,
  });

  const partLoaded = new Map(init.parts.map((p) => [p.part_number, 0]));
  const updateProgress = () => {
    let loaded = 0;
    for (const v of partLoaded.values()) loaded += v;
    const pct = Math.min(100, Math.round((loaded / file.size) * 100));
    setProgressUI(true, file.name, pct, `${formatBytes(loaded)} / ${formatBytes(file.size)} — ${init.parts.length} parts`);
  };

  const completedParts = [];
  try {
    await runPool(init.parts, PART_CONCURRENCY, async (part) => {
      const etag = await uploadPartWithRetry(file, part, init.part_size, file.size, (loaded) => {
        partLoaded.set(part.part_number, loaded);
        updateProgress();
      });
      completedParts.push({ part_number: part.part_number, etag });
    });
  } catch (err) {
    await api('abort_multipart_upload', { bucket: state.bucket, key: init.key, upload_id: init.upload_id }).catch(() => {});
    throw err;
  }

  await api('complete_multipart_upload', {
    bucket: state.bucket,
    key: init.key,
    upload_id: init.upload_id,
    parts: completedParts,
  });

  return init.key;
}

/** Runs `worker` over `items` with at most `concurrency` in flight at once. */
async function runPool(items, concurrency, worker) {
  let index = 0;
  async function next() {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}

/** Uploads one multipart part with retry, returning its ETag (without surrounding quotes). */
async function uploadPartWithRetry(file, part, partSize, fileSize, onProgress) {
  const start = (part.part_number - 1) * partSize;
  const end = Math.min(start + partSize, fileSize);
  const blob = file.slice(start, end);

  let lastError;
  for (let attempt = 1; attempt <= PART_MAX_ATTEMPTS; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', part.url);
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) onProgress(e.loaded);
        });
        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(`Part ${part.part_number} failed with HTTP ${xhr.status}`));
            return;
          }
          const etag = (xhr.getResponseHeader('ETag') || '').replace(/"/g, '');
          if (!etag) {
            reject(new Error(`Part ${part.part_number} response was missing an ETag header — check that the bucket CORS rule exposes ETag.`));
            return;
          }
          onProgress(blob.size);
          resolve(etag);
        };
        xhr.onerror = () => reject(new Error(`Part ${part.part_number} network error (likely CORS)`));
        xhr.send(blob);
      });
    } catch (err) {
      lastError = err;
      onProgress(0);
      if (attempt < PART_MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------

function init() {
  document.getElementById('bucketSelect').addEventListener('change', (e) => onBucketChange(e.target.value));

  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFileSelected(fileInput.files[0]);
    fileInput.value = '';
  });

  const content = document.getElementById('uploadContent');
  ['dragenter', 'dragover'].forEach((evt) => content.addEventListener(evt, (e) => {
    e.preventDefault();
    if (state.bucket) content.classList.add('drag-active');
  }));
  ['dragleave', 'drop'].forEach((evt) => content.addEventListener(evt, (e) => {
    e.preventDefault();
    content.classList.remove('drag-active');
  }));
  content.addEventListener('drop', (e) => {
    if (!state.bucket) { toast('warning', 'Select a bucket first.'); return; }
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFileSelected(file);
  });

  loadBuckets();
}

document.addEventListener('DOMContentLoaded', init);
