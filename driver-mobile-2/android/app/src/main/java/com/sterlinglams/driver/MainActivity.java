package com.sterlinglams.driver;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

	/**
	 * Register the device-admin bridge before the WebView loads, so the app
	 * can report its own protection state on first render rather than after
	 * a round trip.
	 */
	@Override
	public void onCreate(Bundle savedInstanceState) {
		registerPlugin(DeviceAdminPlugin.class);
		registerPlugin(NativeTrackerPlugin.class);
		super.onCreate(savedInstanceState);
	}

	@Override
	public void onBackPressed() {
		if (getBridge() != null && getBridge().getWebView() != null && getBridge().getWebView().canGoBack()) {
			getBridge().getWebView().goBack();
			return;
		}
		super.onBackPressed();
	}

	/**
	 * Keep the WebView's JavaScript timers running while the app is
	 * backgrounded.
	 *
	 * The background-geolocation plugin runs a native foreground service, so
	 * GPS fixes keep arriving when the driver locks their phone — but it hands
	 * each fix to JavaScript, and the code that POSTs it to /api/driver/location
	 * lives there. Android pauses a backgrounded WebView's timers, so those
	 * fixes simply queued and were only sent once the driver reopened the app.
	 * From dispatch's side the marker sat still and then jumped, which looked
	 * like background tracking wasn't working at all when the service was in
	 * fact running the whole time.
	 *
	 * resumeTimers() undoes the pause that super.onPause() applies. It is
	 * process-wide rather than per-WebView, which is safe here: this activity
	 * owns the only WebView in the process.
	 *
	 * This is only legitimate because a location foreground service is running
	 * and showing its mandatory notification — the app is not quietly staying
	 * awake behind the driver's back.
	 */
	@Override
	public void onPause() {
		super.onPause();
		if (getBridge() != null && getBridge().getWebView() != null) {
			getBridge().getWebView().resumeTimers();
		}
	}
}
