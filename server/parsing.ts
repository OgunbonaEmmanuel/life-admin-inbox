import sharp from 'sharp';
import yauzl from 'yauzl';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { LIMITS } from './config.js';
import { AppError, assert } from './errors.js';
import type { Source } from '../shared/types.js';
export interface Parsed {
  mime: string;
  sources: Source[];
  images: { sourceId: string; data: string }[];
}
export function sniff(bytes: Buffer): string {
  assert(
    bytes.length > 8 && bytes.length <= LIMITS.bytes,
    400,
    'Files must be nonempty and no larger than 8 MB.',
  );
  if (bytes.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])))
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  throw new AppError(400, 'The file content is not a supported PDF, DOCX, PNG or JPEG.');
}
async function docxXml(bytes: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(new AppError(400, 'Invalid DOCX archive.'));
      let total = 0,
        count = 0,
        xml = '',
        contentTypes = false,
        failed = false;
      const fail = () => {
        if (!failed) {
          failed = true;
          zip.close();
          reject(
            new AppError(
              400,
              'DOCX is malformed, encrypted, contains macros, or exceeds decompression limits.',
            ),
          );
        }
      };
      zip.on('error', fail);
      zip.on('entry', (entry: yauzl.Entry) => {
        count++;
        total += entry.uncompressedSize;
        if (
          count > LIMITS.zipEntries ||
          total > LIMITS.zipBytes ||
          entry.generalPurposeBitFlag & 1 ||
          /vbaProject|\.bin$/i.test(entry.fileName) ||
          entry.uncompressedSize > Math.max(1024 * 1024, entry.compressedSize * 150)
        )
          return fail();
        if (entry.fileName === '[Content_Types].xml') contentTypes = true;
        if (entry.fileName !== 'word/document.xml') {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return fail();
          const chunks: Buffer[] = [];
          let size = 0;
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > LIMITS.zipBytes) {
              stream.destroy();
              fail();
            } else chunks.push(chunk);
          });
          stream.on('error', fail);
          stream.on('end', () => {
            xml = Buffer.concat(chunks).toString('utf8');
            if (!failed) zip.readEntry();
          });
        });
      });
      zip.on('end', () => {
        if (failed) return;
        if (!contentTypes || !xml || /<!DOCTYPE|<!ENTITY/i.test(xml)) fail();
        else resolve(xml);
      });
      zip.readEntry();
    });
  });
}
type XmlNode = Record<string, unknown>;
function children(node: XmlNode, key: string): XmlNode[] {
  return Array.isArray(node[key]) ? (node[key] as XmlNode[]) : [];
}
function xmlText(nodes: XmlNode[]): string {
  return nodes
    .map((n) =>
      '#text' in n
        ? String(n['#text'])
        : Object.entries(n)
            .filter(([k]) => k !== ':@')
            .map(([k, v]) =>
              k === 'w:tab' || k === 'w:br' ? ' ' : Array.isArray(v) ? xmlText(v) : '',
            )
            .join(''),
    )
    .join('');
}
export async function parseBuffer(bytes: Buffer): Promise<Parsed> {
  const mime = sniff(bytes),
    sources: Source[] = [],
    images: Parsed['images'] = [];
  if (mime.startsWith('image/')) {
    const input = sharp(bytes, { limitInputPixels: LIMITS.pixels, failOn: 'warning' });
    const meta = await input.metadata();
    assert(
      meta.width &&
        meta.height &&
        meta.width <= LIMITS.dimension &&
        meta.height <= LIMITS.dimension &&
        (meta.pages || 1) === 1,
      400,
      'Images must be single-frame, at most 6000 px per side and 16 megapixels.',
    );
    const image = await input
      .rotate()
      .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    sources.push({
      id: 'image:1',
      label: 'Screenshot · image 1',
      kind: 'image',
      text: '',
      ocr: true,
    });
    images.push({ sourceId: 'image:1', data: image.toString('base64') });
  } else if (mime === 'application/pdf') {
    const canvas = await import('@napi-rs/canvas');
    Object.assign(globalThis, {
      DOMMatrix: canvas.DOMMatrix,
      ImageData: canvas.ImageData,
      Path2D: canvas.Path2D,
    });
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    class CanvasFactory {
      create(width: number, height: number) {
        const c = canvas.createCanvas(Math.ceil(width), Math.ceil(height));
        return { canvas: c, context: c.getContext('2d') };
      }
      reset(target: { canvas: { width: number; height: number } }, w: number, h: number) {
        target.canvas.width = w;
        target.canvas.height = h;
      }
      destroy(target: { canvas: unknown; context: unknown }) {
        target.canvas = null;
        target.context = null;
      }
    }
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      stopAtErrors: true,
      CanvasFactory: CanvasFactory as never,
    }).promise;
    try {
      assert(pdf.numPages <= LIMITS.pages, 400, 'PDFs can contain at most 10 pages.');
      for (let page = 1; page <= pdf.numPages; page++) {
        const p = await pdf.getPage(page);
        const text = (await p.getTextContent()).items
          .map((i) => ('str' in i ? `${i.str}${i.hasEOL ? '\n' : ' '}` : ''))
          .join('')
          .trim();
        const source: Source = {
          id: `page:${page}`,
          label: `Page ${page}`,
          page,
          kind: 'pdf',
          text,
        };
        sources.push(source);
        const ops = await p.getOperatorList();
        if (
          text.length < 40 ||
          ops.fnArray.some((n) =>
            [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject].includes(n),
          )
        ) {
          const base = p.getViewport({ scale: 1 });
          const scale = Math.min(2, 1800 / Math.max(base.width, base.height));
          const viewport = p.getViewport({ scale });
          assert(
            viewport.width * viewport.height <= 3_300_000,
            400,
            'PDF page dimensions exceed the rendering limit.',
          );
          const c = canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          await p.render({
            canvasContext: c.getContext('2d') as never,
            canvas: c as never,
            viewport,
          }).promise;
          images.push({ sourceId: source.id, data: c.toBuffer('image/png').toString('base64') });
          source.ocr = true;
        }
        p.cleanup();
      }
    } finally {
      await pdf.destroy();
    }
  } else {
    const xml = await docxXml(bytes);
    assert(XMLValidator.validate(xml) === true, 400, 'DOCX document XML is malformed.');
    const tree = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: true,
      processEntities: true,
      trimValues: false,
    }).parse(xml) as XmlNode[];
    const document = tree.find((n) => 'w:document' in n);
    const body = document && children(document, 'w:document').find((n) => 'w:body' in n);
    assert(body, 400, 'DOCX has no valid document body.');
    let paragraph = 0,
      table = 0;
    for (const node of children(body, 'w:body')) {
      if ('w:p' in node) {
        paragraph++;
        const text = xmlText(children(node, 'w:p')).trim();
        if (text)
          sources.push({
            id: `paragraph:${paragraph}`,
            label: `Paragraph ${paragraph}`,
            kind: 'docx',
            text,
          });
      } else if ('w:tbl' in node) {
        table++;
        let row = 0;
        for (const r of children(node, 'w:tbl').filter((n) => 'w:tr' in n)) {
          row++;
          const text = children(r, 'w:tr')
            .filter((n) => 'w:tc' in n)
            .map((c) => xmlText(children(c, 'w:tc')).trim())
            .join(' | ');
          if (text)
            sources.push({
              id: `table:${table}:row:${row}`,
              label: `Table ${table}, row ${row}`,
              kind: 'docx',
              text,
            });
        }
      }
    }
  }
  assert(
    sources.reduce((sum, s) => sum + s.text.length, 0) <= LIMITS.text,
    400,
    'Extracted document text exceeds 40,000 characters. Split the document.',
  );
  assert(sources.length <= 400, 400, 'Document contains too many source sections.');
  return { mime, sources, images };
}
