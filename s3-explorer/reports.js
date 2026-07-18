// S3 Explorer — Reports & Monitoring: operations/health + storage/capacity, current snapshot only.
'use strict';

// ---------------------------------------------------------------
// Operations & Health
// ---------------------------------------------------------------

async function loadOperationsReport() {
  const statsEl = document.getElementById('opsStats');
  const byOpEl = document.getElementById('opsByOperation');
  const errorsEl = document.getElementById('opsRecentErrors');
  statsEl.innerHTML = spinner();
  byOpEl.innerHTML = spinner();
  errorsEl.innerHTML = spinner();

  try {
    const data = await api('report_operations');

    statsEl.innerHTML = [
      metaCard('Total Operations', data.total_ops.toLocaleString()),
      metaCard('Success Rate', `${data.success_rate}%`),
      metaCard('Avg Latency', `${data.avg_latency_ms} ms`),
      metaCard('Failures', data.failure_count.toLocaleString()),
    ].join('');

    renderByOperation(byOpEl, data.by_operation);
    renderRecentErrors(errorsEl, data.recent_errors);
  } catch {
    statsEl.innerHTML = `<p class="text-red-400 text-sm col-span-full">Failed to load operations report.</p>`;
    byOpEl.innerHTML = '';
    errorsEl.innerHTML = '';
  }
}

function renderByOperation(el, byOperation) {
  const ops = Object.entries(byOperation);
  if (ops.length === 0) {
    el.innerHTML = `<p class="text-slate-600 text-sm py-4 text-center border border-slate-800 rounded-lg">No operations logged yet.</p>`;
    return;
  }
  const maxCount = Math.max(...ops.map(([, s]) => s.count));
  el.innerHTML = `
    <div class="border border-slate-800 rounded-lg p-3 space-y-3">
      ${ops.map(([op, s]) => {
        const successPct = s.count > 0 ? (s.success / maxCount) * 100 : 0;
        const failurePct = s.count > 0 ? (s.failure / maxCount) * 100 : 0;
        return `
          <div>
            <div class="flex justify-between text-xs mb-1">
              <span class="text-slate-300">${escapeHtml(op)}</span>
              <span class="text-slate-500">${s.count} · avg ${s.avg_ms}ms</span>
            </div>
            <div class="h-2 bg-slate-800 rounded-full overflow-hidden flex">
              <div class="h-full bg-emerald-500" style="width:${successPct}%"></div>
              <div class="h-full bg-red-500" style="width:${failurePct}%"></div>
            </div>
          </div>`;
      }).join('')}
    </div>
    <p class="text-[11px] text-slate-600 mt-2"><span class="inline-block w-2 h-2 bg-emerald-500 rounded-sm align-middle mr-1"></span>Success <span class="inline-block w-2 h-2 bg-red-500 rounded-sm align-middle ml-3 mr-1"></span>Failure — bar length relative to the busiest operation</p>
  `;
}

function renderRecentErrors(el, errors) {
  if (errors.length === 0) {
    el.innerHTML = `<p class="text-slate-600 text-sm py-4 text-center border border-slate-800 rounded-lg">No errors in the recent log window.</p>`;
    return;
  }
  el.innerHTML = `
    <div class="border border-slate-800 rounded-lg divide-y divide-slate-900 max-h-96 overflow-y-auto">
      ${errors.map((e) => `
        <div class="px-3 py-2 text-xs">
          <div class="flex justify-between gap-2 text-slate-500 mb-0.5">
            <span>${escapeHtml(e.operation)}</span>
            <span class="shrink-0">${escapeHtml(e.timestamp)}</span>
          </div>
          <p class="text-red-400 break-all">${escapeHtml(e.message)}</p>
        </div>
      `).join('')}
    </div>
  `;
}

// ---------------------------------------------------------------
// Storage & Capacity
// ---------------------------------------------------------------

async function loadStorageReport() {
  const statsEl = document.getElementById('storageStats');
  const bucketsEl = document.getElementById('bucketsBySize');
  statsEl.innerHTML = spinner();
  bucketsEl.innerHTML = spinner();

  try {
    const data = await api('report_storage');

    statsEl.innerHTML = [
      metaCard('Total Buckets', data.total_buckets.toLocaleString()),
      metaCard('Total Storage', formatBytes(data.total_bytes)),
      metaCard('Total Objects', data.total_objects.toLocaleString()),
    ].join('');

    renderBucketsBySize(bucketsEl, data.buckets);
  } catch {
    statsEl.innerHTML = `<p class="text-red-400 text-sm col-span-full">Failed to load storage report.</p>`;
    bucketsEl.innerHTML = '';
  }
}

function renderBucketsBySize(el, buckets) {
  if (buckets.length === 0) {
    el.innerHTML = `<p class="text-slate-600 text-sm py-4 text-center border border-slate-800 rounded-lg">No buckets found.</p>`;
    return;
  }
  const maxBytes = Math.max(...buckets.map((b) => b.total_bytes), 1);
  el.innerHTML = `
    <div class="border border-slate-800 rounded-lg p-3 space-y-3">
      ${buckets.map((b) => `
        <a href="admin.php?view=bucket&bucket=${encodeURIComponent(b.name)}" class="block hover:opacity-80 transition">
          <div class="flex justify-between text-xs mb-1">
            <span class="text-slate-300 truncate" title="${escapeHtml(b.name)}">${escapeHtml(b.name)}</span>
            <span class="text-slate-500 shrink-0">${formatBytes(b.total_bytes)} · ${b.object_count.toLocaleString()} objects</span>
          </div>
          <div class="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div class="h-full bg-sky-500" style="width:${(b.total_bytes / maxBytes) * 100}%"></div>
          </div>
        </a>
      `).join('')}
    </div>
  `;
}

// ---------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------

function spinner() {
  return `<div class="col-span-full flex items-center justify-center py-10"><svg class="spin w-6 h-6 text-sky-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M12 3a9 9 0 1 0 9 9" /></svg></div>`;
}

function refreshAll() {
  loadOperationsReport();
  loadStorageReport();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnRefreshReports').addEventListener('click', refreshAll);
  refreshAll();
});
