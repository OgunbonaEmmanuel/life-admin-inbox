import { parseBuffer } from './parsing.js';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  input += chunk;
  if (input.length > 12_000_000) process.exit(1);
});
process.stdin.on('end', async () => {
  try {
    const parsed = await parseBuffer(Buffer.from(input, 'base64'));
    process.stdout.write(JSON.stringify({ parsed }), () => process.exit(0));
  } catch {
    process.stdout.write(
      JSON.stringify({
        error:
          'File parsing failed. Check file integrity and the documented size, page, image and decompression limits.',
      }),
      () => process.exit(1),
    );
  }
});
