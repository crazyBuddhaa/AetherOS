#!/usr/bin/env python3
# ==============================================================================
# AetherOS Distributed Compute Node - Single-Cell Kaggle Launcher
# Compatible with Kaggle Dual NVIDIA Tesla T4 (2x 16GB VRAM)
# Canonical Worker Runtime: worker-runtime/aether_worker.py
# Security: Outbound HTTPS polling only, Bearer + replay protection, no secret
# printing, strict failure on invalid credentials or missing hardware/weights.
# ==============================================================================
# Kaggle Notebook Settings (Right Sidebar -> Notebook options):
#   1. Accelerator: GPU T4 x2
#   2. Internet:    Internet On
#   3. Optional Add-ons -> Secrets:
#      - AETHER_WORKER_ID          (if re-using pre-registered worker credentials)
#      - AETHER_WORKER_KEY         (if re-using pre-registered worker credentials)
#      - AETHER_REGISTRATION_TOKEN (if platform enforces enrollment secret)
#      - AETHER_PLATFORM_URL       (override gateway URL if self-hosting)
# ==============================================================================

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

DEFAULT_PLATFORM_URL = "https://aetheros-agent-platform.trileaf.workers.dev"
REPO_URL = "https://github.com/crazyBuddhaa/AetherOS.git"


def load_kaggle_secrets() -> None:
    """Load optional credentials from Kaggle UserSecretsClient without logging values."""
    try:
        from kaggle_secrets import UserSecretsClient  # type: ignore
    except ImportError:
        return

    client = UserSecretsClient()
    for var_name in (
        "AETHER_PLATFORM_URL",
        "AETHER_WORKER_ID",
        "AETHER_WORKER_KEY",
        "AETHER_REGISTRATION_TOKEN",
    ):
        if os.environ.get(var_name):
            continue
        try:
            secret_val = client.get_secret(var_name)
            if secret_val:
                os.environ[var_name] = str(secret_val).strip()
        except Exception:
            # Secret is optional when using open worker auto-registration
            pass


def resolve_worker_runtime_dir() -> Path:
    """Locate worker-runtime/aether_worker.py locally or sync the AetherOS repo."""
    candidates = [
        Path.cwd() / "worker-runtime",
        Path(__file__).resolve().parent if "__file__" in globals() else Path.cwd(),
        Path("/kaggle/working/AetherOS/worker-runtime"),
    ]
    for candidate in candidates:
        if (candidate / "aether_worker.py").is_file():
            return candidate

    target_repo = Path("/kaggle/working/AetherOS")
    if target_repo.exists():
        subprocess.check_call(["git", "-C", str(target_repo), "pull", "--ff-only"])
    else:
        target_repo.parent.mkdir(parents=True, exist_ok=True)
        subprocess.check_call(["git", "clone", "--depth", "1", REPO_URL, str(target_repo)])

    ref = os.environ.get("AETHER_REPO_REF", "").strip()
    if ref:
        subprocess.check_call(["git", "-C", str(target_repo), "fetch", "--depth", "1", "origin", ref])
        subprocess.check_call(["git", "-C", str(target_repo), "checkout", ref])

    runtime_dir = target_repo / "worker-runtime"
    if not (runtime_dir / "aether_worker.py").is_file():
        raise RuntimeError(f"Canonical worker runtime not found at {runtime_dir}")
    return runtime_dir


def ensure_dependencies(runtime_dir: Path) -> None:
    """Install required packages from worker-runtime/requirements.txt if missing."""
    required_modules = ("requests", "psutil", "torch", "transformers", "accelerate")
    missing = []
    for mod in required_modules:
        try:
            __import__(mod)
        except ImportError:
            missing.append(mod)

    if not missing:
        return

    req_file = runtime_dir / "requirements.txt"
    print(f"Installing missing AetherOS worker packages ({', '.join(missing)})...")
    if req_file.is_file():
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "-r", str(req_file)])
    else:
        subprocess.check_call(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "-q",
                "torch>=2.0.0",
                "transformers>=4.44.0",
                "accelerate>=0.30.0",
                "bitsandbytes>=0.43.0",
                "requests>=2.31.0",
                "psutil>=5.9.0",
            ]
        )


def launch() -> None:
    load_kaggle_secrets()
    os.environ.setdefault("AETHER_PLATFORM_URL", DEFAULT_PLATFORM_URL)
    os.environ.setdefault("CONTRIBUTOR_NAME", "Kaggle Community Contributor")

    runtime_dir = resolve_worker_runtime_dir()
    ensure_dependencies(runtime_dir)

    if str(runtime_dir) not in sys.path:
        sys.path.insert(0, str(runtime_dir))

    import aether_worker  # type: ignore

    probe = aether_worker.WorkerApiClient(os.environ["AETHER_PLATFORM_URL"])
    health = probe.check_health()
    print(
        f"Control plane verified online: status={health.get('status')} | "
        f"D1={health.get('d1_connected')} | R2={health.get('r2_connected')}"
    )

    try:
        aether_worker.run_worker()
    except KeyboardInterrupt:
        print("Worker interrupted and shut down cleanly.")


if __name__ == "__main__":
    launch()
