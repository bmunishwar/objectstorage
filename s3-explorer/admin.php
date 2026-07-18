<?php

declare(strict_types=1);

/** Admin dashboard entry point: bucket list -> bucket detail -> object detail drill-down. */
?>
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>S3 Explorer — Admin</title>
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
      <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5M3.75 3h16.5M20.25 3h1.5M20.25 3v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5M9 11.25l3 3m0 0 3-3m-3 3V6" />
    </svg>
    <span class="font-semibold text-slate-100 tracking-tight">S3 Explorer — Admin</span>
  </div>
  <div class="flex items-center gap-2">
    <a href="large-upload.php" class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition text-sm">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
      Large Upload
    </a>
    <a href="index.php" class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition text-sm">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
      Back to Explorer
    </a>
  </div>
</header>

<!-- Breadcrumb -->
<div class="px-4 py-2 border-b border-slate-800 bg-slate-925/60 shrink-0">
  <nav id="adminBreadcrumb" class="flex items-center gap-1 text-sm text-slate-400 overflow-x-auto"></nav>
</div>

<!-- Content -->
<main id="adminContent" class="flex-1 overflow-y-auto p-5"></main>

<!-- Toast container -->
<div id="toastContainer" class="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80"></div>

<script src="common.js"></script>
<script src="admin.js"></script>
</body>
</html>
