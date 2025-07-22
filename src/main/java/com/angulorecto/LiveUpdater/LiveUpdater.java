package com.angulorecto.LiveUpdater;

import org.bukkit.plugin.java.JavaPlugin;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.*;
import java.util.Locale;

public final class LiveUpdater extends JavaPlugin {

    private final String repo = "Angulorecto/LiveUpdater";
    private final String apiUrl = "https://api.github.com/repos/" + repo + "/releases/latest";

    @Override
    public void onEnable() {
        saveDefaultConfig();

        getLogger().info("LiveUpdater plugin enabled.");

        try {
            String os = detectOS();
            String filename = getBinaryName(os);
            File binDir = new File(getDataFolder(), "bin");
            File binaryFile = new File(binDir, filename);

            if (!binDir.exists()) binDir.mkdirs();

            if (!binaryFile.exists()) {
                getLogger().info("Downloading latest binary for " + os + "...");
                downloadBinary(os, binaryFile);
            }

            runBinary(binaryFile);

        } catch (Exception e) {
            getLogger().severe("Failed to initialize LiveUpdater: " + e.getMessage());
            e.printStackTrace();
        }
    }

    private String detectOS() {
        String os = System.getProperty("os.name").toLowerCase(Locale.ROOT);
        if (os.contains("win")) return "windows";
        if (os.contains("mac")) return "macos";
        return "linux-ubuntu"; // Match your GitHub asset naming
    }

    private String getBinaryName(String os) {
        if (os.equals("windows")) return "server-windows.exe";
        if (os.equals("macos")) return "server-macos";
        return "server-linux-ubuntu";
    }

    private void downloadBinary(String os, File outputFile) throws IOException {
        String assetName = getBinaryName(os);

        HttpURLConnection connection = (HttpURLConnection) new URL(apiUrl).openConnection();
        connection.setRequestProperty("Accept", "application/vnd.github.v3+json");

        if (connection.getResponseCode() != 200) {
            throw new IOException("GitHub API returned code " + connection.getResponseCode());
        }

        String json = new BufferedReader(new InputStreamReader(connection.getInputStream()))
                .lines()
                .reduce("", (a, b) -> a + b);

        String assetUrl = extractDownloadUrl(json, assetName);
        if (assetUrl == null) throw new IOException("Could not find asset URL for: " + assetName);

        getLogger().info("Downloading binary from: " + assetUrl);

        HttpURLConnection fileConn = (HttpURLConnection) new URL(assetUrl).openConnection();
        fileConn.setRequestProperty("Accept", "application/octet-stream");

        try (InputStream in = fileConn.getInputStream()) {
            Files.copy(in, outputFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }

        if (!System.getProperty("os.name").toLowerCase().contains("win")) {
            if (!outputFile.setExecutable(true)) {
                getLogger().warning("Could not make binary executable: " + outputFile.getName());
            }
        }
    }

    private String extractDownloadUrl(String json, String assetName) {
        String marker = "\"name\":\"" + assetName + "\"";
        int index = json.indexOf(marker);
        if (index == -1) return null;

        int urlStart = json.lastIndexOf("\"browser_download_url\":\"", index);
        if (urlStart == -1) return null;

        urlStart += "\"browser_download_url\":\"".length();
        int urlEnd = json.indexOf("\"", urlStart);

        return json.substring(urlStart, urlEnd).replace("\\u0026", "&");
    }

    private void runBinary(File binary) throws IOException {
        ProcessBuilder pb;

        if (binary.getName().endsWith(".exe")) {
            pb = new ProcessBuilder(binary.getAbsolutePath());
        } else {
            pb = new ProcessBuilder(binary.getAbsolutePath());
        }

        pb.directory(binary.getParentFile());
        pb.redirectErrorStream(true);

        Process process = pb.start();

        new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    getLogger().info("[BINARY] " + line);
                }
            } catch (IOException e) {
                getLogger().warning("Error reading binary output: " + e.getMessage());
            }
        }).start();
    }

    @Override
    public void onDisable() {
        getLogger().info("Bye!");
    }
}