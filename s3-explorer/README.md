# S3 Explorer

A self-contained PHP web application for exploring and operating any S3-compatible object storage service — buckets, objects, folders, presigned URLs, and a live operations log — through a clean dark-themed browser UI. No Composer, no framework, no build step.

## Prerequisites

- **PHP 8.1+** with the following extensions enabled: `curl`, `json`, `simplexml`, `mbstring` (bundled with most distros/PHP builds by default).
- A PHP-capable web server, or just the built-in PHP dev server (`php -S`).
- An account on any S3-compatible object storage provider — see [Supported Providers](#supported-s3-compatible-providers) below.
- The `aws.phar` single-file AWS SDK for PHP (see setup below).

## One-Time Setup

### 1. Get `aws.phar`

Download the official single-file SDK into the `s3-explorer/` folder:

```bash
wget https://github.com/aws/aws-sdk-php/releases/download/3.384.4/aws.phar -O aws.phar
```

If `wget` isn't available, `curl` works too:

```bash
curl -L https://github.com/aws/aws-sdk-php/releases/download/3.384.4/aws.phar -o aws.phar
```

If `aws.phar` is missing, the app itself will show this exact command in the error toast/log, so you can't miss it.

### 2. Configure credentials

Two options — pick whichever fits your workflow:

**Option A — Environment variables** (recommended for shared/production hosts):

```bash
export S3_ENDPOINT="https://your-provider.example.com"
export S3_REGION="us-east-1"
export S3_BUCKET="your-bucket-name"
export S3_ACCESS_KEY="your-access-key"
export S3_SECRET_KEY="your-secret-key"
```

**Option B — In-browser Config modal**: click the ⚙ **Config** button in the header, fill in the endpoint/region/bucket/keys, click **Test Connection** to verify, then **Save**. This writes a `config.local.php` override file (already git-ignored) — no need to touch `config.php` directly.

You can also edit `config.php` directly if you prefer static defaults baked into the repo (not recommended if the repo is shared/committed anywhere with real secrets).

## How to Run

**Local development:**

```bash
cd s3-explorer
php -S localhost:8080
```

Then open `http://localhost:8080` in your browser.

**Any PHP-capable web server:** drop the entire `s3-explorer/` folder into your web root (Apache, Nginx+PHP-FPM, etc.) and point a vhost at it. No `.htaccess`, rewrite rules, or special config required — it's plain PHP files.

## UI Panels

- **Header** — app name, active-bucket dropdown (populated live from `list_buckets`), an **Admin** link to the admin dashboard, and a ⚙ **Config** button that opens the in-browser settings modal (endpoint/region/keys/path-style, with a Test Connection button).
- **Left sidebar** — bucket list (click to switch, `+` to create, hover-trash to delete), storage stats for the active bucket (total size, object count, folder count — auto-refreshes on bucket switch), and the last 10 recent operations with a ✓/✗ status badge and latency in ms.
- **Main file browser** — clickable breadcrumb, a toolbar (Upload, New Folder, Refresh, Grid/List toggle), and a card or table view of folders and files. Click a folder to navigate in; click/checkbox/shift-click files to multi-select. Drag files from your desktop directly onto the panel to upload them.
- **Contextual action bar** — appears at the bottom of the main panel once 1+ items are selected: single file gives Download/Copy/Move/Presigned URL/Info/Delete; a folder gives Open/Delete Folder (recursive); multiple items give Bulk Delete.
- **Modals** — Upload (drag-and-drop zone + per-file progress bars), New Folder, Object Info, Presigned URL (expiry selector + copyable field), Copy/Move (destination key input), Create Bucket (name validation), and Config (Test Connection).
- **Live log console** — fixed at the bottom, collapsible, auto-scrolling, color-coded by level (DEBUG grey / INFO cyan / SUCCESS green / ERROR red), polls `get_logs` every 3 seconds, with Clear and Download log buttons.
- **Admin dashboard** (`admin.php`) — a separate, read/stats-oriented page for auditing storage:
  - **All Buckets** — every bucket in the account with its creation date.
  - **Bucket detail** — click a bucket to see its region, versioning status, creation date, total size, file count, and folder count, plus a paginated, prefix-filterable table of *every* object in the bucket (flat, recursive — not folder-by-folder).
  - **Object detail** — click any object row to see its full metadata (key, bucket, size, content-type, ETag, last-modified, storage class) alongside an inline preview (images, video, audio, PDF, and text/JSON render directly in the page; anything else falls back to a Download button), plus Copy Presigned URL and Delete actions.
  - Navigation uses real URLs (`admin.php?view=bucket&bucket=...`), so back/forward and bookmarking work as expected.

## Large Upload Demo (direct-to-S3 multipart)

`large-upload.php` is a standalone, additional page — it's intentionally **not** linked from the Explorer's or Admin's navigation, and doesn't touch the main Explorer's Upload flow. Open it directly at `/large-upload.php` when you want to demo it. It uploads files **straight from the browser to your S3-compatible endpoint** — your AWS secret key is never sent to the browser, and file bytes never pass through the PHP server. This is the same pattern used by the AWS Console, Dropbox, etc., and it sidesteps PHP's `upload_max_filesize`/`post_max_size`/memory limits entirely:

1. The PHP backend (which holds your real credentials) generates short-lived, single-purpose **presigned URLs** — one URL for a small file, or one URL per chunk for a large file.
2. The browser `PUT`s the file (or each chunk) directly to the S3 endpoint using those URLs.
3. For large files, chunks upload with limited concurrency and per-chunk retry; if a chunk fails, only that chunk retries, not the whole file. If the upload can't complete, the backend aborts the multipart session so S3 doesn't keep billing for orphaned parts.
4. Files ≤8MB skip the multipart machinery and use a single presigned `PutObject` URL instead.

**Prerequisite: CORS.** Since the browser talks to your S3 endpoint directly, the bucket needs a CORS rule allowing `PUT`/`GET` from your app's origin and exposing the `ETag` response header (required so the browser can read each chunk's ETag to complete the multipart upload). The page checks this automatically on load and shows a **Fix CORS automatically** button if it's missing — no need to configure this by hand.

