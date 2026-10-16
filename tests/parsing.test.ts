import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import yazl from 'yazl';
import { parseBuffer, sniff } from '../server/parsing';
import { parseIsolated } from '../server/parser';
async function zip(entries: Record<string, string>) {
  const archive = new yazl.ZipFile();
  for (const [name, text] of Object.entries(entries)) archive.addBuffer(Buffer.from(text), name);
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    archive.outputStream.on('data', (c) => chunks.push(c));
    archive.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    archive.outputStream.on('error', reject);
  });
  archive.end();
  return result;
}
describe('bounded content-based ingestion', () => {
  it('extracts PDF text with page references in an isolated process', async () => {
    const parsed = await parseIsolated(await readFile('public/demo/synthetic-bill.pdf'));
    expect(parsed.sources[0].page).toBe(1);
    expect(parsed.sources[0].text).toContain('Payment due 2026-10-15');
    expect(parsed.images).toHaveLength(0);
  });
  it('extracts DOCX paragraphs and table references without invented pages', async () => {
    const parsed = await parseBuffer(await readFile('public/demo/synthetic-school.docx'));
    expect(parsed.sources.some((s) => s.label === 'Table 1, row 1')).toBe(true);
    expect(parsed.sources.every((s) => s.page === undefined)).toBe(true);
    expect(parsed.sources.map((s) => s.text).join(' ')).toContain('permission form');
  });
  it('uses images for screenshots and scanned PDF pages', async () => {
    for (const file of [
      'synthetic-appointment.png',
      'synthetic-appointment.jpg',
      'synthetic-scanned.pdf',
    ]) {
      const parsed = await parseIsolated(await readFile(`public/demo/${file}`));
      expect(parsed.images).toHaveLength(1);
      expect(parsed.sources[0].ocr).toBe(true);
    }
  });
  it('rejects forged extensions, malformed files and oversized bytes', async () => {
    expect(() => sniff(Buffer.from('not a PDF, just arbitrary text'))).toThrow();
    await expect(parseBuffer(Buffer.from('%PDF-invalid data'))).rejects.toThrow();
    expect(() => sniff(Buffer.alloc(8 * 1024 * 1024 + 1))).toThrow();
  });
  it('rejects excessive PDF pages and image dimensions', async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 11; i++) doc.addPage();
    await expect(parseBuffer(Buffer.from(await doc.save()))).rejects.toThrow('10 pages');
    const image = await sharp({
      create: { width: 6001, height: 1, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await expect(parseBuffer(image)).rejects.toThrow('6000');
  });
  it('rejects ZIP bombs, archives without DOCX content, macros and XML entities', async () => {
    await expect(parseBuffer(await zip({ 'a.txt': 'not docx' }))).rejects.toThrow();
    await expect(
      parseBuffer(
        await zip({
          '[Content_Types].xml': 'types',
          'word/document.xml': 'x'.repeat(2 * 1024 * 1024),
        }),
      ),
    ).rejects.toThrow();
    await expect(
      parseBuffer(
        await zip({
          '[Content_Types].xml': 'types',
          'word/document.xml':
            '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><w:document/>',
          'word/vbaProject.bin': 'macro',
        }),
      ),
    ).rejects.toThrow();
  });
});
