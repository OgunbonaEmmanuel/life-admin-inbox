import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import yazl from 'yazl';
import sharp from 'sharp';
const dir = 'public/demo';
await mkdir(dir, { recursive: true });
async function pdf(name: string, lines: string[]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [i, line] of lines.entries())
    page.drawText(line, {
      x: 50,
      y: 780 - i * 34,
      size: i === 0 ? 18 : 12,
      font,
      color: rgb(0.12, 0.27, 0.2),
    });
  await writeFile(`${dir}/${name}`, await doc.save());
}
await pdf('synthetic-bill.pdf', [
  'SYNTHETIC DEMO - NOT A REAL BILL',
  'Evergreen Energy',
  'Invoice issued: 2026-10-01',
  'Amount outstanding: USD 184.50.',
  'Payment due 2026-10-15.',
  'Please pay the outstanding balance by the payment deadline.',
]);
await pdf('synthetic-paid-receipt.pdf', [
  'SYNTHETIC DEMO - NOT A REAL RECEIPT',
  'Evergreen Energy',
  'Payment received 2026-10-01: USD 184.50.',
  'Paid in full. Balance due: 0.00.',
  'No further payment is required.',
]);
await pdf('synthetic-multiple.pdf', [
  'SYNTHETIC DEMO - FICTIONAL OBLIGATIONS',
  'Northside Learning',
  'Please return the registration form by 2026-11-12.',
  'Please pay the course fee of NGN 25000 by 2026-11-14.',
  'An example from last year: payment was due 2025-11-10.',
]);
const zip = new yazl.ZipFile();
zip.addBuffer(
  Buffer.from(
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  ),
  '[Content_Types].xml',
);
zip.addBuffer(
  Buffer.from(
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  ),
  '_rels/.rels',
);
zip.addBuffer(
  Buffer.from(
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>SYNTHETIC DEMO - FICTIONAL SCHOOL LETTER</w:t></w:r></w:p><w:p><w:r><w:t>Willow Primary School</w:t></w:r></w:p><w:p><w:r><w:t>Please return the signed field trip permission form by 2026-10-20.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Class project</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Submit your project by 2026-10-23.</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
  ),
  'word/document.xml',
);
const chunks: Buffer[] = [];
const done = new Promise<Buffer>((resolve, reject) => {
  zip.outputStream.on('data', (c) => chunks.push(c));
  zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  zip.outputStream.on('error', reject);
});
zip.end();
await writeFile(`${dir}/synthetic-school.docx`, await done);
const image = await sharp(
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="650"><rect width="1200" height="650" fill="#f8f5ea"/><g font-family="sans-serif" fill="#254f40"><text x="60" y="90" font-size="22">SYNTHETIC DEMO - NOT A REAL APPOINTMENT</text><text x="60" y="190" font-size="38">Maple Dental Studio</text><text x="60" y="280" font-size="28">Your dental check-up is confirmed.</text><text x="60" y="360" font-size="28">2026-10-16 at 14:30 Africa/Lagos</text><text x="60" y="480" font-size="20">All names and details in this sample are fictional.</text></g></svg>',
  ),
)
  .png()
  .toBuffer();
await writeFile(`${dir}/synthetic-appointment.png`, image);
await writeFile(`${dir}/synthetic-appointment.jpg`, await sharp(image).jpeg().toBuffer());
const scanned = await PDFDocument.create();
const scan = scanned.addPage([600, 325]);
scan.drawImage(await scanned.embedPng(image), { x: 0, y: 0, width: 600, height: 325 });
await writeFile(`${dir}/synthetic-scanned.pdf`, await scanned.save());
console.log(
  'Seven labelled synthetic demo files generated in public/demo. No external services used.',
);
