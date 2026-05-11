#!/usr/bin/env python3
"""
vertex-deploy — One-command client deployment for Vertex Control Center

Usage:
  vertex-deploy clients/horizonte.yaml
  vertex-deploy clients/horizonte.yaml --dry-run
  vertex-deploy clients/horizonte.yaml --step install-ollama
  vertex-deploy --local                     # Deploy to this machine

Deploys the complete Vertex AI operations stack to a client Mac:
  1. SSH connectivity check
  2. Install Homebrew (if needed)
  3. Install Node.js + pnpm
  4. Install Ollama + pull models
  5. Clone & build Vertex Control Center
  6. Create Amy API bridge
  7. Load client knowledge base
  8. Configure RBAC (admin + operator accounts)
  9. Create LaunchAgents for persistence
  10. Health check all services
  11. Send deployment report

Author: Silver Snow Studios
"""

import argparse
import json
import os
import subprocess
import sys
import time
import yaml
from datetime import datetime
from pathlib import Path

# ─── Configuration ────────────────────────────────────────────────────────────

VERTEX_REPO = "https://github.com/X51DRAGON/vertex-control-center.git"
DEPLOY_DIR = "/opt/vertex"
VERTEX_VERSION = "1.0.0"

# Minimum system requirements
MIN_RAM_GB = 8
MIN_DISK_GB = 20
MIN_NODE_MAJOR = 22

# ─── Color Helpers ────────────────────────────────────────────────────────────

