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

    $isUpload = isset($_POST['action']) && $_POST['action'] === 'upload';
    if ($isUpload) {
        $action = 'upload';
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
