package com.sterlinglams.driver;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

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

    /**
     * Whether Android's battery saver is allowed to suspend this app.
     *
     * A foreground service is not sufficient on its own: the system still
     * sleeps apps it considers idle, which is what left gaps in riders'
     * trails. Reported separately from the request so the app can show the
     * state rather than prompting a driver who has already granted it.
     */
    @PluginMethod
    public void batteryStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("exempt", isExempt());
        call.resolve(result);
    }

    /**
     * Ask for exemption from battery optimisation.
     *
     * Opens the system dialog. Android does not allow this to be granted
     * silently, and it is the driver's choice — so the honest outcome is
     * either a granted exemption or a visible reason why reporting may stall.
     */
    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        if (isExempt()) {
            JSObject already = new JSObject();
            already.put("exempt", true);
            call.resolve(already);
            return;
        }

        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception e) {
            // Some OEMs ship without the standard screen. Fall back to the
            // app's settings page rather than failing silently, so a driver
            // still has somewhere to go.
            try {
                Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                fallback.setData(Uri.parse("package:" + getContext().getPackageName()));
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
            } catch (Exception ignored) {
                call.reject("Could not open battery settings: " + e.getMessage());
                return;
            }
        }

        JSObject result = new JSObject();
        result.put("exempt", false);
        call.resolve(result);
    }

    private boolean isExempt() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), TrackingService.class));
        call.resolve();
    }
}
