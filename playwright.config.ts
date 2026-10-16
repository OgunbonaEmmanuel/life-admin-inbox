import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHANNEL },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3100/healthz',
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      PORT: '3100',
      APP_ORIGIN: 'http://127.0.0.1:3100',
      APP_MODE: 'development',
      LOCAL_DATA_DIR: '.local/browser-tests',
      OPENAI_API_KEY: '',
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      DATABASE_URL: '',
      RESEND_API_KEY: '',
      VAPID_PUBLIC_KEY: '',
      VAPID_PRIVATE_KEY: '',
    },
  },
});
