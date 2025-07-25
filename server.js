const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const { execSync, spawn } = require("child_process");
const { Rcon } = require("rcon-client");
const selfsigned = require("selfsigned");
const yargs = require('yargs');
const unzipper = require("unzipper");
const yaml = require("js-yaml");
const ftpd = require("ftpd");
const https = require("https");

const argv = require('yargs').argv;

const PLUGINS_DIR = path.resolve(__dirname, "..", "..", "plugins");
const SERVER_PROPERTIES_PATH = path.resolve(__dirname, "..", "..", "server.properties");
const CERT_DIR = path.resolve(__dirname, "certs");
const CERT_PATH = path.join(CERT_DIR, "cert.pem");
const KEY_PATH = path.join(CERT_DIR, "key.pem");

const RCON_PASSWORD = "AG0dAwfulAndL0ngP4sswordThat#N0OneCanGuessAnd0nlyIC4n#Us3";
const RCON_PORT = 25575;
const FTP_PORT = 2121;
const FTP_USER = "pluginuploader";
const FTP_PASS = RCON_PASSWORD;

// === Helpers ===
function readServerProperties(filePath) {
  const props = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split("\n")) {
    if (line.trim() && !line.startsWith("#") && line.includes("=")) {
      const [k, v] = line.split("=");
      props[k.trim()] = v.trim();
    }
  }
  return props;
}

function writeServerProperties(props, filePath) {
  const lines = Object.entries(props).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function updateRconSettings(path, password, port = 25575, host = "127.0.0.1") {
  const props = readServerProperties(path);
  props["enable-rcon"] = "true";
  props["rcon.port"] = String(port);
  props["rcon.password"] = password;
  props["rcon.address"] = host;
  writeServerProperties(props, path);
  console.log("[INFO] RCON settings updated.");
}

function getPublicIP() {
  return new Promise((resolve) => {
    https.get("https://api.ipify.org", (res) => {
      let ip = "";
      res.on("data", chunk => ip += chunk);
      res.on("end", () => resolve(ip.trim()));
    }).on("error", () => resolve("127.0.0.1"));
  });
}

function secureRconPort(port = 25575) {
  if (os.platform() === "win32") {
    const allowRule = `New-NetFirewallRule -DisplayName "Allow RCON Localhost ${port}" -Direction Inbound -Protocol TCP -LocalPort ${port} -RemoteAddress 127.0.0.1 -Action Allow`;
    const blockRule = `New-NetFirewallRule -DisplayName "Block RCON External ${port}" -Direction Inbound -Protocol TCP -LocalPort ${port} -RemoteAddress Any -Action Block`;
    try {
      execSync(`powershell -Command "${allowRule}"`);
      execSync(`powershell -Command "${blockRule}"`);
      console.log("[INFO] RCON firewall rules set.");
    } catch (e) {
      console.warn("[WARN] Firewall rules may already exist or failed to add.");
    }
  }
}

async function sendRconCommand(command) {
  try {
    const rcon = await Rcon.connect({
      host: "127.0.0.1",
      port: RCON_PORT,
      password: RCON_PASSWORD
    });
    const res = await rcon.send(command);
    await rcon.end();
    console.log(`[INFO] RCON response: ${res}`);
    return res;
  } catch (err) {
    console.error("[ERROR] RCON command failed:", err.message);
  }
}

async function getPluginNameFromJar(filePath) {
  try {
    const directory = await unzipper.Open.file(filePath);
    const pluginYml = directory.files.find(f => f.path === "plugin.yml");
    if (pluginYml) {
      const content = await pluginYml.buffer();
      const data = yaml.load(content.toString());
      return data.name;
    }
  } catch (e) {
    console.error("[ERROR] Failed to extract plugin.yml:", e);
  }
  return null;
}

async function ensureCerts() {
  await fs.ensureDir(CERT_DIR);
  if (!(await fs.exists(CERT_PATH)) || !(await fs.exists(KEY_PATH))) {
    const pems = selfsigned.generate([{ name: "commonName", value: "localhost" }], { days: 365 });
    await fs.writeFile(CERT_PATH, pems.cert);
    await fs.writeFile(KEY_PATH, pems.private);
    console.log("[INFO] Generated self-signed TLS certs.");
  }
}

async function startFtpServer() {
  await ensureCerts();
  await fs.ensureDir(PLUGINS_DIR);

  const address = argv.exposed ? await getPublicIP() : "127.0.0.1";

  const server = new ftpd.FtpServer("0.0.0.0", {
    getInitialCwd: () => "/",
    getRoot: () => PLUGINS_DIR,
    tlsOptions: {
      cert: fs.readFileSync(CERT_PATH),
      key: fs.readFileSync(KEY_PATH),
      requestCert: false,
      rejectUnauthorized: false
    },
    useWriteFile: false,
    useReadFile: false,
    allowUnauthorizedTls: true,
    passive: {
      portRangeStart: 60000,
      portRangeEnd: 60100,
      externalAddress: address
    }
  });

  server.on("client:connected", conn => {
    let username = null;
    conn.on("command:user", (user, success, failure) => {
      if (user === FTP_USER) {
        username = user;
        success();
      } else failure();
    });
    conn.on("command:pass", (pass, success, failure) => {
      if (username === FTP_USER && pass === FTP_PASS) {
        success(username);
      } else failure();
    });
    conn.on("file:stor", (req, res) => {
      const filename = path.basename(req.filePath);
      const fullPath = path.join(PLUGINS_DIR, filename);
      req.pipe(fs.createWriteStream(fullPath));
      req.on("end", async () => {
        console.log("[INFO] Uploaded:", filename);
        if (filename.endsWith(".jar")) {
          const plugin = await getPluginNameFromJar(fullPath);
          if (plugin) {
            console.log("[INFO] Detected plugin:", plugin);
            await sendRconCommand(`plugman reload ${plugin}`);
          }
        }
      });
    });
  });

  server.listen(FTP_PORT);
  console.log(`✅ TLS FTP Server running on port ${FTP_PORT} (${argv.exposed ? "external" : "local"})`);
}

// === Entry Point ===
updateRconSettings(SERVER_PROPERTIES_PATH, RCON_PASSWORD, RCON_PORT, "127.0.0.1");
secureRconPort(RCON_PORT);
startFtpServer();