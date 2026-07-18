<?php

declare(strict_types=1);

/** Versioning & Immutability demo entry point: bucket versioning + S3 Object Lock (WORM). */
?>
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>S3 Explorer — Versioning &amp; Immutability Demo</title>
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
    <span class="font-semibold text-slate-100 tracking-tight">S3 Explorer — Versioning &amp; Immutability Demo</span>
  </div>
  <select id="bucketSelect" class="bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500 min-w-[160px]">
    <option value="">Select bucket…</option>
  </select>
</header>

<!-- Content -->
<main id="versioningContent" class="flex-1 overflow-y-auto p-5 space-y-6">

  <section>
    <h1 class="text-lg font-semibold text-slate-100 mb-1">1. Bucket Setup</h1>
    <p class="text-slate-500 text-xs mb-3 max-w-2xl">S3 Object Lock (true WORM immutability) can only be enabled when a bucket is <strong>created</strong> — it can't be added to an existing bucket. Create a dedicated demo bucket below, or select an existing bucket to see its current status (and demo plain versioning on it instead).</p>
    <div class="flex flex-wrap items-end gap-3 mb-3">
      <div>
        <label class="block text-xs text-slate-400 mb-1">New bucket name</label>
        <input type="text" id="newLockedBucketName" placeholder="my-immutable-bucket" class="bg-slate-900 border border-slate-700 rounded-md px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-1 focus:ring-sky-500">
      </div>
      <button id="btnCreateLockedBucket" class="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium">Create Object-Lock Bucket</button>
      <button id="btnEnableVersioning" class="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium">Enable Versioning on Selected Bucket</button>
    </div>
    <div id="bucketStatus" class="text-sm"></div>
  </section>

  <section>
    <h1 class="text-lg font-semibold text-slate-100 mb-1">2. Upload a Version</h1>
    <p class="text-slate-500 text-xs mb-3">Upload the same key twice (e.g. keep the default name) to see multiple versions appear below.</p>
    <div class="flex items-center gap-3">
      <input type="file" id="versionFileInput" class="text-xs text-slate-400">
      <button id="btnUploadVersion" class="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium">Upload</button>
    </div>
  </section>

  <section>
    <div class="flex items-center justify-between mb-2">
      <h1 class="text-lg font-semibold text-slate-100">3. Object Versions</h1>
      <button id="btnRefreshVersions" class="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium">Refresh</button>
    </div>
    <div id="versionsTableWrap"></div>
  </section>

  <section id="immutabilitySection" class="hidden">
    <h1 class="text-lg font-semibold text-slate-100 mb-1">4. Immutability Controls</h1>
    <p id="selectedVersionLabel" class="text-slate-500 text-xs mb-3"></p>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div class="border border-slate-800 rounded-lg p-4 bg-slate-925 space-y-3">
        <h2 class="text-sm font-semibold text-slate-300">Retention</h2>
        <div id="retentionStatus" class="text-xs text-slate-400"></div>
        <div class="flex flex-wrap items-end gap-2">
          <div>
            <label class="block text-xs text-slate-400 mb-1">Mode</label>
            <select id="retentionMode" class="bg-slate-900 border border-slate-700 rounded-md px-2 py-1.5 text-xs">
              <option value="GOVERNANCE">Governance</option>
              <option value="COMPLIANCE">Compliance</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">Retain until</label>
            <input type="date" id="retentionDate" class="bg-slate-900 border border-slate-700 rounded-md px-2 py-1.5 text-xs">
          </div>
          <button id="btnSetRetention" class="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium">Apply</button>
        </div>
      </div>
      <div class="border border-slate-800 rounded-lg p-4 bg-slate-925 space-y-3">
        <h2 class="text-sm font-semibold text-slate-300">Legal Hold</h2>
        <div id="legalHoldStatus" class="text-xs text-slate-400"></div>
        <div class="flex gap-2">
          <button id="btnLegalHoldOn" class="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium">Turn On</button>
          <button id="btnLegalHoldOff" class="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium">Turn Off</button>
        </div>
      </div>
    </div>
    <div class="mt-4">
      <button id="btnTryDelete" class="px-4 py-2 rounded-md bg-red-900/40 hover:bg-red-900/70 text-red-300 text-sm font-medium">Try to Delete This Version</button>
      <p class="text-[11px] text-slate-600 mt-1">If retention or legal hold is active, S3 itself will refuse this — that refusal is the point of the demo.</p>
    </div>
  </section>

</main>

<!-- Toast container -->
<div id="toastContainer" class="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80"></div>

<script src="common.js"></script>
<script src="versioning.js"></script>
</body>
</html>
