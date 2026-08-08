package app.flowrecall.android;

import android.view.ActionMode;
import com.getcapacitor.BridgeActivity;

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
