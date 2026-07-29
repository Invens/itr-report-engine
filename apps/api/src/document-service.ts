import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pdf from 'pdf-parse';
import { env } from './config.js';

const execFileAsync = promisify(execFile);

export type PdfExtractionResult = {
  text: string;
  extractionMode: 'PDF_TEXT' | 'OCR';
  pageCount: number | null;
};

export async function persistUpload(buffer: Buffer, originalName: string) {
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const directory = join(env.STORAGE_DIR, 'uploads', sha256.slice(0, 2));
  await mkdir(directory, { recursive: true });
  const storageKey = join('uploads', sha256.slice(0, 2), `${sha256}.pdf`);
  await writeFile(join(env.STORAGE_DIR, storageKey), buffer, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  return { sha256, storageKey, originalName };
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
    await execFileAsync('pdftoppm', [
      '-f', '1',
      '-l', String(env.OCR_MAX_PAGES),
      '-r', String(env.OCR_DPI),
      '-png',
      pdfPath,
      imagePrefix
    ], { maxBuffer: 20 * 1024 * 1024 });

    const images = (await readdir(workDir))
      .filter((file) => file.startsWith('page-') && file.endsWith('.png'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (images.length === 0) throw new Error('OCR renderer produced no page images');

    const pages: string[] = [];
    for (const [index, image] of images.entries()) {
      const { stdout } = await execFileAsync('tesseract', [
        join(workDir, image),
        'stdout',
        '-l', 'eng',
        '--psm', '6'
      ], { maxBuffer: 20 * 1024 * 1024 });
      pages.push(`\n--- OCR PAGE ${index + 1} ---\n${stdout}`);
    }

    return normalizeText(pages.join('\n'));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function extractPdfContent(storageKey: string): Promise<PdfExtractionResult> {
  const pdfPath = join(env.STORAGE_DIR, storageKey);
  const buffer = await readFile(pdfPath);
  const parsed = await pdf(buffer);
  const machineText = normalizeText(parsed.text);

  if (machineText.length >= 100) {
    return {
      text: machineText,
      extractionMode: 'PDF_TEXT',
      pageCount: Number.isFinite(parsed.numpages) ? parsed.numpages : null
    };
  }

  const ocrText = await runOcr(pdfPath);
  if (ocrText.length < 100) {
    throw new Error('PDF remains unreadable after OCR; manual review is required');
  }

  return {
    text: ocrText,
    extractionMode: 'OCR',
    pageCount: Number.isFinite(parsed.numpages) ? parsed.numpages : null
  };
}

export async function extractPdfText(storageKey: string) {
  return (await extractPdfContent(storageKey)).text;
}
