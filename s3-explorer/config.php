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
];

return array_merge($defaults, $overrides);
