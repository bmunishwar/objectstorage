// S3 Explorer — shared helpers used by both index.php (app.js) and admin.php (admin.js).
'use strict';

/** Calls the JSON API with an action and params, returns the parsed response data. */
async function api(action, params = {}) {
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
    toast('error', `Network error: ${err.message}`);
    throw err;
  }
  const json = await res.json();
  if (window.onApiResult) window.onApiResult(action, json.success, json.operation_ms ?? (performance.now() - start));
  if (!json.success) {
    toast('error', json.error || `${action} failed`);
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
