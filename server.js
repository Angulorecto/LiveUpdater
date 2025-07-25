const ftpd = require("ftpd");
const fs = require("fs-extra");
const path = require("path");
const selfsigned = require("selfsigned");
const { Rcon } = require("rcon-client");

// === CONFIG ===
const FTP_PORT = 2121;
const FTP_USER = "admin";
const FTP_PASS = "password";
const FTP_ROOT = path.join(__dirname, "ftp-root");
const CERT_PATH = path.join(__dirname, "cert.pem");
const KEY_PATH = path.join(__dirname, "key.pem");

const RCON_OPTIONS = {
  host: "127.0.0.1",
  port: 25575,
  password: "yourRconPassword"
};

// === TLS Certificate Generation ===
async function ensureCerts() {
  if (!(await fs.pathExists(CERT_PATH)) || !(await fs.pathExists(KEY_PATH))) {
    const pems = selfsigned.generate([{ name: "commonName", value: "localhost" }], { days: 365 });
    await fs.writeFile(CERT_PATH, pems.cert);
    await fs.writeFile(KEY_PATH, pems.private);
    console.log("Generated self-signed cert");
  }
}

// === RCON Call on Upload ===
async function notifyRcon(filename) {
  try {
    const rcon = await Rcon.connect(RCON_OPTIONS);
    await rcon.send(`say New file uploaded: ${filename}`);
    await rcon.end();
    console.log("RCON command sent.");
  } catch (err) {
    console.error("RCON failed:", err);
  }
}

// === Main FTP Server ===
async function startFtp() {
  await ensureCerts();
  await fs.ensureDir(FTP_ROOT);

  const server = new ftpd.FtpServer("0.0.0.0", {
    getInitialCwd: () => "/",
    getRoot: () => FTP_ROOT,
    tlsOptions: {
      key: fs.readFileSync(KEY_PATH),
      cert: fs.readFileSync(CERT_PATH),
    },
    useWriteFile: false,
    useReadFile: false,
    allowUnauthorizedTls: true,
  });

  server.on("error", (err) => console.error("FTP Server error:", err));

  server.on("client:connected", (conn) => {
    let username;
    conn.on("command:user", (user, success, failure) => {
      if (user === FTP_USER) {
        username = user;
        success();
      } else {
        failure();
      }
    });

    conn.on("command:pass", (pass, success, failure) => {
      if (username === FTP_USER && pass === FTP_PASS) {
        success(username);
      } else {
        failure();
      }
    });

    conn.on("file:stor", (req, res) => {
      const filePath = req.filePath;
      const filename = path.basename(filePath);
      console.log("Uploaded:", filename);

      req.pipe(fs.createWriteStream(filePath));
      req.on("end", () => notifyRcon(filename));
    });
  });

  server.listen(FTP_PORT);
  console.log(`FTP Server running on port ${FTP_PORT}`);
}

startFtp();