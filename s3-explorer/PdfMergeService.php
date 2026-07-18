<?php

declare(strict_types=1);

require_once __DIR__ . '/pdf-lib/fpdf.php';
require_once __DIR__ . '/pdf-lib/fpdi-src/autoload.php';

use setasign\Fpdi\Fpdi;

/** Merges an ordered list of local PDF files into one output PDF, using the vendored FPDI+FPDF (MIT licensed, see pdf-lib/). */
final class PdfMergeService
{
    /**
     * Merges local PDF files in the given order into a single new temp PDF file, returning its path and page count.
     * $files is an ordered list of ['path' => string, 'label' => string], where label is a human-friendly
     * name (e.g. the original filename) used in error messages instead of an opaque temp path.
     */
    public function merge(array $files): array
    {
        if (count($files) < 1) {
            throw new InvalidArgumentException('At least one PDF is required to merge.');
        }

        foreach ($files as $file) {
            $this->assertIsPdf($file['path'], $file['label']);
        }

        $pdf = new Fpdi();
        $totalPages = 0;

        foreach ($files as $file) {
            try {
                $pageCount = $pdf->setSourceFile($file['path']);
            } catch (Throwable $e) {
                throw new RuntimeException('Could not read "' . $file['label'] . '" as a PDF: ' . $e->getMessage());
            }

            for ($i = 1; $i <= $pageCount; $i++) {
                $templateId = $pdf->importPage($i);
                $size = $pdf->getTemplateSize($templateId);
                $pdf->AddPage($size['orientation'], [$size['width'], $size['height']]);
                $pdf->useTemplate($templateId);
                $totalPages++;
            }
        }

        $outputPath = tempnam(sys_get_temp_dir(), 'pdf_merge_') . '.pdf';
        $pdf->Output('F', $outputPath);

        return ['path' => $outputPath, 'page_count' => $totalPages];
    }

    /** Throws if the file at $path doesn't start with the PDF magic bytes (%PDF-). */
    private function assertIsPdf(string $path, string $label): void
    {
        $handle = fopen($path, 'rb');
        if ($handle === false) {
            throw new RuntimeException('Could not open "' . $label . '".');
        }
        $header = fread($handle, 5);
        fclose($handle);

        if ($header !== '%PDF-') {
            throw new InvalidArgumentException('"' . $label . '" is not a valid PDF file.');
        }
    }
}
