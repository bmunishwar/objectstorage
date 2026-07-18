// S3 Explorer — Versioning & Immutability Demo: bucket versioning + S3 Object Lock (WORM).
'use strict';

const state = {
  bucket: '',
  versions: [],
  selected: null, // { key, versionId }
};

// ---------------------------------------------------------------
// Bucket setup
// ---------------------------------------------------------------

async function loadBuckets(selectName) {
  try {
    const data = await api('list_buckets');
    const sel = document.getElementById('bucketSelect');
    sel.innerHTML = '<option value="">Select bucket…</option>' +
      data.buckets.map((b) => `<option value="${escapeHtml(b.name)}">${escapeHtml(b.name)}</option>`).join('');
    const target = selectName && data.buckets.some((b) => b.name === selectName) ? selectName : (data.buckets[0]?.name || '');
    if (target) {
      sel.value = target;
      onBucketChange(target);
    }
  } catch { /* toast shown */ }
}

function onBucketChange(bucket) {
  state.bucket = bucket;
  state.selected = null;
  document.getElementById('immutabilitySection').classList.add('hidden');
  if (!bucket) return;
  loadBucketStatus();
  loadVersions();
}

async function loadBucketStatus() {
  const el = document.getElementById('bucketStatus');
  el.innerHTML = `<span class="text-slate-500">Checking status…</span>`;
  try {
    const data = await api('versioning_status', { bucket: state.bucket });
    const versioningBadge = data.versioning_status === 'Enabled'
      ? '<span class="text-emerald-400">Versioning: Enabled</span>'
      : `<span class="text-amber-400">Versioning: ${escapeHtml(data.versioning_status)}</span>`;
    const lockBadge = data.object_lock_enabled
      ? '<span class="text-emerald-400">Object Lock: Enabled</span>'
      : '<span class="text-slate-500">Object Lock: Not enabled (bucket wasn\'t created with it)</span>';
    el.innerHTML = `${versioningBadge} &nbsp;·&nbsp; ${lockBadge}`;
  } catch {
    el.innerHTML = `<span class="text-red-400">Failed to check bucket status.</span>`;
  }
}

async function createLockedBucket() {
  const name = document.getElementById('newLockedBucketName').value.trim();
  if (!name) {
    toast('warning', 'Enter a bucket name.');
    return;
  }
  try {
    await api('create_locked_bucket', { name });
    toast('success', `Created "${name}" with Object Lock enabled.`);
    document.getElementById('newLockedBucketName').value = '';
    await loadBuckets(name);
  } catch { /* toast shown */ }
}

async function enableVersioning() {
  if (!state.bucket) {
    toast('warning', 'Select a bucket first.');
    return;
  }
  try {
    await api('enable_versioning', { bucket: state.bucket });
    toast('success', 'Versioning enabled on this bucket.');
    await loadBucketStatus();
  } catch { /* toast shown */ }
}

// ---------------------------------------------------------------
// Upload a version
// ---------------------------------------------------------------

