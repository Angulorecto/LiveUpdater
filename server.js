// main.js
const fs = require("fs");
const os = require("os");
const https = require("https");
const path = require("path");
const { spawn } = require("child_process");
const FtpSrv = require("ftp-srv"); // npm install ftp-srv
const Rcon = require("rcon");      // npm install rcon

// --- CONFIG ---
const FTP_PORT = 2121;
const FTP_USER = "user";
const FTP_PASS = "password";
const CERT_PATH = "cert.pem";
const KEY_PATH = "key.pem";
const SERVER_PROPERTIES_PATH = "server.properties";

// RCON config
const RCON_PORT = 25575;
const RCON_PASSWORD = "changeme";

// --- Update server.properties ---
function updateServerProperties(filepath, updates) {
    let content = "";
    try {
        content = fs.readFileSync(filepath, "utf-8");
    } catch {
        console.warn(`Warning: ${filepath} not found. Creating new one.`);
    }

    for (const [key, value] of Object.entries(updates)) {
        const regex = new RegExp(`^${key}=.*`, "m");
        if (regex.test(content)) {
            content = content.replace(regex, `${key}=${value}`);
        } else {
            content += `\n${key}=${value}`;
        }
    }

    fs.writeFileSync(filepath, content.trim() + "\n");
    console.log(`Updated ${filepath}`);
}

// --- Open Windows Firewall Port ---
function openFirewallPort(port) {
    const cmd = `New-NetFirewallRule -DisplayName "Allow Port ${port}" -Direction Inbound -LocalPort ${port} -Protocol TCP -Action Allow`;
    spawn("powershell.exe", ["-Command", cmd], { stdio: "inherit" });
}

// --- Get Public IP ---
function getPublicIP() {
    return new Promise((resolve, reject) => {
        https.get("https://api.ipify.org", (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => resolve(data.trim()));
        }).on("error", reject);
    });
}

// --- Get Local IP ---
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces)) {
        for (const net of iface) {
            if (net.family === "IPv4" && !net.internal) {
                return net.address;
            }
        }
    }
    return "127.0.0.1";
}

// --- Start FTPS Server ---
async function startFTPS(publicIP) {
    const ftpServer = new FtpSrv({
        url: `ftp://0.0.0.0:${FTP_PORT}`,
        anonymous: false,
        pasv_url: publicIP,
        tls: {
            cert: fs.readFileSync(CERT_PATH),
            key: fs.readFileSync(KEY_PATH)
        }
    });

    ftpServer.on("login", ({ username, password }, resolve, reject) => {
        if (username === FTP_USER && password === FTP_PASS) {
            resolve({ root: __dirname });
        } else {
            reject(new Error("Invalid credentials"));
        }
    });

    ftpServer.listen().then(() => {
        console.log(`✅ FTPS server running on port ${FTP_PORT}`);
    });
}

// --- RCON Logic ---
async function connectRcon(ip) {
    return new Promise((resolve, reject) => {
        const rcon = new Rcon(ip, RCON_PORT, RCON_PASSWORD);
        rcon.on("auth", () => {
            console.log("✅ RCON connected!");
            rcon.send('say FTPS + RCON are both ready!');
            resolve(rcon);
        });

        rcon.on("error", (err) => {
            console.error("❌ RCON error:", err.message);
            reject(err);
        });

        rcon.on("end", () => {
            console.log("🔌 RCON disconnected.");
        });

        rcon.connect();
    });
}

// --- Main Logic ---
(async () => {
    const publicIP = await getPublicIP();
    const localIP = getLocalIP();

    console.log(`🌐 Public IP: ${publicIP}`);
    console.log(`💻 Local IP:  ${localIP}`);

    updateServerProperties(SERVER_PROPERTIES_PATH, {
        "server-ip": localIP,
        "server-port": "25565",
        "enable-rcon": "true",
        "rcon.password": RCON_PASSWORD,
        "rcon.port": RCON_PORT
    });

    openFirewallPort(FTP_PORT);
    openFirewallPort(RCON_PORT);

    await startFTPS(publicIP);

    try {
        await connectRcon(localIP);
    } catch (err) {
        console.error("⚠️ Failed to connect to RCON. Is the server running?");
    }
})();