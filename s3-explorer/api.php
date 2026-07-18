<?php

declare(strict_types=1);

/** REST-style JSON API entry point for all S3 Explorer operations. */

require_once __DIR__ . '/Logger.php';

header('Content-Type: application/json');

$config = require __DIR__ . '/config.php';
$logger = new Logger($config['log_file'], $config['log_level']);

/** Sends a JSON response with success/data/error/operation_ms fields and exits. */
function respond(bool $success, array $data = [], string $error = '', float $startedAt = 0.0): void
{
    $elapsedMs = $startedAt > 0 ? (microtime(true) - $startedAt) * 1000 : 0.0;
    echo json_encode([
        'success'      => $success,
        'data'         => $data,
        'error'        => $error,
        'operation_ms' => round($elapsedMs, 1),
    ], JSON_UNESCAPED_SLASHES);
    exit;
}

/** Purges files older than 1 hour from the downloads directory. */
function purgeOldDownloads(string $dir): void
{
    if (!is_dir($dir)) {
        return;
    }
    $cutoff = time() - 3600;
    foreach (glob(rtrim($dir, '/') . '/*') ?: [] as $file) {
        if (is_file($file) && basename($file) !== '.gitkeep' && filemtime($file) < $cutoff) {
            @unlink($file);
        }
    }
}

purgeOldDownloads($config['download_dir']);

$startedAt = microtime(true);

