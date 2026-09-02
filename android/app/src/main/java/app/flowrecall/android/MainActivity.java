package app.flowrecall.android;

import android.os.Bundle;
import android.view.ActionMode;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Forces LIGHT system-bar icons, because the theme attribute could not.
     *
     * Android 15+ enforces edge-to-edge for a targetSdk 35+ app: the status and
     * navigation bars go transparent and the app's own window background shows
     * through them. styles.xml sets that background to #050505 so the bars match
     * the app - but the icons drawn on top of it are a separate decision, and
     * `android:windowLightStatusBar="false"` in the same style did NOT take. Read
     * back from the running app on an API 36 emulator, the system still reported
     * `mLastAppearance=LIGHT_STATUS_BARS LIGHT_NAVIGATION_BARS`, i.e. DARK icons -
     * which against a near-black bar measured 5/255 in a screenshot. The clock,
     * wifi and battery were invisible.
     *
     * The theme attribute is read when the window is created, and this Activity's
     * window is created under the splash theme (AppTheme.NoActionBarLaunch) and
     * only swapped to AppTheme.NoActionBar afterwards through
     * postSplashScreenTheme - a setTheme() call, which does not re-apply window
     * decor attributes. So the value that sticks is the splash theme's, not ours.
     *
     * WindowInsetsControllerCompat is the documented runtime API for this and runs
     * after that swap, which is why it is here rather than in XML. Verified the
     * same way it was diagnosed: `dumpsys window` must no longer report
     * LIGHT_STATUS_BARS, and the icons must measure bright against #050505. */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
            getWindow(),
            getWindow().getDecorView()
        );
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
    }

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
