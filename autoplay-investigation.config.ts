import config from './playwright.config';
export default {
  ...config,
  projects: [
    {
      name: 'baseline',
      testMatch: /autoplay\.spec\.ts/,
      use: { baseURL: 'http://127.0.0.1:4273' },
    },
    {
      name: 'production',
      testMatch: /autoplay-production\.spec\.ts/,
      use: { baseURL: 'http://localhost:4173' },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4273 --strictPort',
    url: 'http://127.0.0.1:4273',
    reuseExistingServer: false,
  },
};