try {
    if (!is_file(__DIR__ . '/aws.phar')) {
        throw new RuntimeException(
            'aws.phar SDK not found. Download it with: ' .
            'wget https://github.com/aws/aws-sdk-php/releases/download/3.384.4/aws.phar -O ' . __DIR__ . '/aws.phar'
        );
    }
    require_once __DIR__ . '/S3Service.php';
    require_once __DIR__ . '/PdfMergeService.php';

    $multipartActions = ['upload', 'merge_pdfs'];
    $isMultipart = isset($_POST['action']) && in_array($_POST['action'], $multipartActions, true);
    if ($isMultipart) {
        $action = (string) $_POST['action'];
        $params = $_POST;
    } elseif ($_SERVER['REQUEST_METHOD'] === 'GET') {
        // GET is only used for browser-triggered downloads (file / log), via window.open.
        $params = $_GET;
        $action = (string) ($params['action'] ?? '');
    } else {
        $rawBody = file_get_contents('php://input') ?: '';
        $params = json_decode($rawBody, true);
        if (!is_array($params)) {
            throw new InvalidArgumentException('Invalid JSON request body.');
        }
        $action = (string) ($params['action'] ?? '');
    }

    if ($action === '') {
        throw new InvalidArgumentException('Missing "action" parameter.');
    }

    // Config actions do not require an S3 connection.
    if ($action === 'get_config') {
        $safeConfig = $config;
        $safeConfig['secret_key'] = $config['secret_key'] === '' ? '' : str_repeat('*', 8);
        $logger->info('get_config');
        respond(true, ['config' => $safeConfig], '', $startedAt);
    }

    if ($action === 'save_config') {
        $allowedKeys = ['endpoint', 'region', 'bucket', 'access_key', 'secret_key', 'path_style'];
        $overrides = [];
        foreach ($allowedKeys as $key) {
            if (array_key_exists($key, $params)) {
                $overrides[$key] = $key === 'path_style' ? (bool) $params[$key] : (string) $params[$key];
            }
        }
        file_put_contents(
            __DIR__ . '/config.local.php',
            "<?php\n\ndeclare(strict_types=1);\n\nreturn " . var_export($overrides, true) . ";\n"
        );
        $logger->success('save_config → OK');
        respond(true, ['saved' => true], '', $startedAt);
    }

    $logger->opStart(strtoupper($action), json_encode(array_diff_key($params, ['secret_key' => 1])));

    $service = new S3Service($config, $logger);

    if ($action === 'download') {
        $bucket = (string) ($params['bucket'] ?? $config['bucket']);
        $key = (string) ($params['key'] ?? '');
        $disposition = (string) ($params['disposition'] ?? 'attachment') === 'inline' ? 'inline' : 'attachment';
        $result = $service->downloadObject($bucket, $key);

        $elapsedMs = (microtime(true) - $startedAt) * 1000;
        $logger->opSuccess('DOWNLOAD', $key, $elapsedMs);

        header_remove('Content-Type');
        header('Content-Type: ' . $result['content_type']);
        header('Content-Disposition: ' . $disposition . '; filename="' . basename($key) . '"');
        header('Content-Length: ' . (string) $result['size']);
        echo $result['body'];
        exit;
    }

    if ($action === 'download_object_version') {
        $bucket = (string) ($params['bucket'] ?? $config['bucket']);
        $key = (string) ($params['key'] ?? '');
        $versionId = (string) ($params['version_id'] ?? '');
        $disposition = (string) ($params['disposition'] ?? 'attachment') === 'inline' ? 'inline' : 'attachment';
        $result = $service->downloadObjectVersion($bucket, $key, $versionId);

        $elapsedMs = (microtime(true) - $startedAt) * 1000;
        $logger->opSuccess('DOWNLOAD_OBJECT_VERSION', "{$key}@{$versionId}", $elapsedMs);

        header_remove('Content-Type');
        header('Content-Type: ' . $result['content_type']);
        header('Content-Disposition: ' . $disposition . '; filename="' . basename($key) . '"');
        header('Content-Length: ' . (string) $result['size']);
        echo $result['body'];
        exit;
    }

    if ($action === 'get_logs' && $_SERVER['REQUEST_METHOD'] === 'GET') {
        $lines = $logger->getLastLines((int) ($params['lines'] ?? 1000));

        header_remove('Content-Type');
        header('Content-Type: text/plain');
        header('Content-Disposition: attachment; filename="s3-explorer.log"');
        echo implode(PHP_EOL, $lines) . PHP_EOL;
        exit;
    }

    $data = match ($action) {
        'test_connection' => $service->testConnection(),

        'list_buckets'  => ['buckets' => $service->listBuckets()],
        'create_bucket' => $service->createBucket((string) ($params['name'] ?? '')),
        'delete_bucket' => $service->deleteBucket((string) ($params['name'] ?? '')),
        'bucket_info'   => $service->getBucketInfo((string) ($params['name'] ?? '')),
        'bucket_size'   => $service->getBucketSize((string) ($params['name'] ?? '')),
        'set_bucket_acl' => $service->setBucketAcl(
            (string) ($params['name'] ?? ''),
            (string) ($params['acl'] ?? 'private')
        ),

        'list_objects' => $service->listObjects(
            (string) ($params['bucket'] ?? $config['bucket']),
            (string) ($params['prefix'] ?? ''),
            (string) ($params['delimiter'] ?? '/')
        ),

        'admin_list_objects' => $service->listAllObjects(
            (string) ($params['bucket'] ?? $config['bucket']),
            (string) ($params['prefix'] ?? ''),
            isset($params['continuation_token']) && $params['continuation_token'] !== ''
                ? (string) $params['continuation_token']
                : null,
            (int) ($params['max_keys'] ?? 1000)
        ),

        'upload' => handleUpload($service, $config, $params),

        'merge_pdfs' => handleMergePdfs($service, $config, $params),

        'delete_object' => $service->deleteObject(
            (string) ($params['bucket'] ?? $config['bucket']),
            (string) ($params['key'] ?? '')
        ),

        'delete_objects' => $service->deleteObjects(
            (string) ($params['bucket'] ?? $config['bucket']),
            array_map('strval', (array) ($params['keys'] ?? []))
        ),

        'copy_object' => $service->copyObject(
            (string) ($params['src_bucket'] ?? $params['bucket'] ?? $config['bucket']),
            (string) ($params['src_key'] ?? ''),
            (string) ($params['dst_bucket'] ?? $params['bucket'] ?? $config['bucket']),
            (string) ($params['dst_key'] ?? '')
        ),

        'move_object' => $service->moveObject(
            (string) ($params['src_bucket'] ?? $params['bucket'] ?? $config['bucket']),
            (string) ($params['src_key'] ?? ''),
            (string) ($params['dst_bucket'] ?? $params['bucket'] ?? $config['bucket']),
            (string) ($params['dst_key'] ?? '')
        ),

        'object_info' => $service->getObjectInfo(
            (string) ($params['bucket'] ?? $config['bucket']),
            (string) ($params['key'] ?? '')
        ),

        'presigned_url' => $service->generatePresignedUrl(
            (string) ($params['bucket'] ?? $config['bucket']),
            (string) ($params['key'] ?? ''),
            (int) ($params['expiry_seconds'] ?? 900)
        ),

        'create_folder' => $service->createFolder(
            (string) ($params['bucket'] ?? $config['bucket']),
            (string) ($params['prefix'] ?? '')
        ),

        'delete_folder' => $service->deleteFolder(
            (string) ($params['bucket'] ?? $config['bucket']),
            (string) ($params['prefix'] ?? '')
        ),

        'storage_stats' => $service->getStorageStats((string) ($params['bucket'] ?? $config['bucket'])),

        'get_logs' => ['lines' => $logger->getLastLines((int) ($params['lines'] ?? 100))],

        'presign_put' => handlePresignPut($service, $config, $params),

        'init_multipart_upload' => handleInitMultipartUpload($service, $config, $params),

        'complete_multipart_upload' => $service->completeMultipartUpload(
            (string) ($params['bucket'] ?? $config['bucket']),
            (string) ($params['key'] ?? ''),
            (string) ($params['upload_id'] ?? ''),
            (array) ($params['parts'] ?? [])
        ),

        'abort_multipart_upload' => $service->abortMultipartUpload(
            (string) ($params['bucket'] ?? $config['bucket']),
            (string) ($params['key'] ?? ''),
            (string) ($params['upload_id'] ?? '')
        ),

        'cors_status' => $service->getBucketCorsStatus((string) ($params['bucket'] ?? $config['bucket'])),

        'enable_cors' => $service->enableBucketCorsForUploads(
            (string) ($params['bucket'] ?? $config['bucket']),
            resolveRequestOrigin($params)
        ),

        'report_operations' => $logger->computeOperationStats((int) ($params['max_lines'] ?? 5000)),

        'report_storage' => handleStorageReport($service),

        'list_permission_users' => handleListPermissionUsers(),

        'permission_matrix' => handlePermissionMatrix(
            $logger,
            (string) ($params['bucket'] ?? $config['bucket'])
        ),

        'create_locked_bucket' => $service->createBucketWithObjectLock((string) ($params['name'] ?? '')),

        'enable_versioning' => $service->enableBucketVersioning((string) ($params['bucket'] ?? $config['bucket'])),

        'versioning_status' => $service->getVersioningAndLockStatus((string) ($params['bucket'] ?? $config['bucket'])),

        'list_object_versions' => $service->listObjectVersions(
            (string) ($params['bucket'] ?? $config['bucket']),
            (string) ($params['prefix'] ?? '')
        ),

        'delete_object_version' => $service->deleteObjectVersion(
            (string) ($params['bucket'] ?? $config['bucket']),
            (string) ($params['key'] ?? ''),
            (string) ($params['version_id'] ?? '')
        ),

        'set_object_retention' => $service->putObjectRetention(
            (string) ($params['bucket'] ?? $config['bucket']),
            (string) ($params['key'] ?? ''),
            (string) ($params['version_id'] ?? ''),
            (string) ($params['mode'] ?? 'GOVERNANCE'),
            (string) ($params['retain_until'] ?? '')
        ),

        'get_object_retention' => $service->getObjectRetention(
            (string) ($params['bucket'] ?? $config['bucket']),
            (string) ($params['key'] ?? ''),
            (string) ($params['version_id'] ?? '')
        ),

        'set_object_legal_hold' => $service->putObjectLegalHold(
            (string) ($params['bucket'] ?? $config['bucket']),
            (string) ($params['key'] ?? ''),
            (string) ($params['version_id'] ?? ''),
            (bool) ($params['on'] ?? false)
        ),

        'get_object_legal_hold' => $service->getObjectLegalHold(
            (string) ($params['bucket'] ?? $config['bucket']),
            (string) ($params['key'] ?? ''),
            (string) ($params['version_id'] ?? '')
        ),

        default => throw new InvalidArgumentException("Unknown action: {$action}"),
    };

    $elapsedMs = (microtime(true) - $startedAt) * 1000;
    $logger->opSuccess(strtoupper($action), '', $elapsedMs);

    respond(true, $data, '', $startedAt);
} catch (Throwable $e) {
    $elapsedMs = (microtime(true) - $startedAt) * 1000;
    $actionLabel = strtoupper($action ?? 'UNKNOWN');
    $logger->opFailure($actionLabel, '', $elapsedMs, $e->getMessage());
    respond(false, [], $e->getMessage(), $startedAt);
}