class c:
    PURPLE = "\033[35m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    RED = "\033[31m"
    CYAN = "\033[36m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RESET = "\033[0m"

def banner():
    print(f"""
{c.PURPLE}{c.BOLD}╔══════════════════════════════════════════╗
║   ⚓ Vertex Control Center — Deploy      ║
║   Silver Snow Studios · v{VERTEX_VERSION}           ║
╚══════════════════════════════════════════╝{c.RESET}
""")

def step(num, total, msg):
    print(f"\n{c.CYAN}[{num}/{total}]{c.RESET} {c.BOLD}{msg}{c.RESET}")

def ok(msg):
    print(f"  {c.GREEN}✓{c.RESET} {msg}")

def warn(msg):
    print(f"  {c.YELLOW}⚠{c.RESET} {msg}")

def fail(msg):
    print(f"  {c.RED}✗{c.RESET} {msg}")

def info(msg):
    print(f"  {c.DIM}→ {msg}{c.RESET}")


# ─── SSH Helper ───────────────────────────────────────────────────────────────

class RemoteExec:
    """Execute commands on remote Mac via SSH."""

    def __init__(self, host, user, port=22, ssh_key=None):
        self.host = host
        self.user = user
        self.port = port
        self.ssh_key = os.path.expanduser(ssh_key) if ssh_key else None

    def _ssh_args(self):
        args = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10"]
        if self.ssh_key:
            args += ["-i", self.ssh_key]
        args += ["-p", str(self.port), f"{self.user}@{self.host}"]
        return args

    def run(self, cmd, timeout=120, check=True):
        """Execute command on remote host."""
        full_args = self._ssh_args() + [cmd]
        try:
            result = subprocess.run(
                full_args, capture_output=True, text=True, timeout=timeout
            )
            if check and result.returncode != 0:
                raise RuntimeError(f"Remote command failed: {cmd}\n{result.stderr}")
            return result
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"Command timed out after {timeout}s: {cmd}")

    def run_ok(self, cmd, timeout=120):
        """Execute and return True/False."""
        try:
            result = self.run(cmd, timeout=timeout, check=False)
            return result.returncode == 0
        except Exception:
            return False

    def scp_to(self, local_path, remote_path):
        """Copy file to remote host."""
        args = ["scp", "-o", "StrictHostKeyChecking=no"]
        if self.ssh_key:
            args += ["-i", self.ssh_key]
        args += ["-P", str(self.port), local_path, f"{self.user}@{self.host}:{remote_path}"]
        subprocess.run(args, check=True, capture_output=True)

    def scp_dir_to(self, local_dir, remote_path):
        """Copy directory recursively to remote host."""
        args = ["scp", "-r", "-o", "StrictHostKeyChecking=no"]
        if self.ssh_key:
            args += ["-i", self.ssh_key]
        args += ["-P", str(self.port), local_dir, f"{self.user}@{self.host}:{remote_path}"]
        subprocess.run(args, check=True, capture_output=True)


class LocalExec:
    """Execute commands locally (for --local mode)."""

    def run(self, cmd, timeout=120, check=True):
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        if check and result.returncode != 0:
            raise RuntimeError(f"Command failed: {cmd}\n{result.stderr}")
        return result

    def run_ok(self, cmd, timeout=120):
        try:
            result = self.run(cmd, timeout=timeout, check=False)
            return result.returncode == 0
        except Exception:
            return False


# ─── Deployment Steps ─────────────────────────────────────────────────────────

class VertexDeployer:
    """Orchestrates the deployment of Vertex Control Center."""

    def __init__(self, config, dry_run=False, local=False):
        self.config = config
        self.dry_run = dry_run
        self.local = local
        self.results = {}
        self.start_time = time.time()

        if local:
            self.exec = LocalExec()
            self.deploy_dir = os.path.expanduser("~/vertex-control-center")
        else:
            target = config["target"]
            self.exec = RemoteExec(
                host=target["host"],
                user=target["user"],
                port=target.get("port", 22),
                ssh_key=target.get("ssh_key"),
            )
            self.deploy_dir = DEPLOY_DIR

        self.client_name = config["client"]["name"]
        self.client_code = config["client"]["code"]
        self.total_steps = 10

    def deploy(self, single_step=None):
        """Run the full deployment pipeline."""
        banner()
        print(f"  Client: {c.BOLD}{self.client_name}{c.RESET}")
        print(f"  Target: {c.BOLD}{'localhost' if self.local else self.config['target']['host']}{c.RESET}")
        print(f"  Mode:   {c.BOLD}{'LOCAL' if self.local else 'REMOTE'}{c.RESET}")
        if self.dry_run:
            print(f"  {c.YELLOW}DRY RUN — no changes will be made{c.RESET}")
        print()

        steps = {
            "check": (1, "Connectivity & System Check", self.step_check),
            "homebrew": (2, "Homebrew", self.step_homebrew),
            "node": (3, "Node.js + pnpm", self.step_node),
            "ollama": (4, "Ollama + Models", self.step_ollama),
            "clone": (5, "Clone & Build Vertex", self.step_clone_build),
            "bridge": (6, "Amy API Bridge", self.step_bridge),
            "knowledge": (7, "Knowledge Base", self.step_knowledge),
            "users": (8, "RBAC Users", self.step_users),
            "services": (9, "LaunchAgents", self.step_services),
            "health": (10, "Health Check", self.step_health),
        }

        if single_step:
            if single_step not in steps:
                fail(f"Unknown step: {single_step}. Available: {', '.join(steps.keys())}")
                return False
            num, name, fn = steps[single_step]
            step(num, self.total_steps, name)
            return fn()

        for key, (num, name, fn) in steps.items():
            step(num, self.total_steps, name)
            try:
                success = fn()
                self.results[key] = success
                if not success and key in ("check", "node", "ollama", "clone"):
                    fail(f"Critical step failed: {name}. Aborting.")
                    self._print_report()
                    return False
            except Exception as e:
                fail(f"Step failed with error: {e}")
                self.results[key] = False
                if key in ("check", "node", "ollama", "clone"):
                    self._print_report()
                    return False

        self._print_report()
        return all(self.results.values())

    # ── Step 1: Connectivity & System Check ──

    def step_check(self):
        if self.local:
            ok("Local deployment — no SSH needed")
        else:
            info(f"Testing SSH to {self.config['target']['host']}...")
            if self.dry_run:
                ok("Would test SSH connectivity")
                return True
            if not self.exec.run_ok("echo 'vertex-ping'"):
                fail("Cannot connect via SSH")
                return False
            ok("SSH connected")

        # Check system resources
        if self.dry_run:
            ok("Would check system resources")
            return True

        # RAM check
        result = self.exec.run("sysctl -n hw.memsize", check=False)
        if result.returncode == 0:
            ram_gb = int(result.stdout.strip()) / (1024**3)
            if ram_gb >= MIN_RAM_GB:
                ok(f"RAM: {ram_gb:.0f} GB (minimum {MIN_RAM_GB} GB)")
            else:
                warn(f"RAM: {ram_gb:.0f} GB — below recommended {MIN_RAM_GB} GB")

        # Disk check
        result = self.exec.run("df -g / | tail -1 | awk '{print $4}'", check=False)
        if result.returncode == 0:
            try:
                free_gb = int(result.stdout.strip())
                if free_gb >= MIN_DISK_GB:
                    ok(f"Disk: {free_gb} GB free (minimum {MIN_DISK_GB} GB)")
                else:
                    warn(f"Disk: {free_gb} GB free — below recommended {MIN_DISK_GB} GB")
            except ValueError:
                info("Could not parse disk space")

        # macOS version
        result = self.exec.run("sw_vers -productVersion", check=False)
        if result.returncode == 0:
            ok(f"macOS: {result.stdout.strip()}")

        # Architecture
        result = self.exec.run("uname -m", check=False)
        if result.returncode == 0:
            arch = result.stdout.strip()
            ok(f"Architecture: {arch}")
            if arch != "arm64":
                warn("Apple Silicon (arm64) recommended for optimal Ollama performance")

        return True

    # ── Step 2: Homebrew ──

    def step_homebrew(self):
        if self.dry_run:
            ok("Would install/verify Homebrew")
            return True

        if self.exec.run_ok("which brew"):
            ok("Homebrew already installed")
            return True

        info("Installing Homebrew...")
        cmd = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
        try:
            self.exec.run(cmd, timeout=300)
            ok("Homebrew installed")
            return True
        except Exception as e:
            fail(f"Homebrew install failed: {e}")
            return False

    # ── Step 3: Node.js + pnpm ──

    def step_node(self):
        if self.dry_run:
            ok("Would install/verify Node.js and pnpm")
            return True

        # Check Node
        result = self.exec.run("node --version 2>/dev/null || echo 'NOT_FOUND'", check=False)
        node_version = result.stdout.strip()

        if node_version.startswith("v"):
            major = int(node_version.lstrip("v").split(".")[0])
            if major >= MIN_NODE_MAJOR:
                ok(f"Node.js {node_version} (>= v{MIN_NODE_MAJOR})")
            else:
                info(f"Node.js {node_version} too old, installing v22...")
                self.exec.run("brew install node@22", timeout=300)
                ok("Node.js v22 installed")
        else:
            info("Node.js not found, installing...")
            self.exec.run("brew install node@22", timeout=300)
            ok("Node.js v22 installed")

        # Check pnpm
        if not self.exec.run_ok("which pnpm"):
            info("Installing pnpm...")
            self.exec.run("npm install -g pnpm", timeout=60)
            ok("pnpm installed")
        else:
            ok("pnpm already available")

        return True

    # ── Step 4: Ollama + Models ──

    def step_ollama(self):
        if self.dry_run:
            ok("Would install Ollama and pull models")
            return True

        # Check Ollama
        if not self.exec.run_ok("which ollama"):
            info("Installing Ollama...")
            self.exec.run("brew install ollama", timeout=300)
            ok("Ollama installed")

            # Start Ollama service
            self.exec.run("brew services start ollama", check=False)
            time.sleep(3)
        else:
            ok("Ollama already installed")

        # Pull models
        models = self.config.get("models", {})
        primary = models.get("primary", "llama3.1:8b")
        embedding = models.get("embedding", "nomic-embed-text")

        for model_name in [primary, embedding]:
            info(f"Pulling {model_name}...")
            try:
                self.exec.run(f"ollama pull {model_name}", timeout=600)
                ok(f"Model {model_name} ready")
            except Exception as e:
                warn(f"Could not pull {model_name}: {e}")

        if models.get("secondary"):
            info(f"Pulling secondary model {models['secondary']}...")
            try:
                self.exec.run(f"ollama pull {models['secondary']}", timeout=1200)
                ok(f"Model {models['secondary']} ready")
            except Exception as e:
                warn(f"Secondary model pull failed (non-critical): {e}")

        return True

    # ── Step 5: Clone & Build ──

    def step_clone_build(self):
        if self.dry_run:
            ok(f"Would clone {VERTEX_REPO} to {self.deploy_dir}")
            return True

        # Clone or pull
        if self.exec.run_ok(f"test -d {self.deploy_dir}/.git"):
            info("Repository exists, pulling latest...")
            self.exec.run(f"cd {self.deploy_dir} && git pull origin main", timeout=60)
            ok("Updated to latest")
        else:
            info(f"Cloning to {self.deploy_dir}...")
            self.exec.run(f"git clone {VERTEX_REPO} {self.deploy_dir}", timeout=120)
            ok("Repository cloned")

        # Install deps
        info("Installing dependencies...")
        self.exec.run(f"cd {self.deploy_dir} && pnpm install", timeout=180)
        ok("Dependencies installed")

        # Create .env
        services = self.config.get("services", {})
        port = services.get("control_center_port", 3000)
        env_content = f"""PORT={port}
MC_COOKIE_SECURE=false
MC_COOKIE_SAMESITE=lax
MC_ALLOW_ANY_HOST=true
VERTEX_CLIENT={self.client_code}
VERTEX_INDUSTRY={self.config['client'].get('industry', 'general')}
"""
        self.exec.run(f"cat > {self.deploy_dir}/.env << 'ENVEOF'\n{env_content}\nENVEOF")
        ok(f".env configured (port {port})")

        # Build production
        info("Building production bundle...")
        self.exec.run(f"cd {self.deploy_dir} && pnpm build", timeout=300)
        ok("Production build complete")

        return True

    # ── Step 6: Amy API Bridge ──

    def step_bridge(self):
        if self.dry_run:
            ok("Would deploy Amy API bridge")
            return True

        bridge_dir = f"{self.deploy_dir}/bridge"
        self.exec.run(f"mkdir -p {bridge_dir}")

        # The bridge script will be simpler for clients — just the REST wrapper
        # For now, create a placeholder that responds to health checks
        bridge_script = '''#!/usr/bin/env python3
"""Vertex API Bridge — Client deployment version."""
import http.server, json, os, subprocess
from datetime import datetime

PORT = int(os.environ.get("VERTEX_BRIDGE_PORT", "3100"))

class BridgeHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        if self.path == "/api/health":
            data = {"status": "ok", "client": os.environ.get("VERTEX_CLIENT", "unknown"), "timestamp": datetime.now().isoformat()}
        elif self.path == "/api/status":
            # Check Ollama
            try:
                r = subprocess.run(["ollama", "list"], capture_output=True, text=True, timeout=5)
                models = [l.split()[0] for l in r.stdout.strip().split("\\n")[1:] if l.strip()]
            except Exception:
                models = []
            data = {"status": "ok", "models": models, "services": {"ollama": len(models) > 0, "control_center": True, "bridge": True}}
        else:
            self.send_response(404)
            self.end_headers()
            return

        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

if __name__ == "__main__":
    print(f"[Vertex Bridge] Starting on port {PORT}")
    http.server.HTTPServer(("0.0.0.0", PORT), BridgeHandler).serve_forever()
'''
        self.exec.run(f"cat > {bridge_dir}/vertex-bridge.py << 'PYEOF'\n{bridge_script}\nPYEOF")
        self.exec.run(f"chmod +x {bridge_dir}/vertex-bridge.py")
        ok("API bridge deployed")
        return True

    # ── Step 7: Knowledge Base ──

    def step_knowledge(self):
        if self.dry_run:
            ok("Would load client knowledge base")
            return True

        kb_dir = f"{self.deploy_dir}/knowledge/{self.client_code}"
        self.exec.run(f"mkdir -p {kb_dir}")

        sources = self.config.get("knowledge", {}).get("sources", [])
        if not sources:
            info("No knowledge sources configured — client can add later")
            ok("Knowledge directory created (empty)")
            return True

        config_dir = os.path.dirname(os.path.abspath(self.config.get("_config_path", "")))
        loaded = 0
        for source in sources:
            source_path = os.path.join(config_dir, source)
            if os.path.exists(source_path):
                if os.path.isdir(source_path):
                    if not self.local:
                        self.exec.scp_dir_to(source_path, kb_dir)
                    else:
                        self.exec.run(f"cp -r {source_path} {kb_dir}/")
                else:
                    if not self.local:
                        self.exec.scp_to(source_path, f"{kb_dir}/")
                    else:
                        self.exec.run(f"cp {source_path} {kb_dir}/")
                loaded += 1
            else:
                warn(f"Source not found: {source}")

        ok(f"Loaded {loaded}/{len(sources)} knowledge sources")
        return True

    # ── Step 8: RBAC Users ──

    def step_users(self):
        if self.dry_run:
            ok("Would configure RBAC users")
            return True

        # Users are created via the /setup page on first visit
        # We just prepare the env with auth config
        users = self.config.get("users", {})
        admin = users.get("admin", {})

        info(f"Admin: {admin.get('username', 'admin')} — set password on first login at /setup")
        info(f"Additional users can be added via Settings > User Management")

        if users.get("operator"):
            op = users["operator"]
            info(f"Operator: {op.get('username', 'operator')} (role: {op.get('role', 'operator')})")
            info("Create this user after admin setup via Settings > User Management")

        ok("RBAC configuration noted — set up via dashboard")
        return True

    # ── Step 9: LaunchAgents ──

    def step_services(self):
        if self.dry_run:
            ok("Would create LaunchAgents")
            return True

        services = self.config.get("services", {})
        cc_port = services.get("control_center_port", 3000)
        bridge_port = services.get("api_bridge_port", 3100)

        if self.local:
            agents_dir = os.path.expanduser("~/Library/LaunchAgents")
        else:
            result = self.exec.run("echo $HOME")
            home = result.stdout.strip()
            agents_dir = f"{home}/Library/LaunchAgents"

        self.exec.run(f"mkdir -p {agents_dir}")

        # Control Center LaunchAgent
        cc_plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.vertex.control-center.{self.client_code}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>{self.deploy_dir}/node_modules/.bin/next</string>
        <string>start</string>
        <string>--hostname</string>
        <string>0.0.0.0</string>
        <string>--port</string>
        <string>{cc_port}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>{self.deploy_dir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{self.deploy_dir}/logs/control-center.log</string>
    <key>StandardErrorPath</key>
    <string>{self.deploy_dir}/logs/control-center.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT</key>
        <string>{cc_port}</string>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>"""

        # Bridge LaunchAgent
        bridge_plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.vertex.bridge.{self.client_code}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/python3</string>
        <string>{self.deploy_dir}/bridge/vertex-bridge.py</string>
    </array>
    <key>WorkingDirectory</key>
    <string>{self.deploy_dir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{self.deploy_dir}/logs/bridge.log</string>
    <key>StandardErrorPath</key>
    <string>{self.deploy_dir}/logs/bridge.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>VERTEX_CLIENT</key>
        <string>{self.client_code}</string>
        <key>VERTEX_BRIDGE_PORT</key>
        <string>{bridge_port}</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>"""

        # Write and load agents
        self.exec.run(f"mkdir -p {self.deploy_dir}/logs")

        cc_agent = f"{agents_dir}/ai.vertex.control-center.{self.client_code}.plist"
        bridge_agent = f"{agents_dir}/ai.vertex.bridge.{self.client_code}.plist"

        self.exec.run(f"cat > {cc_agent} << 'PLISTEOF'\n{cc_plist}\nPLISTEOF")
        self.exec.run(f"cat > {bridge_agent} << 'PLISTEOF'\n{bridge_plist}\nPLISTEOF")

        # Load agents
        self.exec.run(f"launchctl load {cc_agent}", check=False)
        self.exec.run(f"launchctl load {bridge_agent}", check=False)

        ok(f"Control Center agent: ai.vertex.control-center.{self.client_code}")
        ok(f"Bridge agent: ai.vertex.bridge.{self.client_code}")
        ok("Services will start on boot and stay alive")

        return True

    # ── Step 10: Health Check ──

    def step_health(self):
        if self.dry_run:
            ok("Would verify all services are running")
            return True

        services = self.config.get("services", {})
        cc_port = services.get("control_center_port", 3000)
        bridge_port = services.get("api_bridge_port", 3100)
        host = "127.0.0.1" if self.local else self.config["target"]["host"]

        all_ok = True
        time.sleep(3)  # Give services a moment to start

        # Check Ollama
        if self.exec.run_ok("curl -sf http://127.0.0.1:11434/api/tags > /dev/null"):
            ok("Ollama: ✅ Running")
        else:
            warn("Ollama: ⚠️ Not responding (may need manual start)")
            all_ok = False

        # Check Control Center
        if self.exec.run_ok(f"curl -sf http://127.0.0.1:{cc_port}/ > /dev/null"):
            ok(f"Control Center: ✅ Running on port {cc_port}")
        else:
            warn(f"Control Center: ⚠️ Not responding on port {cc_port}")
            info("May need a few seconds to start — check logs")
            all_ok = False

        # Check Bridge
        if self.exec.run_ok(f"curl -sf http://127.0.0.1:{bridge_port}/api/health > /dev/null"):
            ok(f"API Bridge: ✅ Running on port {bridge_port}")
        else:
            warn(f"API Bridge: ⚠️ Not responding on port {bridge_port}")
            all_ok = False

        return all_ok

    # ── Report ──

    def _print_report(self):
        elapsed = time.time() - self.start_time
        minutes = int(elapsed // 60)
        seconds = int(elapsed % 60)

        services = self.config.get("services", {})
        cc_port = services.get("control_center_port", 3000)
        host = "localhost" if self.local else self.config["target"]["host"]

        print(f"""
{c.PURPLE}{c.BOLD}╔══════════════════════════════════════════╗
║        Deployment Report                 ║
╚══════════════════════════════════════════╝{c.RESET}

  Client:    {c.BOLD}{self.client_name}{c.RESET}
  Target:    {c.BOLD}{host}{c.RESET}
  Duration:  {minutes}m {seconds}s
""")

        for step_name, success in self.results.items():
            status = f"{c.GREEN}✓{c.RESET}" if success else f"{c.RED}✗{c.RESET}"
            print(f"  {status} {step_name}")

        all_ok = all(self.results.values())

        if all_ok:
            print(f"""
{c.GREEN}{c.BOLD}  🎉 Deployment successful!{c.RESET}

  Dashboard: {c.CYAN}http://{host}:{cc_port}{c.RESET}
  1. Open the URL above in your browser
  2. Create admin account at /setup
  3. Add operator users via Settings > User Management
  4. Start using Vertex Control Center!

  {c.DIM}o7 ⚓ — Silver Snow Studios{c.RESET}
""")
        else:
            print(f"""
{c.YELLOW}  ⚠️ Deployment completed with warnings.{c.RESET}
  Check the steps marked ✗ above and resolve manually.
  Then run: vertex-deploy {sys.argv[-1]} --step health
""")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Deploy Vertex Control Center to a client Mac",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("config", nargs="?", help="Client config YAML file")
    parser.add_argument("--local", action="store_true", help="Deploy to this machine")
    parser.add_argument("--dry-run", action="store_true", help="Show what would happen")
    parser.add_argument("--step", help="Run a single deployment step")
    args = parser.parse_args()

    if not args.config and not args.local:
        parser.print_help()
        print(f"\n{c.YELLOW}Examples:{c.RESET}")
        print("  vertex-deploy clients/horizonte.yaml")
        print("  vertex-deploy clients/horizonte.yaml --dry-run")
        print("  vertex-deploy --local")
        sys.exit(1)

    if args.local:
        config = {
            "client": {"name": "Local Development", "code": "local", "industry": "general"},
            "target": {"host": "localhost"},
            "models": {"primary": "llama3.1:8b", "embedding": "nomic-embed-text"},
            "services": {"control_center_port": 3000, "api_bridge_port": 3100},
            "users": {"admin": {"username": "admin"}},
        }
    else:
        config_path = args.config
        if not os.path.exists(config_path):
            fail(f"Config file not found: {config_path}")
            sys.exit(1)
        with open(config_path) as f:
            config = yaml.safe_load(f)
        config["_config_path"] = config_path

    deployer = VertexDeployer(config, dry_run=args.dry_run, local=args.local)
    success = deployer.deploy(single_step=args.step)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