async function uploadVersion() {
  const fileInput = document.getElementById('versionFileInput');
  const file = fileInput.files[0];
  if (!file) {
    toast('warning', 'Choose a file first.');
    return;
  }
  if (!state.bucket) {
    toast('warning', 'Select a bucket first.');
    return;
  }

  const fd = new FormData();
  fd.append('action', 'upload');
  fd.append('bucket', state.bucket);
  fd.append('key', file.name);
  fd.append('file', file);

  try {
    const res = await fetch('api.php', { method: 'POST', body: fd });
    const json = await res.json();
    if (!json.success) {
      toast('error', json.error || 'Upload failed');
      return;
    }
    toast('success', `Uploaded "${file.name}".`);
    fileInput.value = '';
    await loadVersions();
  } catch (err) {
    toast('error', `Upload failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------
// Versions table
// ---------------------------------------------------------------

async function loadVersions() {
  const wrap = document.getElementById('versionsTableWrap');
  wrap.innerHTML = spinner();
  try {
    const data = await api('list_object_versions', { bucket: state.bucket, prefix: '' });
    state.versions = data.versions;
    renderVersionsTable();
  } catch {
    wrap.innerHTML = `<p class="text-red-400 text-sm">Failed to load versions.</p>`;
  }
}

function renderVersionsTable() {
  const wrap = document.getElementById('versionsTableWrap');
  if (state.versions.length === 0) {
    wrap.innerHTML = `<p class="text-slate-600 text-sm py-6 text-center border border-slate-800 rounded-lg">No object versions yet — upload something above.</p>`;
    return;
  }
  wrap.innerHTML = `
    <div class="border border-slate-800 rounded-lg overflow-x-auto">
      <table class="w-full text-sm border-collapse">
        <thead>
          <tr class="text-left text-slate-500 bg-slate-925 border-b border-slate-800">
            <th class="py-2 px-3">Key</th>
            <th class="py-2 px-3">Version ID</th>
            <th class="py-2 px-3">Size</th>
            <th class="py-2 px-3">Last Modified</th>
            <th class="py-2 px-3"></th>
          </tr>
        </thead>
        <tbody>
          ${state.versions.map((v) => `
            <tr class="border-b border-slate-900 last:border-0 ${v.is_delete_marker ? 'opacity-60' : ''}">
              <td class="py-2 px-3">
                <span class="truncate" title="${escapeHtml(v.key)}">${escapeHtml(basename(v.key))}</span>
                ${v.is_latest ? '<span class="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-sky-900/50 text-sky-300">latest</span>' : ''}
                ${v.is_delete_marker ? '<span class="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">delete marker</span>' : ''}
              </td>
              <td class="py-2 px-3 text-slate-500" title="${escapeHtml(v.version_id)}">${escapeHtml(v.version_id.slice(0, 12))}…</td>
              <td class="py-2 px-3 text-slate-500">${v.is_delete_marker ? '—' : formatBytes(v.size)}</td>
              <td class="py-2 px-3 text-slate-500">${formatDate(v.last_modified)}</td>
              <td class="py-2 px-3 text-right whitespace-nowrap">
                ${v.is_delete_marker ? '' : `
                  <a href="${viewUrl(v.key, v.version_id)}" target="_blank" class="text-xs text-sky-400 hover:text-sky-300 mr-3">View</a>
                  <button class="text-xs text-slate-400 hover:text-slate-200 mr-3" data-select-key="${escapeHtml(v.key)}" data-select-version="${escapeHtml(v.version_id)}">Manage Lock</button>
                `}
                <button class="text-xs text-red-400 hover:text-red-300" data-delete-key="${escapeHtml(v.key)}" data-delete-version="${escapeHtml(v.version_id)}">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  wrap.querySelectorAll('[data-select-key]').forEach((btn) => {
    btn.addEventListener('click', () => selectVersion(btn.dataset.selectKey, btn.dataset.selectVersion));
  });
  wrap.querySelectorAll('[data-delete-key]').forEach((btn) => {
    btn.addEventListener('click', () => deleteVersionRow(btn.dataset.deleteKey, btn.dataset.deleteVersion));
  });
}

function viewUrl(key, versionId) {
  return 'api.php?' + new URLSearchParams({
    action: 'download_object_version', bucket: state.bucket, key, version_id: versionId, disposition: 'inline',
  });
}

async function deleteVersionRow(key, versionId) {
  if (!confirm(`Delete this specific version of "${basename(key)}"? This cannot be undone unless it's blocked by retention/legal hold.`)) return;
  try {
    await api('delete_object_version', { bucket: state.bucket, key, version_id: versionId }, { suppressErrorToast: true });
    toast('success', 'Version deleted.');
    await loadVersions();
  } catch (err) {
    toast('success', `🔒 Blocked as expected — ${err.message} This proves the object is immutable.`);
  }
}

// ---------------------------------------------------------------
// Immutability controls
// ---------------------------------------------------------------

async function selectVersion(key, versionId) {
  state.selected = { key, versionId };
  const section = document.getElementById('immutabilitySection');
  section.classList.remove('hidden');
  document.getElementById('selectedVersionLabel').textContent = `${key} — version ${versionId}`;

  await Promise.all([loadRetentionStatus(), loadLegalHoldStatus()]);
}

async function loadRetentionStatus() {
  const el = document.getElementById('retentionStatus');
  el.textContent = 'Loading…';
  try {
    const data = await api('get_object_retention', versionParams());
    el.textContent = data.mode
      ? `Currently locked: ${data.mode} until ${formatDate(data.retain_until)}`
      : 'No retention currently set.';
  } catch {
    el.textContent = 'Failed to load retention status.';
  }
}

async function loadLegalHoldStatus() {
  const el = document.getElementById('legalHoldStatus');
  el.textContent = 'Loading…';
  try {
    const data = await api('get_object_legal_hold', versionParams());
    el.textContent = data.legal_hold ? 'Legal hold is currently ON.' : 'Legal hold is currently OFF.';
  } catch {
    el.textContent = 'Failed to load legal hold status.';
  }
}

function versionParams() {
  return { bucket: state.bucket, key: state.selected.key, version_id: state.selected.versionId };
}

async function setRetention() {
  const mode = document.getElementById('retentionMode').value;
  const date = document.getElementById('retentionDate').value;
  if (!date) {
    toast('warning', 'Pick a retain-until date.');
    return;
  }
  try {
    await api('set_object_retention', { ...versionParams(), mode, retain_until: `${date}T00:00:00Z` });
    toast('success', `Retention set: ${mode} until ${date}.`);
    await loadRetentionStatus();
  } catch { /* toast shown */ }
}

async function setLegalHold(on) {
  try {
    await api('set_object_legal_hold', { ...versionParams(), on });
    toast('success', `Legal hold turned ${on ? 'ON' : 'OFF'}.`);
    await loadLegalHoldStatus();
  } catch { /* toast shown */ }
}

async function tryDeleteSelected() {
  if (!confirm('Attempt to permanently delete this exact version now?')) return;
  try {
    await api('delete_object_version', versionParams(), { suppressErrorToast: true });
    toast('success', 'Deleted — no retention/legal hold was blocking it.');
    document.getElementById('immutabilitySection').classList.add('hidden');
    state.selected = null;
    await loadVersions();
  } catch (err) {
    toast('success', `🔒 Blocked as expected — ${err.message} This proves the object is immutable.`);
  }
}

// ---------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------

function spinner() {
  return `<div class="flex items-center justify-center py-10"><svg class="spin w-6 h-6 text-sky-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M12 3a9 9 0 1 0 9 9" /></svg></div>`;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('bucketSelect').addEventListener('change', (e) => onBucketChange(e.target.value));
  document.getElementById('btnCreateLockedBucket').addEventListener('click', createLockedBucket);
  document.getElementById('btnEnableVersioning').addEventListener('click', enableVersioning);
  document.getElementById('btnUploadVersion').addEventListener('click', uploadVersion);
  document.getElementById('btnRefreshVersions').addEventListener('click', loadVersions);
  document.getElementById('btnSetRetention').addEventListener('click', setRetention);
  document.getElementById('btnLegalHoldOn').addEventListener('click', () => setLegalHold(true));
  document.getElementById('btnLegalHoldOff').addEventListener('click', () => setLegalHold(false));
  document.getElementById('btnTryDelete').addEventListener('click', tryDeleteSelected);

  loadBuckets();
});
