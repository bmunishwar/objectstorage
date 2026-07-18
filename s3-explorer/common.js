// S3 Explorer — shared helpers used by both index.php (app.js) and admin.php (admin.js).
'use strict';

/**
 * Calls the JSON API with an action and params, returns the parsed response data.
 * Pass { suppressErrorToast: true } when the caller wants to render a failure itself
 * (e.g. the Versioning demo's "try to delete a locked version" button, where a denial
 * is the successful demo outcome, not a red error).
 */
async function api(action, params = {}, options = {}) {
  const start = performance.now();
  let res;
  try {
    res = await fetch('api.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...params }),
    });
  } catch (err) {
    if (window.onApiResult) window.onApiResult(action, false, performance.now() - start);
    if (!options.suppressErrorToast) toast('error', `Network error: ${err.message}`);
    throw err;
  }

  let json;
  try {
    json = await res.json();
  } catch {
    // Server returned something that isn't valid JSON (proxy error page, etc.) — surface it
    // through the same toast/tracking path as every other failure, not as an unhandled rejection.
    if (window.onApiResult) window.onApiResult(action, false, performance.now() - start);
    const message = `Unexpected response from server (HTTP ${res.status}).`;
    if (!options.suppressErrorToast) toast('error', message);
    throw new Error(message);
  }

  if (window.onApiResult) window.onApiResult(action, json.success, json.operation_ms ?? (performance.now() - start));
  if (!json.success) {
    if (!options.suppressErrorToast) toast('error', json.error || `${action} failed`);
    throw new Error(json.error || `${action} failed`);
  }
  return json.data;
}

/** Formats a byte count as a human-readable string (B/KB/MB/GB). */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Formats an ISO date string as a short readable date/time. */
function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Returns the last path segment (file/folder name) of a key. */
function basename(key) {
  const trimmed = key.replace(/\/$/, '');
  const parts = trimmed.split('/');
  return parts[parts.length - 1] || trimmed;
}

/** Escapes HTML special characters for safe interpolation into markup. */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

const TOAST_COLORS = {
  success: 'bg-emerald-950 border-emerald-700 text-emerald-200',
  error: 'bg-red-950 border-red-700 text-red-200',
  warning: 'bg-amber-950 border-amber-700 text-amber-200',
};

/** Shows a top-right toast notification that auto-dismisses after 4s. */
function toast(type, message) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast-enter border rounded-md px-3 py-2 text-sm shadow-lg ${TOAST_COLORS[type] || TOAST_COLORS.warning}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

/** Renders a small labeled stat tile, used by Admin's bucket-metadata grid and the Reports page. */
function metaCard(label, value) {
  return `
    <div class="border border-slate-800 rounded-lg p-3 bg-slate-925">
      <p class="text-[10px] uppercase tracking-wider text-slate-500 mb-1">${escapeHtml(label)}</p>
      <p class="text-slate-100 font-medium truncate" title="${escapeHtml(String(value))}">${escapeHtml(String(value))}</p>
    </div>`;
}

const TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024; // 2MB

/** Renders an inline preview of an object into `el` based on its content-type, falling back to a Download hint. */
async function renderPreview(el, info, inlineUrl) {
  const ct = (info.content_type || '').toLowerCase();

  if (ct.startsWith('image/')) {
    el.innerHTML = `<img src="${inlineUrl}" alt="${escapeHtml(basename(info.key))}" class="max-w-full max-h-[70vh] object-contain">`;
    return;
  }
  if (ct.startsWith('video/')) {
    el.innerHTML = `<video src="${inlineUrl}" controls class="max-w-full max-h-[70vh]"></video>`;
    return;
  }
  if (ct.startsWith('audio/')) {
    el.innerHTML = `<audio src="${inlineUrl}" controls class="w-full px-6"></audio>`;
    return;
  }
  if (ct === 'application/pdf') {
    el.innerHTML = `<iframe src="${inlineUrl}" class="w-full" style="height:70vh;"></iframe>`;
    return;
  }
  const isTextLike = ct.startsWith('text/') || ['application/json', 'application/xml', 'application/x-yaml', 'application/javascript'].includes(ct);
  if (isTextLike) {
    if (info.size > TEXT_PREVIEW_LIMIT) {
      el.innerHTML = `<p class="text-slate-500 text-sm p-6 text-center">File is ${formatBytes(info.size)} — too large to preview inline. Use Download instead.</p>`;
      return;
    }
    try {
      const res = await fetch(inlineUrl);
      const text = await res.text();
      el.innerHTML = `<pre class="text-xs text-slate-300 p-4 overflow-auto w-full max-h-[70vh] whitespace-pre-wrap break-all">${escapeHtml(text)}</pre>`;
    } catch {
      el.innerHTML = `<p class="text-red-400 text-sm p-6">Failed to load preview.</p>`;
    }
    return;
  }

  el.innerHTML = `<p class="text-slate-500 text-sm p-6 text-center">No inline preview available for <span class="text-slate-300">${escapeHtml(info.content_type)}</span>.<br>Use Download to view this file.</p>`;
}