/** Handles a multipart file upload, streaming the temp file straight to S3. */
function handleUpload(S3Service $service, array $config, array $params): array
{
    if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        throw new RuntimeException('No file uploaded or upload error occurred.');
    }

    $bucket = (string) ($params['bucket'] ?? $config['bucket']);
    $key = (string) ($params['key'] ?? $_FILES['file']['name']);
    $tmpPath = $_FILES['file']['tmp_name'];
    $contentType = (string) ($_FILES['file']['type'] ?? '');

    return $service->uploadObject($bucket, $key, $tmpPath, $contentType);
}

/** Builds a collision-proof, traversal-safe object key under a fixed prefix from a client-supplied filename. */
function buildUploadKey(string $prefix, string $originalFilename): string
{
    $basename = basename(str_replace('\\', '/', $originalFilename));
    $safeName = preg_replace('/[^A-Za-z0-9._-]/', '_', $basename) ?? '';
    $safeName = trim($safeName, '._-');
    if ($safeName === '') {
        $safeName = 'file';
    }

    $unique = date('Ymd-His') . '-' . bin2hex(random_bytes(3));

    return rtrim($prefix, '/') . '/' . $unique . '-' . $safeName;
}

/** Validates a client-declared upload size against the configured max, throwing if it's out of bounds. */
function assertUploadSizeAllowed(int $size, int $maxBytes): void
{
    if ($size <= 0) {
        throw new InvalidArgumentException('Missing or invalid file size.');
    }
    if ($size > $maxBytes) {
        throw new InvalidArgumentException(
            sprintf('File is %s, which exceeds the %s upload limit.', formatBytesForError($size), formatBytesForError($maxBytes))
        );
    }
}

