<?php

declare(strict_types=1);

/** Large-file upload demo entry point: direct browser-to-S3 multipart upload via presigned URLs. */
?>
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>S3 Explorer — Large Upload Demo</title>
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
  .drag-active { outline: 2px dashed #38bdf8; outline-offset: -8px; background-color: rgba(56, 189, 248, 0.06); }
</style>
</head>
<body class="bg-slate-950 text-slate-200 h-screen flex flex-col overflow-hidden font-sans text-sm">

<!-- Header -->
<header class="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-925 shrink-0">
  <div class="flex items-center gap-2">
    <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
    <span class="font-semibold text-slate-100 tracking-tight">S3 Explorer — Large Upload Demo</span>
  </div>
  <div class="flex items-center gap-2">
    <select id="bucketSelect" class="bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500 min-w-[160px]">
      <option value="">Select bucket…</option>
    </select>
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
<main id="uploadContent" class="flex-1 overflow-y-auto p-5">

  <!-- CORS status banner -->
  <div id="corsBanner" class="hidden mb-4 border rounded-lg px-4 py-3 text-sm"></div>

  <div class="grid grid-cols-1 lg:grid-cols-5 gap-5">
    <div class="lg:col-span-2 space-y-4">
      <div>
        <h2 class="text-sm font-semibold text-slate-300 mb-2">Upload</h2>
        <div id="dropZone" class="border-2 border-dashed border-slate-700 rounded-lg p-8 text-center cursor-pointer hover:border-sky-500 transition">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-10 h-10 mx-auto text-slate-600 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
          <p class="text-sm text-slate-400">Drag any file here or click to browse</p>
          <p class="text-xs text-slate-600 mt-1">Up to 5GB — small files use a single upload, large files use chunked multipart</p>
          <input type="file" id="fileInput" class="hidden">
        </div>
        <div id="uploadProgress" class="hidden mt-3 space-y-1.5">
          <div class="flex justify-between text-xs">
            <span id="uploadProgressLabel" class="truncate text-slate-400"></span>
            <span id="uploadProgressPct" class="text-slate-400 shrink-0">0%</span>
          </div>
          <div class="h-1.5 bg-slate-800 rounded-full overflow-hidden"><div id="uploadProgressBar" class="h-full bg-sky-500 transition-all" style="width:0%"></div></div>
          <p id="uploadProgressDetail" class="text-[11px] text-slate-600"></p>
        </div>
      </div>

      <div>
        <h2 class="text-sm font-semibold text-slate-300 mb-2">Uploaded Files</h2>
        <div id="fileListWrap"></div>
      </div>
    </div>

    <div class="lg:col-span-3">
      <h2 class="text-sm font-semibold text-slate-300 mb-2">Preview</h2>
      <div id="fileMeta" class="hidden border border-slate-800 rounded-lg p-3 bg-slate-925 mb-3 text-xs space-y-1"></div>
      <div id="previewPanel" class="border border-slate-800 rounded-lg bg-slate-925 min-h-[300px] flex items-center justify-center overflow-hidden">
        <p class="text-slate-600 text-sm p-6 text-center">Upload or select a file to preview it here.</p>
      </div>
    </div>
  </div>
</main>

<!-- Toast container -->
<div id="toastContainer" class="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80"></div>

<script src="common.js"></script>
<script src="large-upload.js"></script>
</body>
</html>
