<?php

declare(strict_types=1);

require_once __DIR__ . '/aws.phar';

use Aws\S3\S3Client;
use Aws\S3\Exception\S3Exception;
use Aws\Exception\AwsException;

/** Thin service layer wrapping the AWS S3 SDK for all bucket/object/folder operations. */
final class S3Service
{
    private S3Client $client;
    private Logger $logger;

    /** Builds an S3Client from config and wires up the logger. */
    public function __construct(array $config, Logger $logger)
    {
        $this->logger = $logger;

        $this->client = new S3Client([
            'version'                 => 'latest',
            'region'                  => $config['region'],
            'endpoint'                => $config['endpoint'],
            'use_path_style_endpoint' => (bool) $config['path_style'],
            'credentials'             => [
                'key'    => $config['access_key'],
                'secret' => $config['secret_key'],
            ],
        ]);
    }

    /** Verifies credentials/endpoint by attempting to list buckets. */
    public function testConnection(): array
    {
        $result = $this->client->listBuckets();
        return [
            'owner'   => $result['Owner']['DisplayName'] ?? null,
            'buckets' => count($result['Buckets'] ?? []),
        ];
    }

    // ----------------------------------------------------------------
    // Bucket operations
    // ----------------------------------------------------------------

    /** Lists all buckets in the account. */
    public function listBuckets(): array
    {
        $result = $this->client->listBuckets();
        $buckets = [];
        foreach ($result['Buckets'] ?? [] as $bucket) {
            $buckets[] = [
                'name'         => $bucket['Name'],
                'creation_date' => isset($bucket['CreationDate'])
                    ? $bucket['CreationDate']->format(DATE_ATOM)
                    : null,
            ];
        }
        return $buckets;
    }

    /** Creates a new bucket. */
    public function createBucket(string $name): array
    {
        $this->client->createBucket(['Bucket' => $name]);
        $this->client->waitUntil('BucketExists', ['Bucket' => $name]);
        return ['name' => $name];
    }

    /** Deletes an empty bucket. */
    public function deleteBucket(string $name): array
    {
        $this->client->deleteBucket(['Bucket' => $name]);
        return ['name' => $name];
    }

    /** Returns location, versioning status, and creation date for a bucket. */
    public function getBucketInfo(string $name): array
    {
        $location = $this->client->getBucketLocation(['Bucket' => $name]);
        $versioning = $this->client->getBucketVersioning(['Bucket' => $name]);

        $creationDate = null;
        foreach ($this->client->listBuckets()['Buckets'] ?? [] as $bucket) {
            if ($bucket['Name'] === $name) {
                $creationDate = $bucket['CreationDate']->format(DATE_ATOM);
                break;
            }
        }

        return [
            'name'           => $name,
            'region'         => $location['LocationConstraint'] ?: 'us-east-1',
            'versioning'     => $versioning['Status'] ?? 'Disabled',
            'creation_date'  => $creationDate,
        ];
    }

    /** Computes total size in bytes and object count for a bucket. */
    public function getBucketSize(string $name): array
    {
        $totalSize = 0;
        $objectCount = 0;

        $paginator = $this->client->getPaginator('ListObjectsV2', ['Bucket' => $name]);
        foreach ($paginator as $page) {
            foreach ($page['Contents'] ?? [] as $object) {
                $totalSize += (int) $object['Size'];
                $objectCount++;
            }
        }

        return [
            'name'         => $name,
            'total_bytes'  => $totalSize,
            'object_count' => $objectCount,
        ];
    }

    /** Sets a canned ACL (private / public-read) on a bucket. */
    public function setBucketAcl(string $name, string $acl): array
    {
        $this->client->putBucketAcl([
            'Bucket' => $name,
            'ACL'    => $acl,
        ]);
        return ['name' => $name, 'acl' => $acl];
    }

    // ----------------------------------------------------------------
    // Object operations
    // ----------------------------------------------------------------

    /** Lists objects and common prefixes (folders) under a prefix. */
    public function listObjects(string $bucket, string $prefix = '', string $delimiter = '/'): array
    {
        $result = $this->client->listObjectsV2([
            'Bucket'    => $bucket,
            'Prefix'    => $prefix,
            'Delimiter' => $delimiter,
        ]);

        $folders = [];
        foreach ($result['CommonPrefixes'] ?? [] as $commonPrefix) {
            $folders[] = ['prefix' => $commonPrefix['Prefix']];
        }

        $files = [];
        foreach ($result['Contents'] ?? [] as $object) {
            if ($object['Key'] === $prefix) {
                continue;
            }
            $files[] = [
                'key'           => $object['Key'],
                'size'          => (int) $object['Size'],
                'last_modified' => $object['LastModified']->format(DATE_ATOM),
                'etag'          => trim((string) $object['ETag'], '"'),
            ];
        }

        return [
            'bucket'    => $bucket,
            'prefix'    => $prefix,
            'folders'   => $folders,
            'files'     => $files,
        ];
    }

