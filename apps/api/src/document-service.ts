import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pdf from 'pdf-parse';
import { env } from './config.js';

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

export async function extractPdfText(storageKey: string) {
  const buffer = await readFile(join(env.STORAGE_DIR, storageKey));
  const result = await pdf(buffer);
  const normalized = result.text.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').trim();
  if (normalized.length < 100) {
    throw new Error('PDF contains insufficient machine-readable text; OCR review is required');
  }
  return normalized;
}
