package com.sterlinglams.driver;

import com.getcapacitor.BridgeActivity;
import android.webkit.WebView;

public class MainActivity extends BridgeActivity {
	@Override
	public void onBackPressed() {
		if (getBridge() != null && getBridge().getWebView() != null && getBridge().getWebView().canGoBack()) {
			getBridge().getWebView().goBack();
			return;
		}
		super.onBackPressed();
	}

	/**
	 * Override onPause to prevent Capacitor from pausing WebView JavaScript
	 * timers when the driver minimises the app. Without this, watchPosition
	 * callbacks and fetch() calls stop firing the moment the app leaves the
	 * foreground, causing the driver dot to freeze on the routes page.
	 *
	 * super.onPause() → BridgeActivity.onPause() → bridge.onPause()
	 *   → webView.pauseTimers() + webView.onPause()   ← this is what we undo
	 *
	 * The background-geolocation foreground service keeps the process alive;
	 * we just need JS to keep running so the location callbacks reach the API.
	 */
	@Override
	public void onPause() {
		super.onPause();
		WebView wv = (getBridge() != null) ? getBridge().getWebView() : null;
		if (wv != null) {
			wv.resumeTimers();
			wv.onResume();
		}
	}
}
