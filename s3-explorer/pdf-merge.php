<?php

declare(strict_types=1);

/** PDF Merge demo entry point: combine existing bucket PDFs and/or freshly uploaded PDFs into one, saved back to S3. */
?>
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>S3 Explorer — PDF Merge Demo</title>
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
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
    </svg>
    <span class="font-semibold text-slate-100 tracking-tight">S3 Explorer — PDF Merge Demo</span>
  </div>
  <select id="bucketSelect" class="bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500 min-w-[160px]">
    <option value="">Select bucket…</option>
  </select>
</header>

<!-- Content -->
<main id="mergeContent" class="flex-1 overflow-y-auto p-5 space-y-6">

  <section class="grid grid-cols-1 lg:grid-cols-2 gap-5">
    <div>
      <h1 class="text-lg font-semibold text-slate-100 mb-1">From This Bucket</h1>
      <div class="flex items-center gap-2 mb-2">
        <button id="btnLoadBucketPdfs" class="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium">Load PDFs</button>
        <button id="btnAddSelected" class="px-2.5 py-1 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium">Add Selected</button>
      </div>
      <div id="bucketPdfList" class="border border-slate-800 rounded-lg max-h-56 overflow-y-auto"></div>
    </div>

    <div>
      <h1 class="text-lg font-semibold text-slate-100 mb-1">Upload From Your Computer</h1>
      <div id="localDropZone" class="border-2 border-dashed border-slate-700 rounded-lg p-6 text-center cursor-pointer hover:border-sky-500 transition">
        <p class="text-sm text-slate-400">Drag PDFs here or click to browse</p>
        <input type="file" id="localFileInput" accept="application/pdf,.pdf" multiple class="hidden">
      </div>
    </div>
  </section>

  <section>
    <h1 class="text-lg font-semibold text-slate-100 mb-2">Merge Order</h1>
    <div id="mergeListWrap"></div>
  </section>

  <section>
    <h1 class="text-lg font-semibold text-slate-100 mb-2">Merge</h1>
    <div class="flex flex-wrap items-end gap-3">
      <div>
        <label class="block text-xs text-slate-400 mb-1">Output filename</label>
        <input type="text" id="outputName" placeholder="merged.pdf" class="bg-slate-900 border border-slate-700 rounded-md px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-1 focus:ring-sky-500">
      </div>
      <button id="btnMerge" class="px-4 py-2 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium">Merge PDFs</button>
    </div>
    <div id="mergeResult" class="mt-4"></div>
  </section>

</main>

<!-- Toast container -->
<div id="toastContainer" class="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80"></div>

<script src="common.js"></script>
<script src="pdf-merge.js"></script>
</body>
</html>
