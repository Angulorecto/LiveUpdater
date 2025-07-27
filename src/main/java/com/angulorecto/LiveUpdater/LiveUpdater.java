package com.angulorecto.LiveUpdater;

import org.bukkit.plugin.java.JavaPlugin;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.List;

public final class LiveUpdater extends JavaPlugin {

    private final File pluginFolder = getDataFolder();
    private final File minicondaDir = new File(pluginFolder, "miniconda3");
    private final String minicondaUrl = "https://repo.anaconda.com/miniconda/Miniconda3-latest-Windows-x86_64.exe";
    private final File installerFile = new File(pluginFolder, "miniconda_installer.exe");
    private final File pythonScript = new File(pluginFolder, "live_updater.py");

    @Override
    public void onEnable() {
        getLogger().info("LiveUpdater plugin enabled.");

        getServer().getScheduler().runTaskAsynchronously(this, () -> {
            try {
                if (!isPythonAvailable()) {
                    getLogger().warning("Python not found. Installing Miniconda...");
                    installMiniconda();
                }

                getLogger().info("Installing dependencies...");
                installDependencies();

                getLogger().info("Running Python script...");
                runPythonScript();

            } catch (Exception e) {
                getLogger().severe("LiveUpdater failed: " + e.getMessage());
                e.printStackTrace();
            }
        });
    }

    private boolean isPythonAvailable() {
        try {
            Process process = new ProcessBuilder(minicondaDir + "\\Scripts\\python.exe", "--version")
                    .redirectErrorStream(true).start();
            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
            String line = reader.readLine();
            process.waitFor();
            return line != null && line.toLowerCase().contains("python");
        } catch (Exception e) {
            return false;
        }
    }

    private void installMiniconda() throws Exception {
        if (!pluginFolder.exists()) pluginFolder.mkdirs();

        if (!installerFile.exists()) {
            getLogger().info("Downloading Miniconda...");
            downloadFile(minicondaUrl, installerFile);
        }

        getLogger().info("Running Miniconda installer...");
        Process process = new ProcessBuilder(
                installerFile.getAbsolutePath(),
                "/InstallationType=JustMe",
                "/RegisterPython=0",
                "/S",
                "/D=" + minicondaDir.getAbsolutePath()
        ).start();

        int code = process.waitFor();
        if (code != 0) throw new RuntimeException("Miniconda install failed with code: " + code);
    }

    private void installDependencies() throws Exception {
        String pip = minicondaDir + "\\Scripts\\pip.exe";
        List<String> command = Arrays.asList(pip, "install", "requests"); // Add more packages here
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.inheritIO();
        Process process = pb.start();
        int result = process.waitFor();
        if (result != 0) throw new RuntimeException("Failed to install Python dependencies.");
    }

    private void runPythonScript() throws Exception {
        if (!pythonScript.exists())
            throw new FileNotFoundException("Missing Python script: live_updater.py");

        ProcessBuilder pb = new ProcessBuilder(
                minicondaDir + "\\Scripts\\python.exe",
                pythonScript.getAbsolutePath()
        );
        pb.directory(pluginFolder);
        pb.redirectErrorStream(true);

        Process process = pb.start();

        new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    getLogger().info("[Python] " + line);
                }
            } catch (IOException e) {
                getLogger().warning("Error reading Python output: " + e.getMessage());
            }
        }).start();

        int code = process.waitFor();
        if (code != 0) {
            throw new RuntimeException("Python script exited with code " + code);
        }
    }

    private void downloadFile(String urlStr, File dest) throws IOException {
        HttpURLConnection http = (HttpURLConnection) new URL(urlStr).openConnection();
        http.setRequestProperty("User-Agent", "Mozilla/5.0");

        try (InputStream in = http.getInputStream(); FileOutputStream out = new FileOutputStream(dest)) {
            byte[] buffer = new byte[8192];
            int len;
            while ((len = in.read(buffer)) != -1) out.write(buffer, 0, len);
        }
    }

    @Override
    public void onDisable() {
        getLogger().info("LiveUpdater plugin disabled.");
    }
}