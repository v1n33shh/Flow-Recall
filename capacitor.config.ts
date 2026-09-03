import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.flowrecall.android',
  appName: 'FlowRecall',
  webDir: 'out',
  // https (not the default capacitor://) so the local shell and the live API
  // origin share a scheme - avoids mixed-content quirks in the WebView.
  server: {
    androidScheme: 'https',
    // Where Capacitor sends the WebView when minWebViewVersion below is not met.
    // WITHOUT THIS, minWebViewVersion does almost nothing: Bridge.java only
    // redirects when getErrorUrl() is non-null, and otherwise logs
    // MINIMUM_ANDROID_WEBVIEW_ERROR and carries straight on into the app - which
    // on an old WebView means the broken render this is here to prevent. Served
    // from webDir, so the file lives in public/ and Next copies it into out/.
    errorPath: 'webview-too-old.html',
  },
  android: {
    // Measured, not chosen. The shipped stylesheet
    // (out/_next/static/chunks/*.css, 95,832 bytes at the time of writing)
    // contains 225 color-mix() and 16 lab() declarations, because Tailwind v4
    // emits color-mix() for every opacity modifier - bg-surface/60, text-accent/70
    // and the like, which is most of this UI. color-mix() is Chrome 111.
    //
    // Capacitor's own default floor is 60 (Bridge.DEFAULT_ANDROID_WEBVIEW_VERSION),
    // and an unsupported color-mix() invalidates the whole declaration rather than
    // degrading, so between 60 and 110 the app installs, boots, passes the check
    // and renders with every translucent surface, border and overlay silently
    // gone. Raising minSdkVersion would NOT fix that: the WebView updates through
    // Play independently of the OS, so a current Android phone with updates
    // disabled fails and an Android 7 phone with a fresh WebView is fine. The
    // version of the browser is the thing to gate on, so it is the thing gated.
    //
    // If Tailwind is ever upgraded or replaced, re-measure before trusting this
    // number: grep the built CSS for the newest feature it emits.
    minWebViewVersion: 111,
    // Off by default: a shipped release must not expose its WebView to
    // chrome://inspect. `DEVTOOLS=1 npm run build:apk` turns it on for a local
    // release build so an actual release (not a debug build, which installs
    // over the user's library and wipes it) can be inspected on-device - which
    // is the only way to see console output or run timings inside the real
    // Android WebView. Re-run the build without DEVTOOLS before shipping.
    webContentsDebuggingEnabled: process.env.DEVTOOLS === '1',
    // Without this, a DEVTOOLS build still cannot show console output in
    // logcat: Capacitor's own logging (which is what forwards
    // console.log through BridgeWebChromeClient.onConsoleMessage)
    // defaults to 'debug', and 'debug' means "only when the APK is
    // debuggable" - which a release APK is not. Gated on the same flag,
    // so a shipped release is silent as before.
    loggingBehavior: process.env.DEVTOOLS === '1' ? 'production' : 'debug',
  },
  plugins: {
    // Makes the status bar clock, wifi and battery VISIBLE. Measured, and it
    // was invisible without this line: Capacitor 8 ships its own SystemBars
    // plugin whose default style 'DEFAULT' is resolved from
    // Configuration.UI_MODE_NIGHT_MASK - the *system* night mode - so a phone
    // in LIGHT mode gets LIGHT_STATUS_BARS, i.e. dark glyphs, drawn over this
    // app's near-black bars. Read back on an API 36 emulator as
    // `mLastAppearance=LIGHT_STATUS_BARS` with the status strip measuring
    // 5/255 in a screenshot; 255/255 with it. A developer whose own phone sits
    // in dark mode never sees the bug, which is why it survived the tranche
    // that went looking for exactly this.
    //
    // 'DARK' means "light content on a dark background", and it is deliberately
    // a CONSTANT rather than something driven from the app's own light/dark
    // preference. That was tried and measured wrong: with data-theme="light"
    // the body token does go near-white (rgb(252,252,252)) but every page
    // except the token-based Account screen paints its own hardcoded dark
    // background over the full viewport (see globals.css's own note on that
    // deliberate scope), so the strip behind the clock stayed at 5/255 and
    // theme-following glyphs went dark on dark - invisible again, on more
    // screens than it fixed. Checked the other way too, with the app switched
    // to light: Home and the Account tab both kept a dark strip behind the bar
    // (5/255 at the top, light content further down) and the light glyphs
    // stayed readable at 255. The one case that could still bite is the
    // SIGNED-IN Account screen, the only fully token-based surface in the app -
    // it needs an account to reach and has not been measured. Revisit that when
    // the token migration finishes.
    //
    // It also survives a system dark/light switch: SystemBars re-applies
    // `currentStatusBarStyle` in handleOnConfigurationChanged, and that field
    // holds this value rather than the freshly-resolved system one.
    SystemBars: {
      style: 'DARK',
    },
    // Routes fetch()/XHR through native OkHttp instead of the WebView's own
    // networking stack, and gives it a real native cookie jar. This is what
    // lets the NextAuth session cookie set by the cross-origin API
    // (NEXT_PUBLIC_API_URL) persist across requests/app relaunches, and is
    // why the CORS proxy in src/proxy.ts is only a defense-in-depth fallback
    // rather than the primary mechanism - verify on-device during testing.
    CapacitorHttp: {
      enabled: true,
    },
    // The "Seamless Splash Handoff" pattern: this plugin installs the native
    // Android 12+ SplashScreen (see styles.xml's AppTheme.NoActionBarLaunch)
    // on launch and keeps it on-screen - launchAutoHide is NOT false, on
    // purpose, so a JS crash before AppLoader mounts can't brick the launch
    // behind a permanent splash; launchShowDuration is just a generous safety
    // ceiling. In the normal case, src/components/AppLoader.tsx calls
    // SplashScreen.hide() within a couple of frames of mounting, long before
    // this ceiling is ever reached.
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 6000,
      launchFadeOutDuration: 300,
      backgroundColor: "#050505",
      androidSplashResourceName: "splash",
      // CENTER_INSIDE, not CENTER_CROP: some OEM skins (e.g. ColorOS) don't
      // take the Android 12+ SplashScreen icon path styles.xml relies on and
      // fall back to this legacy full-bleed drawable/splash.png instead -
      // CENTER_CROP would then crop into the mark itself on any aspect ratio
      // that doesn't match the source image exactly. CENTER_INSIDE guarantees
      // the whole mark is always visible, at worst with extra letterboxing.
      androidScaleType: "CENTER_INSIDE",
      showSpinner: false,
    },
  },
};

export default config;
