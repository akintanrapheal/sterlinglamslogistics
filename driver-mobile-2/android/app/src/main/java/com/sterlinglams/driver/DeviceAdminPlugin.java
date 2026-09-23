package com.sterlinglams.driver;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridge to Android's device administration APIs.
 *
 * Exposes only what the app needs to protect itself on a company-owned
 * phone: whether admin rights are held, a way to ask for them, and whether
 * the phone is fully managed.
 *
 * Nothing here can grant rights on its own — Android always shows the user a
 * confirmation screen, and that is not bypassable. The value is in making
 * removal deliberate and detectable rather than a long-press away.
 */
@CapacitorPlugin(name = "DeviceAdmin")
public class DeviceAdminPlugin extends Plugin {

    private ComponentName component() {
        return new ComponentName(getContext(), DriverDeviceAdminReceiver.class);
    }

    private DevicePolicyManager dpm() {
        return (DevicePolicyManager) getContext().getSystemService(Context.DEVICE_POLICY_SERVICE);
    }

    /**
     * Current protection state.
     *
     * `deviceOwner` is the meaningful one. An app that is merely a device
     * admin can have its rights revoked from Settings; a device owner on a
     * fully managed phone cannot, and uninstall is genuinely blocked. Both
     * are reported so the app can tell the office which it is actually
     * running under rather than assuming.
     */
    @PluginMethod
    public void status(PluginCall call) {
        DevicePolicyManager dpm = dpm();
        JSObject result = new JSObject();
        boolean isAdmin = dpm != null && dpm.isAdminActive(component());
        boolean isOwner = dpm != null && dpm.isDeviceOwnerApp(getContext().getPackageName());
        result.put("isAdmin", isAdmin);
        result.put("deviceOwner", isOwner);
        // True protection: uninstall cannot be completed without first
        // removing management, which a device owner does not permit at all.
        result.put("uninstallBlocked", isAdmin || isOwner);

        // Surfaced so a revocation that happened while offline is still
        // reported on the next sync rather than being lost.
        long disabledAt = getContext()
                .getSharedPreferences("driver_admin", Context.MODE_PRIVATE)
                .getLong("adminDisabledAt", 0L);
        result.put("adminDisabledAt", disabledAt);

        call.resolve(result);
    }

    /**
     * Ask the driver to grant device admin rights.
     *
     * Android owns the confirmation screen, so this can only open it. The
     * explanation shown there is the only place to say why a delivery app is
     * asking for this, so it is written for the driver rather than for the
     * developer.
     */
    @PluginMethod
    public void requestAdmin(PluginCall call) {
        DevicePolicyManager dpm = dpm();
        if (dpm != null && dpm.isAdminActive(component())) {
            JSObject result = new JSObject();
            result.put("alreadyActive", true);
            call.resolve(result);
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity available");
            return;
        }

        Intent intent = new Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN);
        intent.putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, component());
        intent.putExtra(
                DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                "This phone belongs to Sterlin Glams. Enabling this stops the "
                        + "delivery app being removed by accident or without authorisation."
        );
        activity.startActivity(intent);

        JSObject result = new JSObject();
        result.put("alreadyActive", false);
        call.resolve(result);
    }

    /** Clear the locally recorded revocation once the office has been told. */
    @PluginMethod
    public void clearDisabledFlag(PluginCall call) {
        getContext().getSharedPreferences("driver_admin", Context.MODE_PRIVATE)
                .edit()
                .remove("adminDisabledAt")
                .apply();
        call.resolve();
    }

    /** Open the screen where device admin rights are managed. */
    @PluginMethod
    public void openSecuritySettings(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity available");
            return;
        }
        activity.startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS));
        call.resolve();
    }
}
