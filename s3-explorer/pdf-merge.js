// S3 Explorer — PDF Merge Demo: combine existing bucket PDFs and/or local uploads into one PDF, saved back to S3.
'use strict';

let nextItemId = 1;

const state = {
  bucket: '',
  bucketPdfs: [],
  mergeList: [], // ordered [{ id, type: 'existing'|'upload', label, bucket?, key?, file? }]
};

// ---------------------------------------------------------------
// Bucket + existing-PDF browsing
// ---------------------------------------------------------------

async function loadBuckets() {
  try {
    const data = await api('list_buckets');
    const sel = document.getElementById('bucketSelect');
    sel.innerHTML = '<option value="">Select bucket…</option>' +
      data.buckets.map((b) => `<option value="${escapeHtml(b.name)}">${escapeHtml(b.name)}</option>`).join('');
    if (data.buckets.length > 0) {
      sel.value = data.buckets[0].name;
      state.bucket = data.buckets[0].name;
    }
  } catch { /* toast shown */ }
}

async function loadBucketPdfs() {
  if (!state.bucket) {
    toast('warning', 'Select a bucket first.');
    return;
  }
  const wrap = document.getElementById('bucketPdfList');
  wrap.innerHTML = `<p class="text-slate-600 text-sm p-3">Loading…</p>`;
  try {
    const data = await api('list_objects', { bucket: state.bucket, prefix: '', delimiter: '' });
    state.bucketPdfs = data.files.filter((f) => f.key.toLowerCase().endsWith('.pdf'));
    renderBucketPdfList();
  } catch {
    wrap.innerHTML = `<p class="text-red-400 text-sm p-3">Failed to load objects.</p>`;
  }
}

function renderBucketPdfList() {
  const wrap = document.getElementById('bucketPdfList');
  if (state.bucketPdfs.length === 0) {
    wrap.innerHTML = `<p class="text-slate-600 text-sm p-3">No .pdf objects found in this bucket.</p>`;
    return;
  }
  wrap.innerHTML = state.bucketPdfs.map((f, i) => `
    <label class="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-900 cursor-pointer border-b border-slate-900 last:border-0">
      <input type="checkbox" class="accent-sky-500" data-pdf-index="${i}">
      <span class="truncate flex-1" title="${escapeHtml(f.key)}">${escapeHtml(basename(f.key))}</span>
      <span class="text-[11px] text-slate-500 shrink-0">${formatBytes(f.size)}</span>
    </label>
  `).join('');
}

function addSelectedToMergeList() {
  const checked = document.querySelectorAll('#bucketPdfList input[type="checkbox"]:checked');
  if (checked.length === 0) {
    toast('warning', 'Select at least one PDF to add.');
    return;
  }
  checked.forEach((cb) => {
    const f = state.bucketPdfs[Number(cb.dataset.pdfIndex)];
    state.mergeList.push({ id: nextItemId++, type: 'existing', label: basename(f.key), bucket: state.bucket, key: f.key });
  });
  renderMergeList();
  toast('success', `Added ${checked.length} file(s) to the merge list.`);
}

// ---------------------------------------------------------------
// Local file uploads
// ---------------------------------------------------------------

function addLocalFiles(files) {
  [...files].forEach((file) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast('warning', `Skipped "${file.name}" — not a PDF.`);
      return;
    }
    state.mergeList.push({ id: nextItemId++, type: 'upload', label: file.name, file });
  });
  renderMergeList();
}

// ---------------------------------------------------------------
// Merge list (reorderable)
// ---------------------------------------------------------------

function renderMergeList() {
  const wrap = document.getElementById('mergeListWrap');
  if (state.mergeList.length === 0) {
    wrap.innerHTML = `<p class="text-slate-600 text-sm py-6 text-center border border-slate-800 rounded-lg">No files added yet — pick some from the bucket or upload local files above.</p>`;
    return;
  }
  wrap.innerHTML = `
    <div class="border border-slate-800 rounded-lg divide-y divide-slate-900">
      ${state.mergeList.map((item, i) => `
        <div class="flex items-center gap-3 px-3 py-2">
          <span class="text-xs text-slate-600 w-5 text-right">${i + 1}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded shrink-0 ${item.type === 'existing' ? 'bg-sky-900/50 text-sky-300' : 'bg-emerald-900/50 text-emerald-300'}">${item.type === 'existing' ? 'Bucket' : 'Local'}</span>
          <span class="truncate flex-1" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
          <button class="text-slate-500 hover:text-slate-200 disabled:opacity-30" data-move="up" data-id="${item.id}" ${i === 0 ? 'disabled' : ''} title="Move up">▲</button>
          <button class="text-slate-500 hover:text-slate-200 disabled:opacity-30" data-move="down" data-id="${item.id}" ${i === state.mergeList.length - 1 ? 'disabled' : ''} title="Move down">▼</button>
          <button class="text-red-400 hover:text-red-300" data-remove data-id="${item.id}" title="Remove">✕</button>
        </div>
      `).join('')}
    </div>
  `;
  wrap.querySelectorAll('[data-move]').forEach((btn) => {
    btn.addEventListener('click', () => moveItem(Number(btn.dataset.id), btn.dataset.move));
  });
  wrap.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => removeItem(Number(btn.dataset.id)));
  });
}

