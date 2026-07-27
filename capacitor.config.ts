import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.flowrecall.android',
  appName: 'FlowRecall',
  webDir: 'out',
  // https (not the default capacitor://) so the local shell and the live API
  // origin share a scheme - avoids mixed-content quirks in the WebView.
  server: {
    androidScheme: 'https',
  },
  plugins: {
    // Routes fetch()/XHR through native OkHttp instead of the WebView's own
    // networking stack, and gives it a real native cookie jar. This is what
    // lets the NextAuth session cookie set by the cross-origin API
    // (NEXT_PUBLIC_API_URL) persist across requests/app relaunches, and is
    // why the CORS proxy in src/proxy.ts is only a defense-in-depth fallback
    // rather than the primary mechanism - verify on-device during testing.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
