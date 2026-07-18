<?php

declare(strict_types=1);

/** Leveled file logger with DEBUG/INFO/SUCCESS/ERROR levels and auto-rotation. */
final class Logger
{
    private const LEVELS = ['DEBUG' => 0, 'INFO' => 1, 'SUCCESS' => 2, 'ERROR' => 3];
    private const MAX_SIZE_BYTES = 5 * 1024 * 1024;

    private string $logFile;
    private int $minLevel;

    /** Creates a logger writing to the given file, filtering below minLevel. */
    public function __construct(string $logFile, string $minLevel = 'DEBUG')
    {
        $this->logFile = $logFile;
        $this->minLevel = self::LEVELS[$minLevel] ?? 0;

        $dir = dirname($logFile);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
    }

    /** Logs a DEBUG-level message. */
    public function debug(string $message): void
    {
        $this->write('DEBUG', $message);
    }

    /** Logs an INFO-level message. */
    public function info(string $message): void
    {
        $this->write('INFO', $message);
    }

    /** Logs a SUCCESS-level message. */
    public function success(string $message): void
    {
        $this->write('SUCCESS', $message);
    }

    /** Logs an ERROR-level message. */
    public function error(string $message): void
    {
        $this->write('ERROR', $message);
    }

    /** Logs the start of an operation. */
    public function opStart(string $operation, string $detail = ''): void
    {
        $this->info(trim("START {$operation} {$detail}"));
    }

    /** Logs the successful completion of an operation with elapsed milliseconds. */
    public function opSuccess(string $operation, string $detail, float $elapsedMs): void
    {
        $ms = number_format($elapsedMs, 1);
        $this->success(trim("{$operation} {$detail} \xE2\x86\x92 OK ({$ms}ms)"));
    }

    /** Logs a failed operation with elapsed milliseconds and error message. */
    public function opFailure(string $operation, string $detail, float $elapsedMs, string $errorMessage): void
    {
        $ms = number_format($elapsedMs, 1);
        $this->error(trim("{$operation} {$detail} \xE2\x86\x92 FAILED ({$ms}ms) {$errorMessage}"));
    }

    /** Writes a formatted line to the log file, rotating first if oversized. */
    private function write(string $level, string $message): void
    {
        if ((self::LEVELS[$level] ?? 0) < $this->minLevel) {
            return;
        }

        $this->rotateIfNeeded();

        $singleLineMessage = trim(preg_replace('/\s*[\r\n]+\s*/', ' ', $message) ?? $message);
        $timestamp = (new DateTimeImmutable('now'))->format('Y-m-d H:i:s.v');
        $line = sprintf('[%s] [%s] %s%s', $timestamp, $level, $singleLineMessage, PHP_EOL);

        file_put_contents($this->logFile, $line, FILE_APPEND | LOCK_EX);
    }

    /** Rotates the log file to .bak if it exceeds the max size. */
    private function rotateIfNeeded(): void
    {
        if (is_file($this->logFile) && filesize($this->logFile) > self::MAX_SIZE_BYTES) {
            $backupFile = $this->logFile . '.bak';
            @unlink($backupFile);
            @rename($this->logFile, $backupFile);
        }
    }

    /** Returns the last N lines of the log file as an array of strings. */
    public function getLastLines(int $lines): array
    {
        if (!is_file($this->logFile)) {
            return [];
        }

        $buffer = [];
        $handle = fopen($this->logFile, 'r');
        if ($handle === false) {
            return [];
        }

        while (($line = fgets($handle)) !== false) {
            $buffer[] = rtrim($line, "\r\n");
            if (count($buffer) > $lines) {
                array_shift($buffer);
            }
        }
        fclose($handle);

        return $buffer;
    }

    /** Returns the log file path. */
    public function getLogFilePath(): string
    {
        return $this->logFile;
    }
}
