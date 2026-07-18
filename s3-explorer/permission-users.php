<?php

declare(strict_types=1);

/**
 * Loads the roster of demo users for the Permissions Matrix page (permissions.php).
 *
 * Each entry is a full, independent S3Service credential set (its own endpoint/region/
 * access_key/secret_key/path_style) representing one real IAM/MinIO identity with its
 * own bucket policy, set up by you outside this app. The matrix page live-probes S3
 * with each of these credentials to show what they can actually do.
 *
 * Put your real credentials in permission-users.local.php (git-ignored), e.g.:
 *
 * <?php
 * declare(strict_types=1);
 * return [
 *     'admin' => [
 *         'label'       => 'Admin',
 *         'description' => 'Full read/write/delete access',
 *         'endpoint'    => 'https://your-provider.example.com',
 *         'region'      => 'us-east-1',
 *         'access_key'  => 'ADMIN_ACCESS_KEY',
 *         'secret_key'  => 'ADMIN_SECRET_KEY',
 *         'path_style'  => true,
 *     ],
 *     'readonly' => [
 *         'label'       => 'Read-Only',
 *         'description' => 'Can list and read, cannot write or delete',
 *         'endpoint'    => 'https://your-provider.example.com',
 *         'region'      => 'us-east-1',
 *         'access_key'  => 'READONLY_ACCESS_KEY',
 *         'secret_key'  => 'READONLY_SECRET_KEY',
 *         'path_style'  => true,
 *     ],
 * ];
 */

$localOverride = __DIR__ . '/permission-users.local.php';

return is_file($localOverride) ? require $localOverride : [];
