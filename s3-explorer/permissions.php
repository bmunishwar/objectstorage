<?php

declare(strict_types=1);

/** Permissions Matrix demo entry point: live-probes real per-user S3 credentials against a bucket. */
?>
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>S3 Explorer — Permissions Matrix Demo</title>
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
      <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
    <span class="font-semibold text-slate-100 tracking-tight">S3 Explorer — Permissions Matrix Demo</span>
  </div>
  <div class="flex items-center gap-2">
    <select id="bucketSelect" class="bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500 min-w-[160px]">
      <option value="">Select bucket…</option>
    </select>
    <button id="btnRunMatrix" class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
      Run Matrix
    </button>
  </div>
</header>

<!-- Content -->
<main id="permissionsContent" class="flex-1 overflow-y-auto p-5">
  <p class="text-slate-500 text-xs mb-4 max-w-3xl">Each row below uses its <strong>own, real</strong> AWS/MinIO credentials (configured in <code class="text-slate-400">permission-users.local.php</code>) to actually attempt each operation against the selected bucket — this is not a documented/configured table, every cell is a live, genuine result from S3 itself.</p>
  <div id="rosterNotice" class="hidden mb-4 border border-amber-800 bg-amber-950/40 text-amber-300 rounded-lg px-4 py-3 text-sm"></div>
  <div id="matrixWrap"></div>
</main>

<!-- Toast container -->
<div id="toastContainer" class="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80"></div>

<script src="common.js"></script>
<script src="permissions.js"></script>
</body>
</html>
