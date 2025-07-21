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

parser = argparse.ArgumentParser(description="Changes configuration to support either a local-network-only or an exposed server.")

# Boolean flag (e.g., --debug)
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
    # Create a dummy connection to get the outbound IP
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Doesn't have to be reachable — just used to get local IP
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip
    
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
    handler.certfile = "certs/server.pem"  # must contain both cert + key
    handler.tls_control_required = True
    handler.tls_data_required = True
    handler.passive_ports = range(60000, 60100)
    if args.exposed:
        handler.masquerade_address = get_public_ip()
    else:
        handler.masquerade_address = get_local_ip()

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