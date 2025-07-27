import os
import sys
import ctypes
import platform
import subprocess
import zipfile
import yaml
import threading
import time
from pathlib import Path
from mcrcon import MCRcon
import argparse
import socket
import requests

# ==== New imports for cert generation ====
from cryptography import x509
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
import datetime

# ==== Full PKI cert generation ====
def generate_certificates(certs_dir: Path):
    certs_dir.mkdir(parents=True, exist_ok=True)

    ca_key_path = certs_dir / "ca.key.pem"
    ca_cert_path = certs_dir / "ca.crt.pem"
    server_key_path = certs_dir / "server.key.pem"
    server_cert_path = certs_dir / "server.crt.pem"
    client_key_path = certs_dir / "client.key.pem"
    client_der_key_path = certs_dir / "client.key.der"
    client_cert_path = certs_dir / "client.crt.pem"

    # Generate CA key + cert if missing
    if not ca_cert_path.exists() or not ca_key_path.exists():
        ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, u"US"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, u"My CA Org"),
            x509.NameAttribute(NameOID.COMMON_NAME, u"My CA"),
        ])
        ca_cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(ca_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1))
            .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3650))
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .sign(ca_key, hashes.SHA256())
        )
        with open(ca_key_path, "wb") as f:
            f.write(ca_key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption()))
        with open(ca_cert_path, "wb") as f:
            f.write(ca_cert.public_bytes(serialization.Encoding.PEM))
        print(f"[INFO] Generated CA key and cert at {ca_key_path}, {ca_cert_path}")
    else:
        with open(ca_key_path, "rb") as f:
            ca_key = serialization.load_pem_private_key(f.read(), password=None)
        with open(ca_cert_path, "rb") as f:
            ca_cert = x509.load_pem_x509_certificate(f.read())

    # Generate Server key + cert signed by CA if missing
    if not server_cert_path.exists() or not server_key_path.exists():
        server_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        server_subject = x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, u"US"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, u"My Server Org"),
            x509.NameAttribute(NameOID.COMMON_NAME, u"localhost"),
        ])
        server_cert = (
            x509.CertificateBuilder()
            .subject_name(server_subject)
            .issuer_name(ca_cert.subject)
            .public_key(server_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1))
            .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3650))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(u"localhost")]), critical=False)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .sign(ca_key, hashes.SHA256())
        )
        with open(server_key_path, "wb") as f:
            f.write(server_key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption()))
        with open(server_cert_path, "wb") as f:
            f.write(server_cert.public_bytes(serialization.Encoding.PEM))
        print(f"[INFO] Generated Server key and cert at {server_key_path}, {server_cert_path}")

    # Generate Client key + cert signed by CA if missing
    if not client_cert_path.exists() or not client_key_path.exists():
        client_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        client_subject = x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, u"US"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, u"My Client Org"),
            x509.NameAttribute(NameOID.COMMON_NAME, u"My Client"),
        ])
        client_cert = (
            x509.CertificateBuilder()
            .subject_name(client_subject)
            .issuer_name(ca_cert.subject)
            .public_key(client_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1))
            .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3650))
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.CLIENT_AUTH]), critical=False)
            .sign(ca_key, hashes.SHA256())
        )
        with open(client_key_path, "wb") as f:
            f.write(client_key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption()))
        with open(client_der_key_path, "wb") as f:
            f.write(client_key.private_bytes(
                encoding=serialization.Encoding.DER,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption()))
        with open(client_cert_path, "wb") as f:
            f.write(client_cert.public_bytes(serialization.Encoding.PEM))
        print(f"[INFO] Generated Client key and cert at {client_key_path}, {client_der_key_path} and, {client_cert_path}")

    # Combine server key + cert to one PEM for pyftpdlib TLS_FTPHandler
    combined_server_pem = certs_dir / "server.pem"
    if not combined_server_pem.exists():
        with open(combined_server_pem, "wb") as f:
            f.write(server_key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption()))
            f.write(server_cert.public_bytes(serialization.Encoding.PEM))
        print(f"[INFO] Created combined server.pem at {combined_server_pem}")

    return {
        "ca_cert": ca_cert_path,
        "server_cert": server_cert_path,
        "server_key": server_key_path,
        "server_pem": combined_server_pem,
        "client_cert": client_cert_path,
        "client_key": client_key_path,
        "client_der_key": client_der_key_path
    }


parser = argparse.ArgumentParser(description="Changes configuration to support either a local-network-only or an exposed server.")
parser.add_argument('--exposed', action='store_true', help='Enable debug mode')
args = parser.parse_args()

from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import TLS_FTPHandler
from pyftpdlib.servers import FTPServer

PLUGINS_DIR = os.path.abspath("../../plugins")
SERVER_PROPERTIES_PATH = os.path.abspath("../../server.properties")
real_plugins_dir = Path(PLUGINS_DIR).resolve()

RCON_USERNAME = "pluginuploader"
RCON_PASSWORD = "AG0dAwfulAndL0ngP4sswordThat#N0OneCanGuessAnd0nlyIC4n#Us3"

# --- Admin check ---
def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False

if os.name == 'nt' and not is_admin():
    params = " ".join([f'"{arg}"' for arg in sys.argv])
    ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, params, None, 1)
    sys.exit()

# --- Server properties and RCON management ---
def read_server_properties(path="server.properties"):
    props = {}
    try:
        with open(path, "r") as f:
            for line in f:
                if line.strip() and not line.startswith("#") and "=" in line:
                    k, v = line.strip().split("=", 1)
                    props[k.strip()] = v.strip()
    except Exception as e:
        print(f"[WARN] Could not read server.properties: {e}")
    return props