function moveItem(id, direction) {
  const idx = state.mergeList.findIndex((i) => i.id === id);
  if (idx === -1) return;
  const swapWith = direction === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= state.mergeList.length) return;
  [state.mergeList[idx], state.mergeList[swapWith]] = [state.mergeList[swapWith], state.mergeList[idx]];
  renderMergeList();
}

function removeItem(id) {
  state.mergeList = state.mergeList.filter((i) => i.id !== id);
  renderMergeList();
}

// ---------------------------------------------------------------
// Merge
// ---------------------------------------------------------------

async function doMerge() {
  if (!state.bucket) {
    toast('warning', 'Select a destination bucket first.');
    return;
  }
  if (state.mergeList.length === 0) {
    toast('warning', 'Add at least one PDF to merge.');
    return;
  }

  const outputName = document.getElementById('outputName').value.trim() || 'merged.pdf';
  const resultEl = document.getElementById('mergeResult');
  resultEl.innerHTML = spinner();

  const fd = new FormData();
  fd.append('action', 'merge_pdfs');
  fd.append('bucket', state.bucket);
  fd.append('key', outputName);

  const itemsMeta = state.mergeList.map((item, i) => {
    if (item.type === 'existing') {
      return { type: 'existing', bucket: item.bucket, key: item.key };
    }
    const field = `file_${i}`;
    fd.append(field, item.file);
    return { type: 'upload', field };
  });
  fd.append('items', JSON.stringify(itemsMeta));

  try {
    const res = await fetch('api.php', { method: 'POST', body: fd });
    const json = await res.json();
    if (!json.success) {
      toast('error', json.error || 'Merge failed');
      resultEl.innerHTML = `<p class="text-red-400 text-sm">${escapeHtml(json.error || 'Merge failed.')}</p>`;
      return;
    }
    toast('success', `Merged ${json.data.page_count} page(s) into "${basename(json.data.key)}".`);
    renderMergeResult(json.data);
  } catch (err) {
    toast('error', `Merge failed: ${err.message}`);
    resultEl.innerHTML = `<p class="text-red-400 text-sm">${escapeHtml(err.message)}</p>`;
  }
}

function renderMergeResult(data) {
  const resultEl = document.getElementById('mergeResult');
  const inlineUrl = 'api.php?' + new URLSearchParams({ action: 'download', bucket: data.bucket, key: data.key, disposition: 'inline' });
  const downloadUrl = 'api.php?' + new URLSearchParams({ action: 'download', bucket: data.bucket, key: data.key });
  resultEl.innerHTML = `
    <div class="border border-emerald-800 bg-emerald-950/30 rounded-lg p-4 space-y-2">
      <p class="text-emerald-300 font-medium">Saved to ${escapeHtml(data.bucket)}/${escapeHtml(data.key)}</p>
      <p class="text-xs text-slate-400">${data.page_count} page(s) · ${formatBytes(data.size)}</p>
      <div class="flex gap-2">
        <a href="${inlineUrl}" target="_blank" class="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium">View</a>
        <a href="${downloadUrl}" class="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium">Download</a>
      </div>
    </div>
  `;
}

function spinner() {
  return `<div class="flex items-center justify-center py-6"><svg class="spin w-5 h-5 text-sky-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M12 3a9 9 0 1 0 9 9" /></svg></div>`;
}

// ---------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('bucketSelect').addEventListener('change', (e) => { state.bucket = e.target.value; });
  document.getElementById('btnLoadBucketPdfs').addEventListener('click', loadBucketPdfs);
  document.getElementById('btnAddSelected').addEventListener('click', addSelectedToMergeList);
  document.getElementById('btnMerge').addEventListener('click', doMerge);

  const dropZone = document.getElementById('localDropZone');
  const fileInput = document.getElementById('localFileInput');
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { addLocalFiles(fileInput.files); fileInput.value = ''; });
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('border-sky-500'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-sky-500'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-sky-500');
    addLocalFiles(e.dataTransfer.files);
  });

  loadBuckets();
  renderMergeList();
});
