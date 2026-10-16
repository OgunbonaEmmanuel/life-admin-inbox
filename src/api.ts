import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../shared/types';
let client: SupabaseClient | null = null;
let development = false;
export function configure(config: AppConfig) {
  if (config.authConfigured)
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  return client;
}
export const auth = () => client;
export function useDevelopment(value: boolean) {
  development = value;
}
export async function request(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (development) headers.set('X-Development-User', 'demo');
  else {
    const session = await client?.auth.getSession();
    if (session?.data.session)
      headers.set('Authorization', `Bearer ${session.data.session.access_token}`);
  }
  const response = await fetch(`/api${path}`, { ...options, headers });
  if (!response.ok) {
    const result = await response
      .json()
      .catch(() => ({ error: 'The server could not complete this request.' }));
    throw new Error(result.error);
  }
  return response;
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  return (
    await request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  ).json();
}
export async function download(id: string, name: string) {
  const response = await request(`/documents/${id}/download`);
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
