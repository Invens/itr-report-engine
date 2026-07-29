import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pdf from 'pdf-parse';
import { env } from './config.js';
import { ExtractionPipelineError, wrapExtractionError } from './extraction-error.js';

const execFileAsync = promisify(execFile);

export type PdfExtractionResult = {
  text: string;
  extractionMode: 'PDF_TEXT' | 'OCR';
  pageCount: number | null;
};

function commandDetails(error: unknown) {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as Record<string, unknown>;
  return {
    code: candidate.code,
    signal: candidate.signal,
    killed: candidate.killed,
    stderr: typeof candidate.stderr === 'string'
      ? candidate.stderr.slice(0, 4000)
      : candidate.stderr
  };
}

export async function persistUpload(buffer: Buffer, originalName: string) {
  try {
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const directory = join(env.STORAGE_DIR, 'uploads', sha256.slice(0, 2));
    await mkdir(directory, { recursive: true });
    const storageKey = join('uploads', sha256.slice(0, 2), `${sha256}.pdf`);
    await writeFile(join(env.STORAGE_DIR, storageKey), buffer, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    return { sha256, storageKey, originalName };
  } catch (error) {
    throw wrapExtractionError({
      error,
      code: 'UPLOAD_PERSISTENCE_FAILED',
      stage: 'UPLOAD_PERSISTENCE',
      message: `Unable to persist uploaded PDF: ${originalName}`
    });
  }
}

function normalizeText(value: string) {
  return value
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

async function runOcr(pdfPath: string) {
  const workDir = await mkdtemp(join(tmpdir(), 'itr-ocr-'));
  const imagePrefix = join(workDir, 'page');

  try {
    try {
      await execFileAsync('pdftoppm', [
        '-f', '1',
        '-l', String(env.OCR_MAX_PAGES),
        '-r', String(env.OCR_DPI),
        '-png',
        pdfPath,
        imagePrefix
      ], { maxBuffer: 20 * 1024 * 1024 });
    } catch (error) {
      throw new ExtractionPipelineError({
        code: 'OCR_RENDER_FAILED',
        stage: 'OCR_RENDER',
        message: 'Poppler could not render the PDF into page images',
        details: commandDetails(error),
        cause: error
      });
    }

    const images = (await readdir(workDir))
      .filter((file) => file.startsWith('page-') && file.endsWith('.png'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (images.length === 0) {
      throw new ExtractionPipelineError({
        code: 'OCR_NO_PAGE_IMAGES',
        stage: 'OCR_RENDER',
        message: 'OCR renderer produced no page images',
        details: { pdfPath, workDir }
      });
    }

    const pages: string[] = [];
    for (const [index, image] of images.entries()) {
      try {
        const { stdout } = await execFileAsync('tesseract', [
          join(workDir, image),
          'stdout',
          '-l', 'eng',
          '--psm', '6'
        ], { maxBuffer: 20 * 1024 * 1024 });
        pages.push(`\n--- OCR PAGE ${index + 1} ---\n${stdout}`);
      } catch (error) {
        throw new ExtractionPipelineError({
          code: 'OCR_RECOGNITION_FAILED',
          stage: 'OCR_RECOGNITION',
          message: `Tesseract failed on rendered page ${index + 1}`,
          details: {
            page: index + 1,
            image,
            command: commandDetails(error)
          },
          cause: error
        });
      }
    }

    return normalizeText(pages.join('\n'));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function extractPdfContent(storageKey: string): Promise<PdfExtractionResult> {
  const pdfPath = join(env.STORAGE_DIR, storageKey);
  let buffer: Buffer;
  try {
    buffer = await readFile(pdfPath);
  } catch (error) {
    throw wrapExtractionError({
      error,
      code: 'PDF_READ_FAILED',
      stage: 'PDF_TEXT_EXTRACTION',
      message: 'Stored PDF could not be read',
      details: { storageKey }
    });
  }

  let parsed: Awaited<ReturnType<typeof pdf>>;
  try {
    parsed = await pdf(buffer);
  } catch (error) {
    throw wrapExtractionError({
      error,
      code: 'PDF_PARSE_FAILED',
      stage: 'PDF_TEXT_EXTRACTION',
      message: 'PDF text parser could not open or parse this file',
      details: {
        storageKey,
        fileSizeBytes: buffer.byteLength
      }
    });
  }

  const machineText = normalizeText(parsed.text);
  const pageCount = Number.isFinite(parsed.numpages) ? parsed.numpages : null;

  if (machineText.length >= 100) {
    return {
      text: machineText,
      extractionMode: 'PDF_TEXT',
      pageCount
    };
  }

  const ocrText = await runOcr(pdfPath);
  if (ocrText.length < 100) {
    throw new ExtractionPipelineError({
      code: 'OCR_TEXT_INSUFFICIENT',
      stage: 'OCR_RECOGNITION',
      message: 'PDF remains unreadable after OCR; manual review is required',
      details: {
        machineTextLength: machineText.length,
        ocrTextLength: ocrText.length,
        pageCount,
        ocrMaxPages: env.OCR_MAX_PAGES,
        ocrDpi: env.OCR_DPI
      }
    });
  }

  return {
    text: ocrText,
    extractionMode: 'OCR',
    pageCount
  };
}

export async function extractPdfText(storageKey: string) {
  return (await extractPdfContent(storageKey)).text;
}
