<?php

declare(strict_types=1);

/** Single entry point that serves the S3 Explorer UI shell. */
?>
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>S3 Explorer</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    darkMode: 'class',
    theme: {
      extend: {
        colors: {
          slate: {
            925: '#0b1120',
            950: '#020617',
          }
        }
      }
    }
  }
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
  [x-cloak] { display: none !important; }
  .drag-active { outline: 2px dashed #38bdf8; outline-offset: -8px; background-color: rgba(56, 189, 248, 0.06); }
</style>
</head>
<body class="bg-slate-950 text-slate-200 h-screen flex flex-col overflow-hidden font-sans text-sm">

<!-- Header -->
<header class="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-925 shrink-0">
  <div class="flex items-center gap-2">
    <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" />
    </svg>
    <span class="font-semibold text-slate-100 tracking-tight">S3 Explorer</span>
  </div>
  <div class="flex items-center gap-2">
    <select id="bucketSelect" class="bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500 min-w-[160px]">
      <option value="">Select bucket…</option>
    </select>
    <a href="admin.php" class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition text-sm" title="Admin dashboard">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5M3.75 3h16.5M20.25 3h1.5M20.25 3v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5M9 11.25l3 3m0 0 3-3m-3 3V6" /></svg>
      Admin
    </a>
    <a href="reports.php" class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition text-sm" title="Reports &amp; Monitoring">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" /></svg>
      Reports
    </a>
    <button id="btnConfig" class="p-2 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition" title="Configuration">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      </svg>
    </button>
  </div>
</header>

<!-- Body -->
<div class="flex flex-1 min-h-0">

  <!-- Sidebar -->
  <aside class="w-[270px] shrink-0 border-r border-slate-800 bg-slate-925 flex flex-col overflow-y-auto">
    <div class="p-3 border-b border-slate-800">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-400">Buckets</h2>
        <button id="btnNewBucket" class="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-sky-400" title="Create bucket">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
        </button>
      </div>
      <div id="bucketList" class="space-y-0.5"></div>
    </div>

    <div class="p-3 border-b border-slate-800">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Storage Stats</h2>
      <div id="storageStats" class="space-y-1 text-slate-300">
        <div class="flex justify-between"><span class="text-slate-500">Total</span><span id="statTotal">—</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Objects</span><span id="statObjects">—</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Folders</span><span id="statFolders">—</span></div>
      </div>
    </div>

    <div class="p-3 flex-1">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Recent Operations</h2>
      <div id="recentOps" class="space-y-1.5 text-xs"></div>
    </div>
  </aside>

  <!-- Main panel -->
  <main id="mainPanel" class="flex-1 flex flex-col min-w-0 relative">
    <!-- Breadcrumb + toolbar -->
    <div class="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-925/60">
      <nav id="breadcrumb" class="flex items-center gap-1 text-sm text-slate-400 overflow-x-auto"></nav>
      <div class="flex items-center gap-1.5 shrink-0">
        <button id="btnUpload" class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
          Upload
        </button>
        <button id="btnNewFolder" class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-19.5 0v6a2.25 2.25 0 0 0 2.25 2.25h15a2.25 2.25 0 0 0 2.25-2.25v-6m-19.5 0V6a2.25 2.25 0 0 1 2.25-2.25h5.379a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H19.5A2.25 2.25 0 0 1 21.75 9v3.75" /></svg>
          New Folder
        </button>
        <button id="btnRefresh" class="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition" title="Refresh (R)">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
        </button>
        <div class="w-px h-5 bg-slate-800 mx-1"></div>
        <button id="btnViewGrid" class="p-1.5 rounded-md bg-slate-800 text-sky-400" title="Grid view">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" /></svg>
        </button>
        <button id="btnViewList" class="p-1.5 rounded-md hover:bg-slate-800 text-slate-400" title="List view">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
        </button>
      </div>
    </div>

    <!-- Grid / list -->
    <div id="fileArea" class="flex-1 overflow-y-auto p-4">
      <div id="emptyState" class="hidden flex-col items-center justify-center h-full text-center text-slate-500 gap-3">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-16 h-16 text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" /></svg>
        <p>This location is empty.</p>
        <button id="btnEmptyUpload" class="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium">Upload your first file</button>
      </div>
      <div id="grid" class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));"></div>
      <table id="listTable" class="hidden w-full text-sm border-collapse">
        <thead>
          <tr class="text-left text-slate-500 border-b border-slate-800">
            <th class="py-2 pr-2 w-8"></th>
            <th class="py-2 pr-4">Name</th>
            <th class="py-2 pr-4">Size</th>
            <th class="py-2 pr-4">Last Modified</th>
          </tr>
        </thead>
        <tbody id="listBody"></tbody>
      </table>
    </div>

    <!-- Action bar -->
    <div id="actionBar" class="hidden items-center gap-2 px-4 py-2 border-t border-slate-800 bg-slate-925">
      <span id="actionBarLabel" class="text-xs text-slate-400 mr-2"></span>
      <div id="actionBarButtons" class="flex items-center gap-1.5 flex-wrap"></div>
    </div>
  </main>
</div>

<!-- Live log console -->
<div id="logConsole" class="border-t border-slate-800 bg-slate-925 shrink-0 flex flex-col" style="height: 180px;">
  <div class="flex items-center justify-between px-3 py-1.5 border-b border-slate-800 bg-slate-900/60">
    <button id="btnToggleLog" class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200">
      <svg id="logToggleIcon" xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
      Live Log Console
    </button>
    <div class="flex items-center gap-2">
      <button id="btnClearLog" class="text-xs text-slate-500 hover:text-slate-300">Clear</button>
      <button id="btnDownloadLog" class="text-xs text-slate-500 hover:text-slate-300">Download log</button>
    </div>
  </div>
  <div id="logBody" class="flex-1 overflow-y-auto px-3 py-1.5 font-mono text-xs leading-relaxed"></div>
</div>

<!-- Toast container -->
<div id="toastContainer" class="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80"></div>

<!-- Modal root -->
<div id="modalRoot"></div>

<script src="common.js"></script>
<script src="app.js"></script>
</body>
</html>
