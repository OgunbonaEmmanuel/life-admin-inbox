import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LIMITS } from './config.js';
import { AppError } from './errors.js';
import type { Parsed } from './parsing.js';
export async function parseIsolated(bytes: Buffer): Promise<Parsed> {
  const dev = import.meta.url.endsWith('.ts');
  const file = fileURLToPath(new URL(`./parser-child.${dev ? 'ts' : 'js'}`, import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--max-old-space-size=256', ...(dev ? ['--import', 'tsx'] : []), file],
      {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP },
      },
    );
    let output = '',
      killed = false;
    const stop = () => {
      killed = true;
      child.kill();
    };
    const timer = setTimeout(stop, LIMITS.parserMs);
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 45_000_000) stop();
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(new AppError(400, 'Unable to start isolated document parser.'));
    });
    child.on('close', () => {
      clearTimeout(timer);
      if (killed)
        return reject(new AppError(400, 'Document exceeded parsing time or output limit.'));
      try {
        // PDF libraries may emit diagnostics before the single JSON payload.
        const start = output.indexOf('{"parsed":');
        const result = JSON.parse(start >= 0 ? output.slice(start) : output);
        if (result.error) throw new Error();
        resolve(result.parsed);
      } catch {
        reject(
          new AppError(
            400,
            'Invalid document or exceeded parser limits. Encrypted PDFs and macro-enabled documents are not supported.',
          ),
        );
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes.toString('base64'));
  });
}
