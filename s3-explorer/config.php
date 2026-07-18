<?php

declare(strict_types=1);

/** Loads S3 Explorer configuration from environment variables, a config.local.php override, or defaults. */

$localOverride = __DIR__ . '/config.local.php';
$overrides = is_file($localOverride) ? require $localOverride : [];

$defaults = [
    'endpoint'     => getenv('S3_ENDPOINT')   ?: 'https://your-provider.example.com',
    'region'       => getenv('S3_REGION')     ?: 'us-east-1',
    'bucket'       => getenv('S3_BUCKET')     ?: 'your-bucket-name',
    'access_key'   => getenv('S3_ACCESS_KEY') ?: 'YOUR_ACCESS_KEY',
    'secret_key'   => getenv('S3_SECRET_KEY') ?: 'YOUR_SECRET_KEY',
    'path_style'   => true,
    'log_file'     => __DIR__ . '/logs/s3-explorer.log',
    'log_level'    => 'DEBUG',
    'download_dir' => __DIR__ . '/downloads/',

    'large_upload_prefix'         => 'large-uploads/',
    'large_upload_part_bytes'     => 8 * 1024 * 1024,          // 8MB (S3 minimum part size is 5MB)
    'large_upload_max_bytes'      => 5 * 1024 * 1024 * 1024,   // 5GB demo cap
    'large_upload_presign_expiry' => 3600,

    'pdf_merge_prefix'    => 'merged-pdfs/',
    'pdf_merge_max_files' => 20,
];

return array_merge($defaults, $overrides);
