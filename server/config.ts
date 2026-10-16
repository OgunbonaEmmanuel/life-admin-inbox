import path from 'node:path';
const env = process.env;
export const config = {
  production: env.APP_MODE === 'production',
  port: Number(env.PORT || 3000),
  origin: env.APP_ORIGIN || 'http://localhost:3000',
  dataDir: path.resolve(env.LOCAL_DATA_DIR || '.local'),
  databaseUrl: env.DATABASE_URL || '',
  databaseCaPath: env.DATABASE_CA_PATH || '',
  supabaseUrl: env.SUPABASE_URL || '',
  supabaseAnon: env.SUPABASE_ANON_KEY || '',
  supabaseService: env.SUPABASE_SERVICE_ROLE_KEY || '',
  bucket: env.STORAGE_BUCKET || 'life-admin-originals',
  openaiKey: env.OPENAI_API_KEY || '',
  model: env.OPENAI_MODEL || 'gpt-4o-mini',
  emailProvider: env.EMAIL_PROVIDER || 'resend',
  resendKey: env.RESEND_API_KEY || '',
  emailFrom: env.EMAIL_FROM || '',
  testEmail: env.DEV_EMAIL_TO || '',
  vapidPublic: env.VAPID_PUBLIC_KEY || '',
  vapidPrivate: env.VAPID_PRIVATE_KEY || '',
  vapidSubject: env.VAPID_SUBJECT || '',
  testPush: (env.DEV_PUSH_ENDPOINTS || '').split(',').filter(Boolean),
};
export function validateConfig() {
  if (env.NODE_ENV === 'production' && !config.production)
    throw new Error('Production cannot use development adapters.');
  const origin = new URL(config.origin);
  if (!config.production && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
    throw new Error('Development adapters require a loopback origin.');
  if (
    config.production &&
    (origin.protocol !== 'https:' ||
      !config.databaseUrl ||
      !config.supabaseUrl ||
      !config.supabaseAnon ||
      !config.supabaseService)
  )
    throw new Error('Production requires HTTPS, Postgres and Supabase auth/storage configuration.');
}
export const LIMITS = {
  bytes: 8 * 1024 * 1024,
  pages: 10,
  pixels: 16_000_000,
  dimension: 6000,
  zipBytes: 12 * 1024 * 1024,
  zipEntries: 250,
  text: 40_000,
  parserMs: 25_000,
  extractionMs: 180_000,
  tasks: 30,
  uploadsPerDay: 20,
  extractionsPerDay: 30,
  retriesPerDocument: 3,
} as const;