/** Formats a byte count for a human-readable error message (server-side counterpart to the JS formatBytes()). */
function formatBytesForError(int $bytes): string
{
    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $i = $bytes > 0 ? (int) floor(log($bytes, 1024)) : 0;
    $i = min($i, count($units) - 1);
    return round($bytes / (1024 ** $i), 1) . ' ' . $units[$i];
}

/** Resolves the origin to scope a CORS rule to: the browser's Origin header, falling back to a client-supplied value. */
function resolveRequestOrigin(array $params): string
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? (string) ($params['origin'] ?? '');
    if ($origin === '') {
        throw new InvalidArgumentException('Could not determine the request origin to scope the CORS rule to.');
    }
    return $origin;
}

/** Validates and presigns a single-shot PUT URL for a small direct-to-S3 upload. */
function handlePresignPut(S3Service $service, array $config, array $params): array
{
    $bucket = (string) ($params['bucket'] ?? $config['bucket']);
    $size = (int) ($params['size'] ?? 0);
    assertUploadSizeAllowed($size, (int) $config['large_upload_max_bytes']);

    $key = buildUploadKey((string) $config['large_upload_prefix'], (string) ($params['filename'] ?? 'upload.bin'));
    $contentType = (string) ($params['content_type'] ?? 'application/octet-stream');

    $result = $service->presignPutObject($bucket, $key, $contentType, (int) $config['large_upload_presign_expiry']);
    $result['key'] = $key;

    return $result;
}

/** Validates a large upload, starts a multipart session, and presigns URLs for every part in one round-trip. */
function handleInitMultipartUpload(S3Service $service, array $config, array $params): array
{
    $bucket = (string) ($params['bucket'] ?? $config['bucket']);
    $size = (int) ($params['size'] ?? 0);
    $maxBytes = (int) $config['large_upload_max_bytes'];
    assertUploadSizeAllowed($size, $maxBytes);

    $partBytes = (int) $config['large_upload_part_bytes'];
    $partCount = (int) ceil($size / $partBytes);
    if ($partCount > 10000) {
        // S3 caps a multipart upload at 10,000 parts; grow the part size instead of the count.
        $partBytes = (int) ceil($size / 10000);
        $partCount = (int) ceil($size / $partBytes);
    }

    $key = buildUploadKey((string) $config['large_upload_prefix'], (string) ($params['filename'] ?? 'upload.bin'));
    $contentType = (string) ($params['content_type'] ?? 'application/octet-stream');
    $expiry = (int) $config['large_upload_presign_expiry'];

    $session = $service->createMultipartUpload($bucket, $key, $contentType);
    $presigned = $service->presignUploadParts($bucket, $key, $session['upload_id'], $partCount, $expiry);

    return [
        'bucket'    => $bucket,
        'key'       => $key,
        'upload_id' => $session['upload_id'],
        'part_size' => $partBytes,
        'parts'     => $presigned['parts'],
    ];
}