Defaults (in `config.php`, overridable via env-style edits): 8MB part size, 5GB max file size, `large-uploads/` key prefix, 1-hour presigned URL expiry. Uploaded filenames are sanitized and prefixed with a timestamp+random token to prevent path traversal and key collisions.

*Not included in this version:* resuming an interrupted upload after a page reload (would require reconciling already-uploaded parts via S3's `ListParts` API on reload) — today, a page refresh mid-upload means starting that file over.

## Supported S3-Compatible Providers

| Provider | Example Endpoint | Path-style required? |
|---|---|---|
| MinIO | `http://localhost:9000` (or your host) | Yes |
| AWS S3 | `https://s3.<region>.amazonaws.com` | No |
| Wasabi | `https://s3.<region>.wasabisys.com` | No |
| Backblaze B2 (S3 API) | `https://s3.<region>.backblazeb2.com` | No |
| DigitalOcean Spaces | `https://<region>.digitaloceanspaces.com` | No |
| Cloudflare R2 | `https://<account_id>.r2.cloudflarestorage.com` | Yes |
| Ceph (RGW) | `https://<your-ceph-rgw-host>` | Usually yes |
| IONOS Object Storage | `https://s3-eu-central-1.ionoscloud.com` | Yes |

`path_style` in `config.php` (or the Config modal's checkbox) controls whether bucket names go in the URL path (`endpoint/bucket/key`, needed by MinIO/R2/most self-hosted setups) vs. the hostname (`bucket.endpoint/key`, AWS's default). When unsure, try path-style on first — it works for nearly everyone.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Error toast: "aws.phar SDK not found..." | `aws.phar` missing from the app folder | Run the `wget`/`curl` command shown in the error (see [setup](#1-get-awsphar)) |
| `403 Forbidden` / `SignatureDoesNotMatch` | Wrong access/secret key, or wrong region | Re-check credentials in the Config modal; use **Test Connection** |
| `404 NoSuchBucket` on every call | Wrong bucket name or endpoint | Verify the bucket exists at that endpoint; check for typos in `config.php` |
| Buckets list empty but you know buckets exist | Wrong `path_style` setting | Toggle path-style in the Config modal and retry |
| Upload hangs or fails on large files | PHP `upload_max_filesize` / `post_max_size` too low | Raise both in `php.ini` (or pass `-d upload_max_filesize=... -d post_max_size=...` to `php -S`) |
| Blank/unstyled page | No internet access to `cdn.tailwindcss.com` (or your CDN blocked by a firewall/proxy) | Ensure outbound HTTPS to the Tailwind CDN is allowed, or self-host Tailwind |
| Raw PHP error/stack trace in browser | Should never happen — `api.php` catches all `Throwable`s | File a bug; check `logs/s3-explorer.log` for the real error in the meantime |
| Presigned URL doesn't work when opened | Clock skew between this server and the S3 endpoint | Sync server time (NTP); presigned URLs are time-signed |
| Large Upload Demo: chunk `PUT` fails with a network/CORS error | Bucket has no CORS rule for this origin | Use the **Fix CORS automatically** button on `large-upload.php`, or configure it manually (see [above](#large-upload-demo-direct-to-s3-multipart)) |
| Large Upload Demo: "response was missing an ETag header" | CORS rule exists but doesn't expose `ETag` | Re-run **Fix CORS automatically** (it sets `ExposeHeaders: [ETag]`), or add that to your existing CORS rule manually |
| `SSL certificate problem` in logs | Self-signed cert on a self-hosted MinIO/Ceph endpoint | Terminate TLS with a trusted cert, or run the endpoint over plain HTTP on a private network |

## Project Structure

```
s3-explorer/
├── aws.phar            SDK (download separately, see setup)
├── index.php           Main file-browser UI shell
├── admin.php           Admin dashboard UI shell (buckets → bucket → object drill-down)
├── large-upload.php    Large Upload Demo UI shell (direct-to-S3 multipart)
├── api.php             All backend operations (JSON in/out)
├── config.php          Provider config (env vars, with config.local.php override)
├── Logger.php          Leveled logger (DEBUG/INFO/SUCCESS/ERROR)
├── S3Service.php       All S3 operations (bucket + object + folder + presigned/multipart layer)
├── common.js           Shared JS helpers (API caller, formatters, toasts, preview renderer)
├── app.js              Main explorer front-end logic
├── admin.js            Admin dashboard front-end logic
├── large-upload.js     Large Upload Demo front-end logic
├── logs/
│   └── s3-explorer.log   Rotating log file (auto-created, auto-rotates at 5MB)
└── downloads/             Temp folder for GET downloads (auto-purged hourly)
```
