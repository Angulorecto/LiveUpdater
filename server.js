const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const { execSync, spawn } = require("child_process");
const { Rcon } = require("rcon-client");
const selfsigned = require("selfsigned");
const yargs = require('yargs');
const unzipper = require("unzipper");
const yaml = require("js-yaml");
const { createServer } = require('jsftpd');
const https = require("https");
const forge = require("node-forge");
const argv = require('yargs').argv;

const PLUGINS_DIR = path.resolve(process.cwd(), "..", "..", "..", "plugins");
console.log(PLUGINS_DIR);
const SERVER_PROPERTIES_PATH = path.resolve(process.cwd(), "..", "..", "..", "server.properties");
const CERT_DIR = path.resolve(process.cwd(), "certs");
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
  if (os.platform() !== "win32") return;

  const psScript = `
try {
    Write-Output "Adding RCON firewall rules..."
    New-NetFirewallRule -DisplayName 'Allow RCON Localhost ${port}' -Direction Inbound -Protocol TCP -LocalPort ${port} -RemoteAddress 127.0.0.1 -Action Allow -ErrorAction Stop
    New-NetFirewallRule -DisplayName 'Block RCON External ${port}' -Direction Inbound -Protocol TCP -LocalPort ${port} -RemoteAddress Any -Action Block -ErrorAction Stop
    Write-Output "✅ RCON firewall rules added."
} catch {
    Write-Output "❌ Error: $($_.Exception.Message)"
    exit 1
}
Pause
`;

  const tmpFile = path.join(os.tmpdir(), `firewall-${Date.now()}.ps1`);
  fs.writeFileSync(tmpFile, psScript);

  const args = [
    '-Command',
    `Start-Process powershell -ArgumentList '-ExecutionPolicy Bypass -File "${tmpFile}"' -Verb runAs`
  ];

  const child = spawn("powershell", args, { stdio: "inherit" });

  child.on("exit", (code) => {
    fs.unlinkSync(tmpFile); // Optional cleanup
    if (code === 0) {
      console.log("[SUCCESS] Firewall rules applied.");
    } else {
      console.warn("[FAILURE] Firewall rule script did not complete successfully.");
    }
  });
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

  const caCertPath = path.join(CERT_DIR, "ca.pem");
  const serverCertPath = path.join(CERT_DIR, "server.pem");
  const serverKeyPath = path.join(CERT_DIR, "server-key.pem");
  const clientCertPath = path.join(CERT_DIR, "client.pem");
  const clientKeyPath = path.join(CERT_DIR, "client-key.pem");

  const exists = await Promise.all([
    fs.exists(caCertPath),
    fs.exists(serverCertPath),
    fs.exists(serverKeyPath),
    fs.exists(clientCertPath),
    fs.exists(clientKeyPath),
  ]);

  if (exists.every(Boolean)) {
    console.log("[INFO] Existing CA/server/client certs found.");
    return;
  }

  function createKeyPair() {
    return forge.pki.rsa.generateKeyPair(2048);
  }

  function createCert(commonName, issuer, issuerKey, subjectKey, isCA = false) {
    const cert = forge.pki.createCertificate();
    cert.publicKey = subjectKey.publicKey;
    cert.serialNumber = (Math.floor(Math.random() * 1000000) + 1).toString();
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

    cert.setSubject([{ name: "commonName", value: commonName }]);
    cert.setIssuer([{ name: "commonName", value: issuer.commonName }]);

    cert.setExtensions([
      { name: "basicConstraints", cA: isCA },
      { name: "keyUsage", digitalSignature: true, keyCertSign: isCA, keyEncipherment: !isCA },
      { name: "extKeyUsage", serverAuth: !isCA, clientAuth: !isCA },
    ]);

    cert.sign(issuerKey.privateKey, forge.md.sha256.create());
    return cert;
  }

  const caKey = createKeyPair();
  const caCert = createCert("MyRootCA", { commonName: "MyRootCA" }, caKey, caKey, true);

  const serverKey = createKeyPair();
  const serverCert = createCert("localhost", { commonName: "MyRootCA" }, caKey, serverKey, false);

  const clientKey = createKeyPair();
  const clientCert = createCert("pluginuploader", { commonName: "MyRootCA" }, caKey, clientKey, false);

  await fs.writeFile(caCertPath, forge.pki.certificateToPem(caCert));
  await fs.writeFile(serverCertPath, forge.pki.certificateToPem(serverCert));
  await fs.writeFile(serverKeyPath, forge.pki.privateKeyToPem(serverKey.privateKey));
  await fs.writeFile(clientCertPath, forge.pki.certificateToPem(clientCert));
  await fs.writeFile(clientKeyPath, forge.pki.privateKeyToPem(clientKey.privateKey));

  // Convert client private key PEM to DER
  const clientKeyDer = forge.asn1.toDer(forge.pki.privateKeyToAsn1(clientKey.privateKey)).getBytes();
  const clientKeyDerBuffer = Buffer.from(clientKeyDer, 'binary');
  const clientDerPath = path.join(CERT_DIR, "client.der");
  await fs.writeFile(clientDerPath, clientKeyDerBuffer);

  console.log("[INFO] CA, server, and client certs generated.");
}

async function startFtpServer() {
  await ensureCerts();
  await fs.ensureDir(PLUGINS_DIR);

  const server = new ftpd({
    debug: true,
    cnf: {
      port: FTP_PORT,
      username: FTP_USER,
      password: FTP_PASS,
      basefolder: PLUGINS_DIR,
      minDataPort: 60000,
    },
    tls: {
      key: fs.readFileSync(path.join(CERT_DIR, 'server-key.pem')),
      cert: fs.readFileSync(path.join(CERT_DIR, 'server.pem')),
      ca: fs.readFileSync(path.join(CERT_DIR, 'ca.pem')),
      requestCert: true,
      rejectUnauthorized: true
    },
    hdl: {
      // Upload handler
      upload: async (username, filepath, filename, dataBuffer, offset) => {
        console.log('[INFO] Uploaded:', filename);
        const fullPath = path.join(PLUGINS_DIR, filepath, filename);
        await fs.ensureDir(path.dirname(fullPath));
        await fs.writeFile(fullPath, dataBuffer);

        if (filename.endsWith('.jar')) {
          const plugin = await getPluginNameFromJar(fullPath);
          if (plugin) {
            console.log('[INFO] Detected plugin:', plugin);
            await sendRconCommand(`plugman reload ${plugin}`);
          }
        }

        return true;
      }
    }
  });

  server.start();
  console.log(`✅ jsftpd server listening on port ${FTP_PORT} (TLS)`);
}

// === Entry Point ===
updateRconSettings(SERVER_PROPERTIES_PATH, RCON_PASSWORD, RCON_PORT, "127.0.0.1");
secureRconPort(RCON_PORT);
startFtpServer();