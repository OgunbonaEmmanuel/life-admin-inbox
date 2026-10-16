import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { assert } from './errors.js';
export interface Storage {
  put(userId: string, key: string, bytes: Buffer, mime: string): Promise<void>;
  get(userId: string, key: string): Promise<Buffer>;
  remove(userId: string, key: string): Promise<void>;
}
export function createStorage(root = path.join(config.dataDir, 'originals')): Storage {
  const supabase =
    config.supabaseService && config.supabaseUrl
      ? createClient(config.supabaseUrl, config.supabaseService, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            fetch: (url, options) =>
              fetch(url, { ...options, signal: AbortSignal.timeout(20_000) }),
          },
        })
      : null;
  function check(userId: string, key: string) {
    assert(
      key.startsWith(`${userId}/`) && /^[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(key),
      403,
      'Invalid private object path.',
    );
    return path.join(root, ...key.split('/'));
  }
  return {
    async put(userId, key, bytes, mime) {
      const file = check(userId, key);
      if (supabase) {
        const { error } = await supabase.storage
          .from(config.bucket)
          .upload(key, bytes, { contentType: mime, upsert: false });
        if (error) throw new Error('Private storage upload failed.');
      } else {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
      }
    },
    async get(userId, key) {
      const file = check(userId, key);
      if (supabase) {
        const { data, error } = await supabase.storage.from(config.bucket).download(key);
        if (error || !data) throw new Error('Private original unavailable.');
        return Buffer.from(await data.arrayBuffer());
      }
      return readFile(file);
    },
    async remove(userId, key) {
      const file = check(userId, key);
      if (supabase) {
        const { error } = await supabase.storage.from(config.bucket).remove([key]);
        if (error) throw new Error('Private storage deletion failed.');
      } else {
        try {
          await unlink(file);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
      }
    },
  };
}
