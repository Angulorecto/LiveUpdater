const FtpSrv = require('ftp-srv');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { spawn } = require('child_process');

function startOpenSSLProxy() {
  const certDir = path.resolve(__dirname, 'certs');

  const openssl = spawn('openssl', [
    's_server',
    '-accept', '2121',
    '-cert', path.join(certDir, 'server.crt'),
    '-key', path.join(certDir, 'server.key'),
    '-CAfile', path.join(certDir, 'ca.crt'),
    '-Verify', '1',
    '-verify_return_error',
    '-quiet',
    '-proxy', '127.0.0.1:2222'
  ]);

  openssl.stdout.on('data', (data) => {
    console.log(`[OpenSSL] ${data.toString().trim()}`);
  });

  openssl.stderr.on('data', (data) => {
    console.error(`[OpenSSL ERROR] ${data.toString().trim()}`);
  });

  openssl.on('close', (code) => {
    console.log(`[OpenSSL] Process exited with code ${code}`);
  });

  return openssl;
}

const FTP_PORT = 2222;
const PLUGINS_DIR = '/path/to/minecraft/plugins';
const ALLOWED_PLUGIN = 'PVPPlugin';

const ftpServer = new FtpSrv({
  url: `ftp://127.0.0.1:${FTP_PORT}`,
  anonymous: false,
});

ftpServer.on('login', ({ username, password }, resolve, reject) => {
  // Simple auth
  if (username === 'admin' && password === 'password') {
    resolve({ root: PLUGINS_DIR });
  } else {
    reject(new Error('Unauthorized'));
  }
});

ftpServer.on('upload', ({ filename }) => {
  console.log(`Plugin uploaded: ${filename}`);
  if (filename.endsWith('.jar') && filename.includes(ALLOWED_PLUGIN)) {
    exec(`screen -S minecraft -X stuff "plugman reload ${ALLOWED_PLUGIN}$(printf '\\r')"`);
  }
});

ftpServer.listen().then(() => {
  console.log(`📦 FTP server ready on port ${FTP_PORT}`);
});