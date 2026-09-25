package com.sterlinglams.driver;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Location reporting that does not depend on the WebView.
 *
 * Position used to be uploaded from JavaScript: the native watcher handed
 * fixes to the WebView and JS posted them. That works only while Android keeps
 * the WebView running, which it does not guarantee — leaving the app was
 * enough to stop reporting on the test handset, and Samsung is among the more
 * aggressive at sleeping backgrounded apps. No amount of JS-side work fixes
 * that, because the code doing the work is what gets suspended.
 *
 * So this service acquires locations and posts them itself, in Java. Whether
 * the WebView is alive is now irrelevant to whether dispatch can see a rider.
 */
public class TrackingService extends Service implements LocationListener {

    private static final String TAG = "TrackingService";

    public static final String EXTRA_API_BASE = "apiBase";
    public static final String EXTRA_TOKEN = "token";
    public static final String EXTRA_DRIVER_ID = "driverId";

    private static final String CHANNEL_ID = "sterlinglams_tracking";
    private static final int NOTIFICATION_ID = 4711;

    /**
     * Movement thresholds for a new fix.
     *
     * 10 m keeps corners and turns in the trail — the precision dispatch asked
     * for — without reporting sensor jitter from a parked vehicle.
     */
    private static final long MIN_TIME_MS = 5_000L;
    private static final float MIN_DISTANCE_M = 10f;

    /**
     * The network provider is registered as a fallback, not as a peer.
     *
     * It derives position from cell towers and wifi, which can be hundreds of
     * metres out. Posting those alongside GPS dragged the trail off the road
     * and round corners that were never taken. A network fix is used only when
     * GPS has gone quiet for longer than this — indoors, or with no sky view.
     */
    private static final long GPS_PREFERENCE_MS = 45_000L;

    /**
     * Fixes coarser than this never enter location history.
     *
     * They can still serve as a heartbeat, because "roughly here and
     * reachable" is worth reporting. They are not worth drawing a route from.
     */
    private static final float MAX_TRAIL_ACCURACY_M = 50f;

    /**
     * Re-send the last known position when nothing else has gone out.
     *
     * Location providers report on movement, so a stationary phone produces no
     * fixes at all. Without this a parked rider ages out of the dispatch map
     * exactly as before — "not moving" must not look like "not reachable".
     * Half the admin map's two-minute stale window, so one missed beat is not
     * enough to grey a rider out.
     */
    private static final long HEARTBEAT_MS = 60_000L;

    /** Buffered points survive no-signal; the oldest are dropped under pressure. */
    private static final String PREFS = "nativeTracker";
    private static final String KEY_QUEUE = "queue";
    private static final int MAX_QUEUED = 2000;

    private String apiBase;
    private String token;
    private String driverId;

