<?php

declare(strict_types=1);

/** Reports & Monitoring entry point: operations/health + storage/capacity, current-snapshot only. */
?>
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>S3 Explorer — Reports</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = { darkMode: 'class' };
</script>
<style>
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: #475569; }
  .toast-enter { animation: toastIn 0.2s ease-out; }
  @keyframes toastIn { from { opacity: 0; transform: translateX(1rem); } to { opacity: 1; transform: translateX(0); } }
  .spin { animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body class="bg-slate-950 text-slate-200 h-screen flex flex-col overflow-hidden font-sans text-sm">

<!-- Header -->
<header class="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-925 shrink-0">
  <div class="flex items-center gap-2">
    <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    </svg>
    <span class="font-semibold text-slate-100 tracking-tight">S3 Explorer — Reports &amp; Monitoring</span>
  </div>
  <div class="flex items-center gap-2">
    <button id="btnRefreshReports" class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
      Refresh
    </button>
    <a href="admin.php" class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition text-sm">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5M3.75 3h16.5M20.25 3h1.5M20.25 3v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5M9 11.25l3 3m0 0 3-3m-3 3V6" /></svg>
      Admin
    </a>
    <a href="index.php" class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition text-sm">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
      Back to Explorer
    </a>
  </div>
</header>

<!-- Content -->
<main id="reportsContent" class="flex-1 overflow-y-auto p-5 space-y-8">

  <section>
    <h1 class="text-lg font-semibold text-slate-100 mb-1">Operations &amp; Health</h1>
    <p class="text-slate-500 text-xs mb-4">Parsed from the live operations log — a current snapshot, not a historical trend.</p>
    <div id="opsStats" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">Loading…</div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div>
        <h2 class="text-sm font-semibold text-slate-300 mb-2">By Operation</h2>
        <div id="opsByOperation"></div>
      </div>
      <div>
        <h2 class="text-sm font-semibold text-slate-300 mb-2">Recent Errors</h2>
        <div id="opsRecentErrors"></div>
      </div>
    </div>
  </section>

  <section>
    <h1 class="text-lg font-semibold text-slate-100 mb-1">Storage &amp; Capacity</h1>
    <p class="text-slate-500 text-xs mb-4">A live, cross-bucket total — computed by scanning every bucket on demand.</p>
    <div id="storageStats" class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">Loading…</div>
    <h2 class="text-sm font-semibold text-slate-300 mb-2">Buckets by Size</h2>
    <div id="bucketsBySize"></div>
  </section>

</main>

<!-- Toast container -->
<div id="toastContainer" class="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80"></div>

<script src="common.js"></script>
<script src="reports.js"></script>
</body>
</html>