/** Aggregates a cross-bucket storage total by scanning every object in every bucket (can be slow on large accounts). */
function handleStorageReport(S3Service $service): array
{
    $totalBytes = 0;
    $totalObjects = 0;
    $buckets = [];

    foreach ($service->listBuckets() as $bucket) {
        $size = $service->getBucketSize($bucket['name']);
        $totalBytes += $size['total_bytes'];
        $totalObjects += $size['object_count'];
        $buckets[] = [
            'name'         => $bucket['name'],
            'total_bytes'  => $size['total_bytes'],
            'object_count' => $size['object_count'],
        ];
    }

    usort($buckets, static fn (array $a, array $b): int => $b['total_bytes'] <=> $a['total_bytes']);

    return [
        'total_buckets' => count($buckets),
        'total_bytes'   => $totalBytes,
        'total_objects' => $totalObjects,
        'buckets'       => $buckets,
    ];
}

/** Returns the demo-user roster (label/description only — never credentials). */
function handleListPermissionUsers(): array
{
    $roster = require __DIR__ . '/permission-users.php';

    $users = [];
    foreach ($roster as $key => $user) {
        $users[] = [
            'key'         => $key,
            'label'       => (string) ($user['label'] ?? $key),
            'description' => (string) ($user['description'] ?? ''),
        ];
    }

    return ['users' => $users];
}

/** Runs the live permission probes for every configured demo user against one bucket. */
function handlePermissionMatrix(Logger $logger, string $bucket): array
{
    $roster = require __DIR__ . '/permission-users.php';
    if (empty($roster)) {
        throw new RuntimeException(
            'No demo users configured. Add credentials to permission-users.local.php (see permission-users.php for the expected format).'
        );
    }

    $users = [];
    $matrix = [];

    foreach ($roster as $key => $userConfig) {
        $users[] = [
            'key'         => $key,
            'label'       => (string) ($userConfig['label'] ?? $key),
            'description' => (string) ($userConfig['description'] ?? ''),
        ];

        $userService = new S3Service($userConfig, $logger);
        $matrix[$key] = runPermissionProbes($userService, $bucket, $key);
    }

    return [
        'bucket'     => $bucket,
        'users'      => $users,
        'operations' => ['list_buckets', 'list_objects', 'read_object', 'upload_object', 'delete_object', 'bucket_info'],
        'matrix'     => $matrix,
    ];
}

/** Runs the fixed set of safe, real S3 probes for one identity against one bucket. */
function runPermissionProbes(S3Service $service, string $bucket, string $userKey): array
{
    $results = [];

    $results['list_buckets'] = probeOperation(static fn () => $service->listBuckets());

    $listResult = null;
    $results['list_objects'] = probeOperation(static function () use ($service, $bucket, &$listResult) {
        $listResult = $service->listObjects($bucket, '', '');
        return $listResult;
    });

    if ($results['list_objects']['allowed'] === true && !empty($listResult['files'])) {
        $testKey = $listResult['files'][0]['key'];
        $results['read_object'] = probeOperation(static fn () => $service->getObjectInfo($bucket, $testKey));
    } elseif ($results['list_objects']['allowed'] === true) {
        $results['read_object'] = ['allowed' => null, 'message' => 'Bucket has no objects to test read access against.', 'elapsed_ms' => 0.0];
    } else {
        $results['read_object'] = ['allowed' => null, 'message' => 'Untestable — could not list objects to find a test target.', 'elapsed_ms' => 0.0];
    }

    $probeKey = sprintf('_permission_probe/%s-%d.txt', $userKey, time());
    $tmpFile = tempnam(sys_get_temp_dir(), 'perm_probe_');
    file_put_contents($tmpFile, 'permission probe');
    $results['upload_object'] = probeOperation(static fn () => $service->uploadObject($bucket, $probeKey, $tmpFile, 'text/plain'));
    @unlink($tmpFile);

    // DeleteObject is idempotent, so this cleanly tests delete permission regardless of
    // whether the upload probe above actually succeeded, and cleans up the probe file when it did.
    $results['delete_object'] = probeOperation(static fn () => $service->deleteObject($bucket, $probeKey));

    $results['bucket_info'] = probeOperation(static fn () => $service->getBucketInfo($bucket));

    return $results;
}

