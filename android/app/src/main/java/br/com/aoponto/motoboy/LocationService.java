package br.com.aoponto.motoboy;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class LocationService extends Service implements LocationListener {
    private static final String CHANNEL_ID = "aoponto_gps_channel";
    private static final int NOTIFICATION_ID = 2001;
    private LocationManager locationManager;
    private static String motoboyId = "60"; // ID padrão do Lucas

    public static void setMotoboyId(String id) {
        if (id != null && !id.trim().isEmpty()) {
            motoboyId = id.trim();
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        criarNotificationChannel();
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Ao Ponto Entregador")
                .setContentText("Rastreamento GPS em tempo real ativo")
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();

        startForeground(NOTIFICATION_ID, notification);
        iniciarGpsNativo();
    }

    private void criarNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Rastreamento de Entregas Ao Ponto",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Serviço contínuo de localização em segundo plano");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void iniciarGpsNativo() {
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locationManager != null) {
            try {
                if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                    locationManager.requestLocationUpdates(
                            LocationManager.GPS_PROVIDER,
                            4000, // intervalo de 4 segundos
                            2.0f, // mínimo de 2 metros
                            this
                    );
                }
                if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                    locationManager.requestLocationUpdates(
                            LocationManager.NETWORK_PROVIDER,
                            6000,
                            5.0f,
                            this
                    );
                }
            } catch (SecurityException e) {
                Log.e("AoPontoGPS", "Permissão negada para GPS nativo: " + e.getMessage());
            }
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        if (location == null) return;
        final double lat = location.getLatitude();
        final double lng = location.getLongitude();
        final float spd = location.hasSpeed() ? location.getSpeed() * 3.6f : 0f;
        final float acc = location.hasAccuracy() ? location.getAccuracy() : 20f;

        // Disparar envio em thread de background
        new Thread(() -> enviarPosicaoAoServidor(lat, lng, spd, acc)).start();
    }

    private void enviarPosicaoAoServidor(double lat, double lng, float spd, float acc) {
        try {
            URL url = new URL("https://sist-homolog.vercel.app/api/motoboy/posicao");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; utf-8");
            conn.setRequestProperty("Accept", "application/json");
            conn.setDoOutput(true);
            conn.setConnectTimeout(4000);
            conn.setReadTimeout(4000);

            String jsonInputString = String.format(
                    "{\"motoboy_id\":%s,\"latitude\":%f,\"longitude\":%f,\"speed\":%d,\"accuracy\":%d}",
                    motoboyId != null ? motoboyId : "60",
                    lat, lng, Math.round(spd), Math.round(acc)
            ).replace(',', '.');

            try (OutputStream os = conn.getOutputStream()) {
                byte[] input = jsonInputString.getBytes(StandardCharsets.UTF_8);
                os.write(input, 0, input.length);
            }

            int responseCode = conn.getResponseCode();
            Log.d("AoPontoGPS", "GPS background transmitido com sucesso: HTTP " + responseCode);
            conn.disconnect();
        } catch (Exception e) {
            Log.w("AoPontoGPS", "Falha de rede ao transmitir GPS: " + e.getMessage());
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.hasExtra("motoboy_id")) {
            setMotoboyId(intent.getStringExtra("motoboy_id"));
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (locationManager != null) {
            locationManager.removeUpdates(this);
        }
    }

    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
    @Override public void onProviderEnabled(String provider) {}
    @Override public void onProviderDisabled(String provider) {}
}