    /** Returns one page of a full recursive (non-delimited) object listing, for admin drill-down views. */
    public function listAllObjects(
        string $bucket,
        string $prefix = '',
        ?string $continuationToken = null,
        int $maxKeys = 1000
    ): array {
        $params = [
            'Bucket'  => $bucket,
            'Prefix'  => $prefix,
            'MaxKeys' => $maxKeys,
        ];
        if ($continuationToken !== null && $continuationToken !== '') {
            $params['ContinuationToken'] = $continuationToken;
        }

        $result = $this->client->listObjectsV2($params);

        $files = [];
        foreach ($result['Contents'] ?? [] as $object) {
            $files[] = [
                'key'           => $object['Key'],
                'size'          => (int) $object['Size'],
                'last_modified' => $object['LastModified']->format(DATE_ATOM),
                'etag'          => trim((string) $object['ETag'], '"'),
                'storage_class' => $object['StorageClass'] ?? 'STANDARD',
            ];
        }

        return [
            'bucket'        => $bucket,
            'prefix'        => $prefix,
            'files'         => $files,
            'is_truncated'  => (bool) ($result['IsTruncated'] ?? false),
            'next_token'    => $result['NextContinuationToken'] ?? null,
            'key_count'     => (int) ($result['KeyCount'] ?? count($files)),
        ];
    }

    /** Uploads a local file to the given bucket/key. */
    public function uploadObject(string $bucket, string $key, string $localPath, string $contentType = ''): array
    {
        $params = [
            'Bucket'     => $bucket,
            'Key'        => $key,
            'SourceFile' => $localPath,
        ];
        if ($contentType !== '') {
            $params['ContentType'] = $contentType;
        }

        $result = $this->client->putObject($params);

        return [
            'bucket' => $bucket,
            'key'    => $key,
            'etag'   => trim((string) ($result['ETag'] ?? ''), '"'),
        ];
    }

    /** Downloads an object's content as a raw string. */
    public function downloadObject(string $bucket, string $key): array
    {
        $result = $this->client->getObject([
            'Bucket' => $bucket,
            'Key'    => $key,
        ]);

        return [
            'body'         => (string) $result['Body'],
            'content_type' => $result['ContentType'] ?? 'application/octet-stream',
            'size'         => (int) ($result['ContentLength'] ?? 0),
        ];
    }

    /** Deletes a single object. */
    public function deleteObject(string $bucket, string $key): array
    {
        $this->client->deleteObject(['Bucket' => $bucket, 'Key' => $key]);
        return ['bucket' => $bucket, 'key' => $key];
    }

    /** Bulk-deletes a list of object keys in a single request. */
    public function deleteObjects(string $bucket, array $keys): array
    {
        if (empty($keys)) {
            return ['bucket' => $bucket, 'deleted' => [], 'errors' => []];
        }

        $objects = array_map(static fn (string $key): array => ['Key' => $key], $keys);

        $result = $this->client->deleteObjects([
            'Bucket' => $bucket,
            'Delete' => ['Objects' => $objects, 'Quiet' => false],
        ]);

        $deleted = array_map(static fn ($d) => $d['Key'], (array) ($result['Deleted'] ?? []));
        $errors = array_map(
            static fn ($e) => ['key' => $e['Key'], 'message' => $e['Message']],
            (array) ($result['Errors'] ?? [])
        );

        return ['bucket' => $bucket, 'deleted' => $deleted, 'errors' => $errors];
    }

    /** Copies an object within or across buckets. */
    public function copyObject(string $srcBucket, string $srcKey, string $dstBucket, string $dstKey): array
    {
        $this->client->copyObject([
            'Bucket'     => $dstBucket,
            'Key'        => $dstKey,
            'CopySource' => rawurlencode($srcBucket) . '/' . str_replace('%2F', '/', rawurlencode($srcKey)),
        ]);

        return ['src' => "{$srcBucket}/{$srcKey}", 'dst' => "{$dstBucket}/{$dstKey}"];
    }

