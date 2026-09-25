package com.sterlinglams.driver;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Starts and stops {@link TrackingService}.
 *
 * JavaScript's only remaining job in location reporting is handing over the
 * API origin and the driver's session token once, at sign-in. Everything after
 * that happens natively, so reporting continues when Android suspends the
 * WebView — which is what made a rider vanish from the dispatch map the moment
 * they left the app.
 */
@CapacitorPlugin(name = "NativeTracker")
public class NativeTrackerPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String apiBase = call.getString("apiBase");
        String token = call.getString("token");
        String driverId = call.getString("driverId");

        if (apiBase == null || driverId == null) {
            call.reject("apiBase and driverId are required");
            return;
        }

        Intent intent = new Intent(getContext(), TrackingService.class);
        intent.putExtra(TrackingService.EXTRA_API_BASE, apiBase);
        intent.putExtra(TrackingService.EXTRA_TOKEN, token);
        intent.putExtra(TrackingService.EXTRA_DRIVER_ID, driverId);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
        } catch (Exception e) {
            // Android refuses to start a foreground service from the
            // background in some states. Reported rather than swallowed: the
            // caller falls back to WebView reporting, which is degraded but
            // better than silence.
            call.reject("Could not start tracking service: " + e.getMessage());
            return;
        }

        JSObject result = new JSObject();
        result.put("started", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), TrackingService.class));
        call.resolve();
    }
}