    private LocationManager locationManager;
    private Handler handler;
    private Location lastLocation;
    private long lastPostAt = 0L;
    private long lastGpsAt = 0L;

    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private final Runnable heartbeat = new Runnable() {
        @Override
        public void run() {
            if (System.currentTimeMillis() - lastPostAt >= HEARTBEAT_MS) {
                Location known = lastLocation != null ? lastLocation : lastKnown();
                if (known != null) post(known, false);
            }
            handler.postDelayed(this, HEARTBEAT_MS / 2);
        }
    };

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            if (intent.getStringExtra(EXTRA_API_BASE) != null) apiBase = intent.getStringExtra(EXTRA_API_BASE);
            if (intent.getStringExtra(EXTRA_TOKEN) != null) token = intent.getStringExtra(EXTRA_TOKEN);
            if (intent.getStringExtra(EXTRA_DRIVER_ID) != null) driverId = intent.getStringExtra(EXTRA_DRIVER_ID);
        }

        startForeground(NOTIFICATION_ID, buildNotification());
        startUpdates();

        if (handler == null) {
            handler = new Handler(Looper.getMainLooper());
            handler.postDelayed(heartbeat, HEARTBEAT_MS / 2);
        }

        // Restarted by Android with the last Intent if the process is killed,
        // so a rider does not silently stop reporting after a low-memory kill.
        return START_REDELIVER_INTENT;
    }

    private void startUpdates() {
        if (locationManager != null) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "Location permission not granted; service idle");
            return;
        }
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) return;

        try {
            // Both providers on purpose: GPS is precise but unavailable
            // indoors, network is coarse but keeps a parked rider visible.
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER, MIN_TIME_MS, MIN_DISTANCE_M, this);
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                // Slower than GPS: this is the fallback, and every fix it
                // produces is a candidate for polluting the trail.
                locationManager.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER, GPS_PREFERENCE_MS, MIN_DISTANCE_M, this);
            }
        } catch (SecurityException e) {
            Log.w(TAG, "Location updates refused", e);
        }
    }

    private Location lastKnown() {
        if (locationManager == null) return null;
        try {
            Location gps = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if (gps != null) return gps;
            return locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
        } catch (SecurityException e) {
            return null;
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        long now = System.currentTimeMillis();
        boolean isGps = LocationManager.GPS_PROVIDER.equals(location.getProvider());

        if (isGps) {
            lastGpsAt = now;
        } else if (now - lastGpsAt < GPS_PREFERENCE_MS) {
            // GPS is reporting; a coarse fix now would only add noise.
            return;
        }

        lastLocation = location;

        // Too coarse to draw a route from, but still proof the rider is
        // reachable — kept for the heartbeat, kept out of history.
        if (location.hasAccuracy() && location.getAccuracy() > MAX_TRAIL_ACCURACY_M) return;

        post(location, true);
    }

    // Required by LocationListener on older API levels.
    @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
    @Override public void onProviderEnabled(String provider) { }
    @Override public void onProviderDisabled(String provider) { }

    /**
     * Queue a point and try to send everything pending.
     *
     * @param trail whether this point belongs in location history. Heartbeats
     *              from a stationary phone are excluded so a vehicle parked
     *              overnight does not fill the day's trail with one identical
     *              point per minute.
     */
    private void post(Location location, boolean trail) {
        if (apiBase == null || driverId == null) return;
        lastPostAt = System.currentTimeMillis();

        try {
            JSONObject point = new JSONObject();
            point.put("driverId", driverId);
            point.put("lat", location.getLatitude());
            point.put("lng", location.getLongitude());
            point.put("trail", trail);
            // The device's own fix time, not the server's clock. A batch that
            // sat in the queue through a dead zone would otherwise all be
            // stamped at upload time, collapsing an hour of driving into one
            // instant — the drive home is exactly what this has to get right.
            point.put("t", location.getTime());
            if (location.hasSpeed() && location.getSpeed() >= 0) point.put("speed", location.getSpeed());
            enqueue(point);
        } catch (Exception e) {
            Log.w(TAG, "Could not queue point", e);
            return;
        }

        io.execute(new Runnable() {
            @Override
            public void run() {
                flush();
            }
        });
    }

    private synchronized void enqueue(JSONObject point) {
        SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray queue = new JSONArray(prefs.getString(KEY_QUEUE, "[]"));
            JSONArray next = new JSONArray();
            // Drop from the front so the most recent movement always survives.
            int start = Math.max(0, queue.length() + 1 - MAX_QUEUED);
            for (int i = start; i < queue.length(); i++) next.put(queue.get(i));
            next.put(point);
            prefs.edit().putString(KEY_QUEUE, next.toString()).apply();
        } catch (Exception e) {
            Log.w(TAG, "Queue write failed", e);
        }
    }

    /** Send queued points oldest first, keeping whatever does not get through. */
    private synchronized void flush() {
        SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray queue;
        try {
            queue = new JSONArray(prefs.getString(KEY_QUEUE, "[]"));
        } catch (Exception e) {
            return;
        }

        int sent = 0;
        for (int i = 0; i < queue.length(); i++) {
            try {
                if (!send(queue.getJSONObject(i))) break;
                sent++;
            } catch (Exception e) {
                // Malformed entry: count it as handled rather than blocking
                // every later point behind it forever.
                sent++;
            }
        }
        if (sent == 0) return;

        try {
            JSONArray remaining = new JSONArray();
            for (int i = sent; i < queue.length(); i++) remaining.put(queue.get(i));
            prefs.edit().putString(KEY_QUEUE, remaining.toString()).apply();
        } catch (Exception e) {
            Log.w(TAG, "Queue trim failed", e);
        }
    }

    /** One POST. Returns false only for failures worth retrying later. */
    private boolean send(JSONObject body) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(apiBase + "/api/driver/location").openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            if (token != null) conn.setRequestProperty("X-Driver-Token", token);
            conn.setConnectTimeout(15_000);
            conn.setReadTimeout(15_000);
            conn.setDoOutput(true);

            OutputStream out = conn.getOutputStream();
            try {
                out.write(body.toString().getBytes("UTF-8"));
            } finally {
                out.close();
            }

            int code = conn.getResponseCode();
            // An expired token will never accept this point, so discard it
            // rather than blocking every later point behind it forever.
            if (code == 401 || code == 403) return true;
            // Rate limited or a server fault: the point is fine, the moment
            // is not. Keep it and try again on the next beat.
            if (code == 429) return false;
            return code < 500;
        } catch (Exception e) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private Notification buildNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Vehicle location", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shown whenever vehicle location is being recorded.");
            nm.createNotificationChannel(channel);
        }

        Intent open = new Intent(this, MainActivity.class);
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent pending = PendingIntent.getActivity(this, 0, open, flags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Vehicle location is being recorded")
                // Same wording as the rest of the app: tracking follows being
                // signed in, not being on shift, and saying so is the point.
                .setContentText("Recorded while you are signed in. Sign out to stop.")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .setContentIntent(pending)
                .build();
    }

    @Override
    public void onDestroy() {
        if (handler != null) handler.removeCallbacks(heartbeat);
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(this);
            } catch (SecurityException ignored) {
            }
        }
        super.onDestroy();
    }
}