    /** Moves an object (copy then delete source) within or across buckets. */
    public function moveObject(string $srcBucket, string $srcKey, string $dstBucket, string $dstKey): array
    {
        $this->copyObject($srcBucket, $srcKey, $dstBucket, $dstKey);
        $this->deleteObject($srcBucket, $srcKey);

        return ['src' => "{$srcBucket}/{$srcKey}", 'dst' => "{$dstBucket}/{$dstKey}"];
    }

    /** Returns ETag, size, content-type, and last-modified for an object. */
    public function getObjectInfo(string $bucket, string $key): array
    {
        $result = $this->client->headObject(['Bucket' => $bucket, 'Key' => $key]);

        return [
            'bucket'         => $bucket,
            'key'            => $key,
            'etag'           => trim((string) ($result['ETag'] ?? ''), '"'),
            'size'           => (int) ($result['ContentLength'] ?? 0),
            'content_type'   => $result['ContentType'] ?? 'application/octet-stream',
            'last_modified'  => isset($result['LastModified']) ? $result['LastModified']->format(DATE_ATOM) : null,
            'storage_class'  => $result['StorageClass'] ?? 'STANDARD',
        ];
    }

    /** Generates a time-limited presigned URL for GET access to an object. */
    public function generatePresignedUrl(string $bucket, string $key, int $expirySeconds): array
    {
        $command = $this->client->getCommand('GetObject', [
            'Bucket' => $bucket,
            'Key'    => $key,
        ]);

        $request = $this->client->createPresignedRequest($command, "+{$expirySeconds} seconds");

        return [
            'url'        => (string) $request->getUri(),
            'expires_in' => $expirySeconds,
        ];
    }

    // ----------------------------------------------------------------
    // Folder (prefix) operations
    // ----------------------------------------------------------------

    /** Creates a folder by PUTting a zero-byte marker object ending in '/'. */
    public function createFolder(string $bucket, string $prefix): array
    {
        $prefix = rtrim($prefix, '/') . '/';

        $this->client->putObject([
            'Bucket' => $bucket,
            'Key'    => $prefix,
            'Body'   => '',
        ]);

        return ['bucket' => $bucket, 'prefix' => $prefix];
    }

    /** Deletes all objects under a prefix (recursive folder delete). */
    public function deleteFolder(string $bucket, string $prefix): array
    {
        $prefix = rtrim($prefix, '/') . '/';

        $keys = [];
        $paginator = $this->client->getPaginator('ListObjectsV2', [
            'Bucket' => $bucket,
            'Prefix' => $prefix,
        ]);
        foreach ($paginator as $page) {
            foreach ($page['Contents'] ?? [] as $object) {
                $keys[] = $object['Key'];
            }
        }

        $deleted = [];
        foreach (array_chunk($keys, 1000) as $chunk) {
            $result = $this->deleteObjects($bucket, $chunk);
            $deleted = array_merge($deleted, $result['deleted']);
        }

        return ['bucket' => $bucket, 'prefix' => $prefix, 'deleted_count' => count($deleted)];
    }

    /** Returns a one-level folder view (delimiter='/') for a prefix. */
    public function listFolderContents(string $bucket, string $prefix): array
    {
        return $this->listObjects($bucket, $prefix, '/');
    }

    // ----------------------------------------------------------------
    // Utility
    // ----------------------------------------------------------------

    /** Returns true if the object exists via a HEAD request. */
    public function objectExists(string $bucket, string $key): bool
    {
        try {
            return $this->client->doesObjectExist($bucket, $key);
        } catch (AwsException) {
            return false;
        }
    }

    /** Returns total size, file count, and folder count for a bucket. */
    public function getStorageStats(string $bucket): array
    {
        $totalSize = 0;
        $fileCount = 0;
        $folderKeys = [];

        $paginator = $this->client->getPaginator('ListObjectsV2', ['Bucket' => $bucket]);
        foreach ($paginator as $page) {
            foreach ($page['Contents'] ?? [] as $object) {
                $key = $object['Key'];
                if (substr($key, -1) === '/') {
                    $folderKeys[$key] = true;
                    continue;
                }
                $totalSize += (int) $object['Size'];
                $fileCount++;

                $dir = dirname($key);
                if ($dir !== '.' && $dir !== '') {
                    $folderKeys[$dir . '/'] = true;
                }
            }
        }

        return [
            'bucket'       => $bucket,
            'total_bytes'  => $totalSize,
            'file_count'   => $fileCount,
            'folder_count' => count($folderKeys),
        ];
    }
}
