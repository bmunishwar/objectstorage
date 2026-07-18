// S3 Explorer — Permissions Matrix Demo: live-probes real per-user credentials against a bucket.
'use strict';

const OPERATION_LABELS = {
  list_buckets: 'List Buckets',
  list_objects: 'List Objects',
  read_object: 'Read Object',
  upload_object: 'Upload Object',
  delete_object: 'Delete Object',
  bucket_info: 'Bucket Info',
};

const state = {
  bucket: '',
  hasUsers: false,
};

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

async function checkRoster() {
  const notice = document.getElementById('rosterNotice');
  try {
    const data = await api('list_permission_users');
    state.hasUsers = data.users.length > 0;
    if (!state.hasUsers) {
      notice.classList.remove('hidden');
      notice.innerHTML = `No demo users configured yet. Add real credentials to <code class="text-amber-200">permission-users.local.php</code> in the app folder (see the doc comment in <code class="text-amber-200">permission-users.php</code> for the expected format), then reload this page.`;
    } else {
      notice.classList.add('hidden');
    }
  } catch {
    notice.classList.remove('hidden');
    notice.textContent = 'Could not load the demo-user roster.';
  }
}

async function runMatrix() {
  if (!state.bucket) {
    toast('warning', 'Select a bucket first.');
    return;
  }
  if (!state.hasUsers) {
    toast('warning', 'No demo users configured — see the notice above.');
    return;
  }

  const wrap = document.getElementById('matrixWrap');
  wrap.innerHTML = spinner();

  try {
    const data = await api('permission_matrix', { bucket: state.bucket });
    renderMatrix(data);
  } catch {
    wrap.innerHTML = `<p class="text-red-400 text-sm">Failed to run the permission matrix.</p>`;
  }
}

function renderMatrix(data) {
  const wrap = document.getElementById('matrixWrap');
  if (data.users.length === 0) {
    wrap.innerHTML = `<p class="text-slate-600 text-sm">No demo users configured.</p>`;
    return;
  }

  wrap.innerHTML = `
    <div class="border border-slate-800 rounded-lg overflow-x-auto">
      <table class="w-full text-sm border-collapse">
        <thead>
          <tr class="text-left text-slate-500 bg-slate-925 border-b border-slate-800">
            <th class="py-2.5 px-4">User</th>
            ${data.operations.map((op) => `<th class="py-2.5 px-4 text-center whitespace-nowrap">${escapeHtml(OPERATION_LABELS[op] || op)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${data.users.map((u) => `
            <tr class="border-b border-slate-900 last:border-0">
              <td class="py-2.5 px-4">
                <p class="text-slate-200">${escapeHtml(u.label)}</p>
                ${u.description ? `<p class="text-[11px] text-slate-500">${escapeHtml(u.description)}</p>` : ''}
              </td>
              ${data.operations.map((op) => cellHtml(data.matrix[u.key]?.[op])).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <p class="text-[11px] text-slate-600 mt-2">✓ allowed · ✗ denied (hover for the real error) · — untestable in current state. Upload/Delete probes use a self-cleaning <code>_permission_probe/</code> test key.</p>
  `;
}

function cellHtml(result) {
  if (!result) return `<td class="py-2.5 px-4 text-center text-slate-700">—</td>`;
  if (result.allowed === true) {
    return `<td class="py-2.5 px-4 text-center" title="OK (${result.elapsed_ms}ms)"><span class="text-emerald-400 font-medium">✓</span></td>`;
  }
  if (result.allowed === false) {
    return `<td class="py-2.5 px-4 text-center" title="${escapeHtml(result.message)}"><span class="text-red-400 font-medium">✗</span></td>`;
  }
  return `<td class="py-2.5 px-4 text-center text-slate-600" title="${escapeHtml(result.message)}">—</td>`;
}

function spinner() {
  return `<div class="flex items-center justify-center py-16"><svg class="spin w-6 h-6 text-sky-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M12 3a9 9 0 1 0 9 9" /></svg></div>`;
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('bucketSelect').addEventListener('change', (e) => { state.bucket = e.target.value; });
  document.getElementById('btnRunMatrix').addEventListener('click', runMatrix);

  await Promise.all([loadBuckets(), checkRoster()]);
  if (state.bucket && state.hasUsers) {
    runMatrix();
  }
});