/** Times a probe call, reporting allow/deny + the real error message rather than throwing. */
function probeOperation(callable $fn): array
{
    $start = microtime(true);
    try {
        $fn();
        return ['allowed' => true, 'message' => 'OK', 'elapsed_ms' => round((microtime(true) - $start) * 1000, 1)];
    } catch (Throwable $e) {
        return ['allowed' => false, 'message' => $e->getMessage(), 'elapsed_ms' => round((microtime(true) - $start) * 1000, 1)];
    }
}

/** Merges an ordered list of existing S3 objects and/or freshly uploaded files into one PDF, saved back to S3. */
function handleMergePdfs(S3Service $service, array $config, array $params): array
{
    $items = json_decode((string) ($params['items'] ?? '[]'), true);
    if (!is_array($items) || count($items) === 0) {
        throw new InvalidArgumentException('No files provided to merge.');
    }

    $maxFiles = (int) $config['pdf_merge_max_files'];
    if (count($items) > $maxFiles) {
        throw new InvalidArgumentException("Cannot merge more than {$maxFiles} files at once.");
    }

    $destBucket = (string) ($params['bucket'] ?? $config['bucket']);
    $destKey = buildMergeOutputKey((string) $config['pdf_merge_prefix'], (string) ($params['key'] ?? ''));

    $files = [];
    $tempFilesToClean = [];

    try {
        foreach ($items as $item) {
            $type = (string) ($item['type'] ?? '');

            if ($type === 'existing') {
                $srcBucket = (string) ($item['bucket'] ?? $destBucket);
                $srcKey = (string) ($item['key'] ?? '');
                $downloaded = $service->downloadObject($srcBucket, $srcKey);
                $tmpPath = tempnam(sys_get_temp_dir(), 'pdf_src_') . '.pdf';
                file_put_contents($tmpPath, $downloaded['body']);
                $files[] = ['path' => $tmpPath, 'label' => basename($srcKey)];
                $tempFilesToClean[] = $tmpPath;
            } elseif ($type === 'upload') {
                $field = (string) ($item['field'] ?? '');
                if (!isset($_FILES[$field]) || $_FILES[$field]['error'] !== UPLOAD_ERR_OK) {
                    throw new RuntimeException("Missing or invalid uploaded file for field \"{$field}\".");
                }
                $files[] = ['path' => $_FILES[$field]['tmp_name'], 'label' => (string) $_FILES[$field]['name']];
            } else {
                throw new InvalidArgumentException("Unknown merge item type: \"{$type}\".");
            }
        }

        $mergeService = new PdfMergeService();
        $result = $mergeService->merge($files);
        $tempFilesToClean[] = $result['path'];

        $uploadResult = $service->uploadObject($destBucket, $destKey, $result['path'], 'application/pdf');

        return [
            'bucket'     => $destBucket,
            'key'        => $destKey,
            'page_count' => $result['page_count'],
            'size'       => filesize($result['path']),
            'etag'       => $uploadResult['etag'],
        ];
    } finally {
        foreach ($tempFilesToClean as $tmpPath) {
            @unlink($tmpPath);
        }
    }
}

/** Builds a safe .pdf destination key for the merged output under the configured prefix. */
function buildMergeOutputKey(string $prefix, string $requestedName): string
{
    $basename = basename(str_replace('\\', '/', $requestedName));
    $safeName = preg_replace('/[^A-Za-z0-9._-]/', '_', $basename) ?? '';
    $safeName = trim($safeName, '._-');
    if ($safeName === '') {
        $safeName = 'merged-' . date('Ymd-His') . '.pdf';
    }
    if (!str_ends_with(strtolower($safeName), '.pdf')) {
        $safeName .= '.pdf';
    }

    return rtrim($prefix, '/') . '/' . $safeName;
}
