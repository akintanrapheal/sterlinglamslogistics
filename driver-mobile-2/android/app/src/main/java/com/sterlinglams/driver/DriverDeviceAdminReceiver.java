package com.sterlinglams.driver;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Device administrator receiver.
 *
 * Its existence is the point: while this component holds active admin rights
 * Android will not uninstall the app, which stops the casual removal that a
 * company-owned phone is exposed to.
 *
 * The callbacks are used for reporting rather than enforcement. When a driver
 * revokes admin rights that is the clearest possible signal that the app is
 * about to be removed, and it is far more useful to the office as an alert
 * than as a silent event.
 */
public class DriverDeviceAdminReceiver extends DeviceAdminReceiver {

    private static final String TAG = "DriverDeviceAdmin";

    @Override
    public void onEnabled(Context context, Intent intent) {
        Log.i(TAG, "Device admin enabled");
    }

    /**
     * Shown to the driver when they attempt to disable admin rights.
     *
     * Android displays this before completing the action, so it is the one
     * chance to say plainly what is about to happen rather than letting it
     * look like an ordinary settings toggle.
     */
    @Override
    public CharSequence onDisableRequested(Context context, Intent intent) {
        return "This phone is company property. Removing this protection stops "
                + "vehicle tracking and will be reported to the office.";
    }

    @Override
    public void onDisabled(Context context, Intent intent) {
        // The app can be uninstalled from this moment. Recorded locally so the
        // next successful sync can report it, since there may be no network
        // at the moment it happens.
        Log.w(TAG, "Device admin disabled — app is now removable");
        context.getSharedPreferences("driver_admin", Context.MODE_PRIVATE)
                .edit()
                .putLong("adminDisabledAt", System.currentTimeMillis())
                .apply();
    }
}