def write_server_properties(props, path="server.properties"):
    with open(path, "w") as f:
        for k, v in props.items():
            f.write(f"{k}={v}\n")

def enable_rcon(path="server.properties"):
    props = read_server_properties(path)
    if props.get("enable-rcon", "false").lower() != "true":
        props["enable-rcon"] = "true"
        write_server_properties(props, path)

def get_local_ip():
    try:
        return socket.gethostbyname(socket.gethostname())
    except Exception:
        return "127.0.0.1"
        
def get_public_ip():
    try:
        ip = requests.get("https://api.ipify.org").text
        return ip
    except requests.RequestException:
        return "Could not determine public IP"

def update_rcon_settings(path, password, port=25575, host="127.0.0.1"):
    props = read_server_properties(path)
    props.update({
        "enable-rcon": "true",
        "rcon.port": str(port),
        "rcon.password": password,
        "rcon.address": host
    })
    write_server_properties(props, path)
    print(f"[INFO] Updated RCON settings in {path}")

def read_rcon_port_from_server_properties(path="server.properties"):
    props = read_server_properties(path)
    return int(props.get("rcon.port", "25575"))

def secure_rcon_port(path="server.properties"):
    enable_rcon(path)
    port = read_rcon_port_from_server_properties(path)
    try:
        if platform.system() == "Windows":
            rule_name = f"Allow RCON Localhost {port}"
            check = subprocess.run(
                ['powershell', '-Command',
                 f'Get-NetFirewallRule -DisplayName "{rule_name}" -ErrorAction SilentlyContinue'],
                stdout=subprocess.PIPE, text=True
            )
            if rule_name not in check.stdout:
                subprocess.run(['powershell', '-Command',
                    f'New-NetFirewallRule -DisplayName "{rule_name}" '
                    f'-Direction Inbound -Protocol TCP -LocalPort {port} '
                    f'-RemoteAddress 127.0.0.1 -Action Allow'], check=True)
                subprocess.run(['powershell', '-Command',
                    f'New-NetFirewallRule -DisplayName "Block RCON External {port}" '
                    f'-Direction Inbound -Protocol TCP -LocalPort {port} '
                    f'-RemoteAddress Any -Action Block'], check=True)
        elif platform.system() == "Linux":
            subprocess.run(['iptables', '-C', 'INPUT', '-p', 'tcp', '--dport', str(port), '-s', '127.0.0.1', '-j', 'ACCEPT'], check=False)
            subprocess.run(['iptables', '-A', 'INPUT', '-p', 'tcp', '--dport', str(port), '-s', '127.0.0.1', '-j', 'ACCEPT'], check=True)
            subprocess.run(['iptables', '-A', 'INPUT', '-p', 'tcp', '--dport', str(port), '-j', 'DROP'], check=True)
    except Exception as e:
        print(f"[ERROR] Securing RCON failed: {e}")

def send_rcon_command(host, port, password, command):
    try:
        with MCRcon(host, password, port=port) as mcr:
            response = mcr.command(command)
            print(f"[INFO] RCON response: {response}")
            return response
    except Exception as e:
        print(f"[ERROR] Failed to send RCON command: {e}")

# --- Plugin Utility ---
def get_plugin_name_from_jar(jar_path):
    try:
        with zipfile.ZipFile(jar_path, 'r') as jar:
            if 'plugin.yml' in jar.namelist():
                with jar.open('plugin.yml') as f:
                    data = yaml.safe_load(f)
                    return data.get("name")
    except Exception as e:
        print(f"[ERROR] Reading plugin.yml failed: {e}")

# --- TLS FTP Server ---
class LiveFTPHandler(TLS_FTPHandler):
    def on_file_received(self, file_path):
        print(f"[INFO] File uploaded: {file_path}")
        if str(file_path).endswith(".jar"):
            plugin_name = get_plugin_name_from_jar(str(file_path))
            if plugin_name:
                print(f"[INFO] Detected plugin: {plugin_name}")
                rcon_port = read_rcon_port_from_server_properties(SERVER_PROPERTIES_PATH)
                send_rcon_command("127.0.0.1", rcon_port, RCON_PASSWORD, f"plugman reload {plugin_name}")

def start_tls_ftp_server():
    authorizer = DummyAuthorizer()
    authorizer.add_user(RCON_USERNAME, RCON_PASSWORD, homedir=real_plugins_dir, perm="elradfmw")

    handler = LiveFTPHandler
    handler.authorizer = authorizer

    # Generate certificates (CA, server, client) if missing
    certs = generate_certificates(Path("certs"))
    handler.certfile = str(certs["server_pem"])  # combined key+cert for pyftpdlib

    handler.tls_control_required = True
    handler.tls_data_required = True
    handler.passive_ports = range(60000, 60100)
    if args.exposed:
        handler.masquerade_address = get_public_ip()
    else:
        ip = get_local_ip()
        print(ip)
        handler.masquerade_address = ip

    server = FTPServer(("0.0.0.0", 2121), handler)
    print("✅ TLS FTP server running on port 2121")

    server.serve_forever()

# --- Setup + Start ---
secure_rcon_port(SERVER_PROPERTIES_PATH)
update_rcon_settings(SERVER_PROPERTIES_PATH, RCON_PASSWORD)

ftp_thread = threading.Thread(target=start_tls_ftp_server, daemon=True)
ftp_thread.start()

try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("\n[INFO] Server shutdown requested. Exiting.")