package app.flowrecall.android;

import android.view.ActionMode;
import com.getcapacitor.BridgeActivity;

/** No system-bar code here on purpose, and the reason is worth keeping.
 *
 * This class used to force LIGHT system-bar icons in onCreate with
 * WindowInsetsControllerCompat, because the `android:windowLightStatusBar`
 * theme attribute could not: it is read when the window is created, and this
 * window is created under the splash theme and only swapped to
 * AppTheme.NoActionBar afterwards through postSplashScreenTheme - a setTheme()
 * call, which does not re-apply window decor attributes.
 *
 * The runtime call did not hold either, which was measured rather than
 * reasoned about: on an API 36 emulator, with that code present and running,
 * `dumpsys window` still reported `mLastAppearance=LIGHT_STATUS_BARS
 * LIGHT_NAVIGATION_BARS` and the status strip measured 5/255 in a screenshot -
 * an invisible clock, wifi and battery. Capacitor 8 ships its own SystemBars
 * plugin which resolves style "DEFAULT" from the *system* night mode and
 * applies it through `Bridge.executeOnMainThread`, i.e. in a task posted after
 * this onCreate returns. It won, every launch, on any phone not in dark mode.
 *
 * So the decision now lives in one place that the plugin itself reads rather
 * than overwrites: `SystemBars.style` in capacitor.config.ts, which that
 * comment explains in full - including why it is a constant instead of
 * something driven from the app's own light/dark preference. */
public class MainActivity extends BridgeActivity {

    @Override
    public void onActionModeStarted(ActionMode mode) {
        super.onActionModeStarted(mode);
        // Instantly kill the native text selection action mode ("Copy | Share")
        // so FlowRecall's own React popup can take precedence.
        if (mode != null) {
            mode.finish();
        }
    }
}
