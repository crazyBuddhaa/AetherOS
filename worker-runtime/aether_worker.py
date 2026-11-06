#!/usr/bin/env python3
"""
AetherOS Autonomous Contributor Compute Worker (Pull-Based Architecture)

Designed for Kaggle dual NVIDIA Tesla T4 (2x 16GB VRAM) and self-hosted GPU nodes.
Security & Operational Guarantees:
- Outbound HTTPS/HTTP polling only (zero inbound ports or public Kaggle exposure).
- Ephemeral or pre-provisioned worker API keys are transmitted solely in
  Authorization: Bearer headers alongside X-Worker-Id, X-Worker-Timestamp, and
  single-use X-Worker-Nonce replay-protection headers.
- All logs and error reports pass through secret redaction so raw API keys
  and tokens are never written to console logs, notebook cells, or remote steps.
- Never falls back to synthetic worker IDs, placeholder credentials, or simulated
  task completion. Fails explicitly when registration, authentication, or local
  model/hardware prerequisites are unmet.
- Local inference executes real PyTorch / HuggingFace Transformers pipelines
  across available GPUs without external inference API calls.
"""

from __future__ import annotations

import ipaddress
import json
import logging
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

try:
    import psutil
except ImportError:  # pragma: no cover - optional in ultra-minimal environments
    psutil = None

try:
    import requests
except ImportError:  # pragma: no cover - stdlib urllib fallback supported
    requests = None


DEFAULT_PLATFORM_URL = "https://aetheros-agent-platform.trileaf.workers.dev"

# Canonical mapping from AetherOS Model Registry IDs to HuggingFace model repositories
DEFAULT_MODEL_CATALOG: Dict[str, Dict[str, Any]] = {
    "qwen-2.5-coder-14b": {
        "weights_source": "Qwen/Qwen2.5-Coder-14B-Instruct",
        "category": "coding",
        "min_vram_mb_fp16": 28000,
        "min_vram_mb_int4": 10240,
        "default_precision": "int4",
    },
    "deepseek-r1-distill-qwen-14b": {
        "weights_source": "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B",
        "category": "text",
        "min_vram_mb_fp16": 28000,
        "min_vram_mb_int4": 10240,
        "default_precision": "int4",
    },
    "qwen-2-vl-7b-instruct": {
        "weights_source": "Qwen/Qwen2-VL-7B-Instruct",
        "category": "vision",
        "min_vram_mb_fp16": 15360,
        "min_vram_mb_int4": 8192,
        "default_precision": "fp16",
    },
    "whisper-large-v3-turbo": {
        "weights_source": "openai/whisper-large-v3-turbo",
        "category": "speech",
        "min_vram_mb_fp16": 4096,
        "min_vram_mb_int4": 3072,
        "default_precision": "fp16",
    },
    "sd-1.5-standard": {
        "weights_source": "runwayml/stable-diffusion-v1-5",
        "category": "image",
        "min_vram_mb_fp16": 6144,
        "min_vram_mb_int4": 6144,
        "default_precision": "fp16",
    },
    "sdxl-lightning": {
        "weights_source": "ByteDance/SDXL-Lightning",
        "category": "image",
        "min_vram_mb_fp16": 10240,
        "min_vram_mb_int4": 10240,
        "default_precision": "fp16",
    },
    "real-esrgan-4x": {
        "weights_source": "xinntao/Real-ESRGAN",
        "category": "image_processing",
        "min_vram_mb_fp16": 4096,
        "min_vram_mb_int4": 4096,
        "default_precision": "fp16",
    },
    "birefnet-bg-removal": {
        "weights_source": "ZhengPeng7/BiRefNet",
        "category": "image_processing",
        "min_vram_mb_fp16": 4096,
        "min_vram_mb_int4": 4096,
        "default_precision": "fp16",
    },
    "animatediff-motion-v3": {
        "weights_source": "guoyww/animatediff-motion-adapter-v1-5-3",
        "category": "video",
        "min_vram_mb_fp16": 12288,
        "min_vram_mb_int4": 12288,
        "default_precision": "fp16",
    },
    "bge-large-en-v1.5": {
        "weights_source": "BAAI/bge-large-en-v1.5",
        "category": "embedding",
        "min_vram_mb_fp16": 2048,
        "min_vram_mb_int4": 2048,
        "default_precision": "fp16",
    },
}

SECRET_PATTERNS = (
    re.compile(r"ak_(?:live|test)_[a-zA-Z0-9_-]{8,}"),
    re.compile(r"(Bearer\s+)[a-zA-Z0-9._~+/=-]{8,}", re.IGNORECASE),
    re.compile(r"(X-Registration-Token['\":\s]+)[a-zA-Z0-9._~+/=-]{6,}", re.IGNORECASE),
    re.compile(r"((?:hmac-)?sha256\$[0-9a-fA-F]+\$)[0-9a-fA-F]+"),
)


def redact_secrets(text: str, extra_secrets: Optional[List[str]] = None) -> str:
    """Scrub worker API keys, bearer tokens, and hashes from logs or error messages."""
    if not text:
        return ""
    sanitized = str(text)
    if extra_secrets:
        for secret in extra_secrets:
            if secret and len(secret) >= 6:
                sanitized = sanitized.replace(secret, "[REDACTED]")
    sanitized = SECRET_PATTERNS[0].sub("[REDACTED_WORKER_KEY]", sanitized)
    sanitized = SECRET_PATTERNS[1].sub(r"\1[REDACTED]", sanitized)
    sanitized = SECRET_PATTERNS[2].sub(r"\1[REDACTED]", sanitized)
    sanitized = SECRET_PATTERNS[3].sub(r"\1[REDACTED]", sanitized)
    return sanitized


class SecretRedactingFilter(logging.Filter):
    """Logging filter that guarantees credentials are never emitted to stdout/files."""

    def __init__(self, secrets_ref: Optional[Callable[[], List[str]]] = None) -> None:
        super().__init__()
        self._secrets_ref = secrets_ref

    def filter(self, record: logging.LogRecord) -> bool:
        extra = self._secrets_ref() if self._secrets_ref else None
        msg = record.getMessage()
        record.msg = redact_secrets(msg, extra)
        record.args = ()
        return True


logger = logging.getLogger("AetherWorker")
if not logger.handlers:
    _handler = logging.StreamHandler(sys.stdout)
    _handler.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    )
    logger.addHandler(_handler)
logger.setLevel(logging.INFO)
logger.propagate = False


def validate_platform_url(raw_url: str) -> str:
    """Validate that AETHER_PLATFORM_URL uses https:// (or http:// for localhost/loopback)."""
    cleaned = (raw_url or "").strip().rstrip("/")
    parsed = urllib.parse.urlparse(cleaned)
    if parsed.scheme not in ("https", "http") or not parsed.netloc:
        raise ValueError(f"Invalid AETHER_PLATFORM_URL '{raw_url}': expected http(s)://<host>")

    if parsed.scheme == "http":
        host = (parsed.hostname or "").lower()
        is_local = host in ("localhost", "127.0.0.1", "::1")
        if not is_local:
            try:
                ip = ipaddress.ip_address(host)
                is_local = ip.is_loopback or ip.is_private
            except ValueError:
                is_local = False
        if not is_local and os.environ.get("AETHER_ALLOW_INSECURE_HTTP") != "1":
            raise ValueError(
                f"Refusing insecure http:// URL '{cleaned}' for remote host. "
                "Use https:// or set AETHER_ALLOW_INSECURE_HTTP=1 explicitly for private LAN tests."
            )
    return cleaned


def _get_system_ram_mb() -> int:
    if psutil is not None:
        try:
            return int(psutil.virtual_memory().total // (1024 * 1024))
        except Exception:
            pass
    try:
        page_size = os.sysconf("SC_PAGE_SIZE")
        phys_pages = os.sysconf("SC_PHYS_PAGES")
        return int((page_size * phys_pages) // (1024 * 1024))
    except Exception:
        return 16384


def _query_nvidia_smi() -> Optional[Tuple[float, float]]:
    """Query aggregate GPU utilization (%) and max temperature (C) via nvidia-smi."""
    nvsmi = shutil.which("nvidia-smi")
    if not nvsmi:
        return None
    try:
        out = subprocess.check_output(
            [
                nvsmi,
                "--query-gpu=utilization.gpu,temperature.gpu",
                "--format=csv,noheader,nounits",
            ],
            stderr=subprocess.DEVNULL,
            timeout=3,
            text=True,
        )
        utils: List[float] = []
        temps: List[float] = []
        for line in out.strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 2:
                try:
                    utils.append(float(parts[0]))
                    temps.append(float(parts[1]))
                except ValueError:
                    continue
        if utils and temps:
            return round(sum(utils) / len(utils), 1), max(temps)
    except Exception:
        return None
    return None


def detect_hardware(provider_override: Optional[str] = None) -> Dict[str, Any]:
    """Detect local GPU devices (including individual T4x2 devices), aggregate VRAM, and system RAM accurately."""
    gpu_count = 0
    gpu_model = "CPU Only"
    vram_mb = 0
    cuda_available = False
    gpu_devices: List[Dict[str, Any]] = []

    try:
        import torch

        if torch.cuda.is_available():
            cuda_available = True
            gpu_count = torch.cuda.device_count()
            gpu_model = torch.cuda.get_device_name(0)
            total_bytes = 0
            for i in range(gpu_count):
                props = torch.cuda.get_device_properties(i)
                dev_total_mb = int(props.total_memory // (1024 * 1024))
                dev_used_mb = int(torch.cuda.memory_allocated(i) // (1024 * 1024))
                total_bytes += props.total_memory
                gpu_devices.append(
                    {
                        "index": i,
                        "name": torch.cuda.get_device_name(i),
                        "vram_total_mb": dev_total_mb,
                        "vram_used_mb": dev_used_mb,
                        "vram_free_mb": max(0, dev_total_mb - dev_used_mb),
                    }
                )
            vram_mb = int(total_bytes // (1024 * 1024))
    except ImportError:
        logger.warning("PyTorch not installed in Python environment; reporting 0 CUDA GPUs.")

    system_ram_mb = _get_system_ram_mb()
    if provider_override:
        provider = provider_override
    elif "KAGGLE_KERNEL_RUN_TYPE" in os.environ:
        provider = "kaggle"
    else:
        provider = "self_hosted"

    hostname = socket.gethostname()[:8] or "node"
    node_prefix = "Kaggle" if provider == "kaggle" else "Worker"

    capabilities: List[str] = ["diagnostic"]
    if cuda_available:
        capabilities = [
            "text",
            "code",
            "coding",
            "vision",
            "image",
            "image_processing",
            "video",
            "audio",
            "speech",
            "embedding",
            "diagnostic",
        ]

    return {
        "name": f"{node_prefix} {gpu_model} Node ({hostname})",
        "provider": provider,
        "gpu_model": gpu_model,
        "gpu_count": gpu_count if cuda_available else 0,
        "vram_mb": vram_mb,
        "system_ram_mb": system_ram_mb,
        "cuda_available": cuda_available,
        "capabilities": capabilities,
        "gpu_devices": gpu_devices,
        "loaded_models": [],
        "contributor_name": os.environ.get("CONTRIBUTOR_NAME", "Kaggle Contributor Node"),
    }


def get_telemetry(loaded_models: Optional[List[str]] = None) -> Dict[str, Any]:
    """Sample live CUDA memory usage per GPU, GPU utilization, and temperature."""
    gpu_util = 0.0
    vram_used_mb = 0
    gpu_temp = 0.0
    gpu_devices: List[Dict[str, Any]] = []

    try:
        import torch

        if torch.cuda.is_available():
            allocated_bytes = 0
            for i in range(torch.cuda.device_count()):
                props = torch.cuda.get_device_properties(i)
                dev_total_mb = int(props.total_memory // (1024 * 1024))
                dev_used_mb = int(torch.cuda.memory_allocated(i) // (1024 * 1024))
                allocated_bytes += torch.cuda.memory_allocated(i)
                gpu_devices.append(
                    {
                        "index": i,
                        "name": torch.cuda.get_device_name(i),
                        "vram_total_mb": dev_total_mb,
                        "vram_used_mb": dev_used_mb,
                        "vram_free_mb": max(0, dev_total_mb - dev_used_mb),
                    }
                )
            vram_used_mb = int(allocated_bytes // (1024 * 1024))
    except Exception:
        pass

    smi = _query_nvidia_smi()
    if smi is not None:
        gpu_util, gpu_temp = smi

    payload: Dict[str, Any] = {
        "gpu_utilization_percent": gpu_util,
        "gpu_memory_used_mb": vram_used_mb,
        "gpu_temperature_c": gpu_temp,
    }
    if gpu_devices:
        payload["gpu_devices"] = gpu_devices
    if loaded_models is not None:
        payload["loaded_models"] = loaded_models
    return payload


@dataclass
class HttpResponse:
    status_code: int
    text: str
    content: bytes
    headers: Dict[str, str] = field(default_factory=dict)

    def json(self) -> Any:
        return json.loads(self.text)


class WorkerApiClient:
    """
    Authenticated, replay-protected outbound HTTP client for the AetherOS Control Plane.
    Never exposes credentials in query strings or logs.
    """

    def __init__(
        self,
        platform_url: str,
        worker_id: Optional[str] = None,
        worker_key: Optional[str] = None,
        registration_token: Optional[str] = None,
    ) -> None:
        self.platform_url = validate_platform_url(platform_url)
        self.worker_id = worker_id.strip() if worker_id else None
        self.worker_key = worker_key.strip() if worker_key else None
        self.registration_token = registration_token.strip() if registration_token else None
        self._lock = threading.Lock()
        self._session = requests.Session() if requests is not None else None

        # Install secret-redacting log filter tied to this client's active credentials
        for h in logger.handlers:
            h.filters = [f for f in h.filters if not isinstance(f, SecretRedactingFilter)]
            h.addFilter(SecretRedactingFilter(self._active_secrets))

    def _active_secrets(self) -> List[str]:
        items: List[str] = []
        if self.worker_key:
            items.append(self.worker_key)
        if self.registration_token:
            items.append(self.registration_token)
        return items

    def set_credentials(self, worker_id: str, worker_key: str) -> None:
        with self._lock:
            self.worker_id = worker_id
            self.worker_key = worker_key

    def _build_worker_headers(self, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        with self._lock:
            key = self.worker_key
            wid = self.worker_id

        if not key:
            raise RuntimeError("Worker API key is not configured; cannot make authenticated request")

        headers: Dict[str, str] = {
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
            "X-Worker-Timestamp": str(int(time.time() * 1000)),
            "X-Worker-Nonce": secrets.token_hex(16),
            "User-Agent": "AetherOS-Worker/2.0",
        }
        if wid:
            headers["X-Worker-Id"] = wid
        if extra:
            headers.update(extra)
        return headers

    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Optional[Dict[str, Any]] = None,
        raw_body: Optional[bytes] = None,
        headers: Optional[Dict[str, str]] = None,
        authenticated: bool = True,
        timeout: int = 20,
    ) -> HttpResponse:
        url = f"{self.platform_url}{path if path.startswith('/') else '/' + path}"
        req_headers: Dict[str, str] = {}
        if authenticated:
            req_headers.update(self._build_worker_headers())
        else:
            req_headers["Accept"] = "application/json"
            req_headers["User-Agent"] = "AetherOS-Worker/2.0"

        if json_body is not None:
            payload_bytes = json.dumps(json_body).encode("utf-8")
            req_headers.setdefault("Content-Type", "application/json")
        else:
            payload_bytes = raw_body

        if headers:
            req_headers.update(headers)

        if self._session is not None:
            try:
                resp = self._session.request(
                    method=method.upper(),
                    url=url,
                    data=payload_bytes,
                    headers=req_headers,
                    timeout=timeout,
                )
                return HttpResponse(
                    status_code=resp.status_code,
                    text=resp.text,
                    content=resp.content,
                    headers={k.lower(): v for k, v in resp.headers.items()},
                )
            except requests.RequestException as exc:
                raise ConnectionError(redact_secrets(str(exc), self._active_secrets())) from exc

        # Stdlib urllib fallback when requests package is not installed
        req = urllib.request.Request(
            url=url,
            data=payload_bytes,
            headers=req_headers,
            method=method.upper(),
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                return HttpResponse(
                    status_code=resp.status,
                    text=raw.decode("utf-8", errors="replace"),
                    content=raw,
                    headers={k.lower(): v for k, v in resp.headers.items()},
                )
        except urllib.error.HTTPError as err:
            raw = err.read() if err.fp else b""
            return HttpResponse(
                status_code=err.code,
                text=raw.decode("utf-8", errors="replace"),
                content=raw,
                headers={k.lower(): v for k, v in err.headers.items()} if err.headers else {},
            )
        except urllib.error.URLError as err:
            raise ConnectionError(redact_secrets(str(err.reason), self._active_secrets())) from err

    def check_health(self) -> Dict[str, Any]:
        resp = self._request("GET", "/api/health", authenticated=False, timeout=15)
        if resp.status_code != 200:
            raise RuntimeError(f"Platform health check failed ({resp.status_code}): {resp.text}")
        return resp.json()

    def verify_credentials(self) -> Dict[str, Any]:
        """Verify pre-configured worker credentials via GET /api/workers/me."""
        if not self.worker_key:
            raise RuntimeError("Missing AETHER_WORKER_KEY for credential verification")

        resp = self._request("GET", "/api/workers/me", authenticated=True, timeout=15)
        if resp.status_code != 200:
            raise RuntimeError(
                f"Worker credential verification failed ({resp.status_code}): "
                f"{redact_secrets(resp.text, self._active_secrets())}"
            )
        data = resp.json()
        remote_worker = data.get("worker") or {}
        remote_id = remote_worker.get("id")
        if not remote_id:
            raise RuntimeError("Invalid /api/workers/me response: missing worker.id")
        if self.worker_id and remote_id != self.worker_id:
            raise RuntimeError(
                f"Worker identity mismatch: configured AETHER_WORKER_ID='{self.worker_id}', "
                f"but API key belongs to '{remote_id}'"
            )
        self.worker_id = remote_id
        return data

    def register(self, hardware: Dict[str, Any]) -> Tuple[str, str]:
        """
        Register this worker node with Central AetherOS.
        Never falls back to fake worker IDs or placeholder keys on failure.
        """
        payload = {
            "name": hardware["name"],
            "provider": hardware["provider"],
            "gpu_model": hardware["gpu_model"],
            "gpu_count": hardware["gpu_count"],
            "vram_mb": hardware["vram_mb"],
            "system_ram_mb": hardware["system_ram_mb"],
            "capabilities": hardware.get("capabilities", ["text", "code"]),
            "contributor_name": hardware.get("contributor_name", "Kaggle Contributor Node"),
        }
        headers: Dict[str, str] = {}
        if self.registration_token:
            headers["X-Registration-Token"] = self.registration_token

        resp = self._request(
            "POST",
            "/api/workers/register",
            json_body=payload,
            headers=headers,
            authenticated=False,
            timeout=20,
        )
        if resp.status_code != 201:
            raise RuntimeError(
                f"Worker registration rejected by platform ({resp.status_code}): "
                f"{redact_secrets(resp.text, self._active_secrets())}"
            )

        data = resp.json()
        worker_obj = data.get("worker") or {}
        worker_id = worker_obj.get("id")
        api_key = data.get("api_key")

        if not worker_id or not isinstance(worker_id, str):
            raise RuntimeError("Platform registration response missing valid worker.id")
        if not api_key or not isinstance(api_key, str) or len(api_key) < 16:
            raise RuntimeError("Platform registration response missing valid api_key")

        self.set_credentials(worker_id, api_key)
        logger.info(f"Registered worker '{worker_id}' with ephemeral API credential")
        return worker_id, api_key

    def ensure_authenticated(self, hardware: Dict[str, Any]) -> str:
        """
        Either verify existing AETHER_WORKER_ID/AETHER_WORKER_KEY via /api/workers/me
        or register a new ephemeral worker credential. Fails loudly on partial/invalid credentials.
        """
        if self.worker_id and not self.worker_key:
            raise RuntimeError(
                "AETHER_WORKER_ID is set without AETHER_WORKER_KEY. Provide both or unset both to register."
            )

        if self.worker_key:
            info = self.verify_credentials()
            worker_data = info["worker"]
            # If worker was previously offline (e.g. re-attaching persistent key), send an online heartbeat
            if worker_data.get("status") == "offline":
                self.send_heartbeat(status="online", uptime_seconds=0)
            logger.info(f"Authenticated existing worker '{self.worker_id}'")
            return self.worker_id  # type: ignore[return-value]

        worker_id, _ = self.register(hardware)
        return worker_id

    def send_heartbeat(
        self,
        status: str = "online",
        uptime_seconds: int = 15,
        telemetry: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if not self.worker_id:
            raise RuntimeError("Cannot send heartbeat before worker authentication")
        sample = telemetry if telemetry is not None else get_telemetry()
        payload = {
            "worker_id": self.worker_id,
            "status": status,
            "gpu_utilization_percent": sample["gpu_utilization_percent"],
            "gpu_memory_used_mb": sample["gpu_memory_used_mb"],
            "gpu_temperature_c": sample["gpu_temperature_c"],
            "uptime_seconds": uptime_seconds,
        }
        resp = self._request("POST", "/api/workers/heartbeat", json_body=payload, timeout=15)
        if resp.status_code != 200:
            raise RuntimeError(
                f"Heartbeat rejected ({resp.status_code}): "
                f"{redact_secrets(resp.text, self._active_secrets())}"
            )
        return resp.json()

    def claim_task(self) -> Optional[Dict[str, Any]]:
        if not self.worker_id:
            raise RuntimeError("Cannot claim task before worker authentication")
        resp = self._request(
            "POST",
            "/api/workers/tasks/claim",
            json_body={"worker_id": self.worker_id},
            timeout=15,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"Task claim failed ({resp.status_code}): "
                f"{redact_secrets(resp.text, self._active_secrets())}"
            )
        return resp.json().get("task")

    def get_task(self, task_id: str) -> Dict[str, Any]:
        resp = self._request("GET", f"/api/workers/tasks/{task_id}", timeout=15)
        if resp.status_code != 200:
            raise RuntimeError(
                f"Task fetch failed ({resp.status_code}): "
                f"{redact_secrets(resp.text, self._active_secrets())}"
            )
        return resp.json()["task"]

    def update_progress(
        self,
        task_id: str,
        step_number: int,
        step_name: str,
        status: str,
        logs: str = "",
        progress_percent: int = 0,
    ) -> None:
        if not self.worker_id:
            raise RuntimeError("Cannot report progress before worker authentication")
        clean_logs = redact_secrets(logs, self._active_secrets())
        payload = {
            "worker_id": self.worker_id,
            "step_number": step_number,
            "step_name": step_name,
            "status": status,
            "logs": clean_logs,
            "progress_percent": progress_percent,
        }
        resp = self._request(
            "POST",
            f"/api/workers/tasks/{task_id}/progress",
            json_body=payload,
            timeout=15,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"Progress update rejected ({resp.status_code}): "
                f"{redact_secrets(resp.text, self._active_secrets())}"
            )

    def download_file(self, r2_key: str) -> bytes:
        clean_key = (r2_key or "").lstrip("/")
        if ".." in clean_key or "\\" in clean_key or "\x00" in clean_key or not clean_key:
            raise ValueError(f"Unsafe R2 object key '{r2_key}'")
        encoded = urllib.parse.quote(clean_key, safe="/")
        resp = self._request("GET", f"/api/files/download/{encoded}", authenticated=False, timeout=60)
        if resp.status_code != 200:
            raise RuntimeError(f"Failed to download input artifact '{r2_key}' ({resp.status_code})")
        return resp.content

    def upload_artifact(
        self,
        task_id: str,
        filename: str,
        content_bytes: bytes,
        content_type: str = "application/octet-stream",
    ) -> Dict[str, Any]:
        """Upload task output artifact to Cloudflare R2 via authenticated worker endpoint."""
        boundary = f"----AetherBoundary{secrets.token_hex(12)}"
        safe_filename = os.path.basename(filename) or "artifact.bin"
        header_part = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{safe_filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8")
        footer_part = f"\r\n--{boundary}--\r\n".encode("utf-8")
        multipart_body = header_part + content_bytes + footer_part

        resp = self._request(
            "POST",
            f"/api/workers/tasks/{task_id}/artifacts",
            raw_body=multipart_body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            authenticated=True,
            timeout=60,
        )
        if resp.status_code not in (200, 201):
            raise RuntimeError(
                f"Artifact upload failed ({resp.status_code}): "
                f"{redact_secrets(resp.text, self._active_secrets())}"
            )
        return resp.json()["file"]

    def complete_task(self, task_id: str, result_payload: Dict[str, Any]) -> None:
        if not self.worker_id:
            raise RuntimeError("Cannot complete task before worker authentication")
        payload = {
            "worker_id": self.worker_id,
            "result_payload": result_payload,
        }
        resp = self._request(
            "POST",
            f"/api/workers/tasks/{task_id}/result",
            json_body=payload,
            timeout=20,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"Task result submission failed ({resp.status_code}): "
                f"{redact_secrets(resp.text, self._active_secrets())}"
            )

    def fail_task(self, task_id: str, error_message: str) -> None:
        if not self.worker_id:
            return
        clean_err = redact_secrets(error_message, self._active_secrets())
        payload = {
            "worker_id": self.worker_id,
            "error_message": clean_err,
        }
        resp = self._request(
            "POST",
            f"/api/workers/tasks/{task_id}/fail",
            json_body=payload,
            timeout=15,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"Task failure report rejected ({resp.status_code}): "
                f"{redact_secrets(resp.text, self._active_secrets())}"
            )

    def shutdown(self, uptime_seconds: int = 0) -> Optional[Dict[str, Any]]:
        """Gracefully transition worker offline and release any active claimed task."""
        if not self.worker_id or not self.worker_key:
            return None
        try:
            resp = self._request(
                "POST",
                "/api/workers/shutdown",
                json_body={
                    "worker_id": self.worker_id,
                    "uptime_seconds": uptime_seconds,
                },
                authenticated=True,
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json()
                logger.info(
                    f"Worker '{self.worker_id}' gracefully shut down "
                    f"(released_task_id={data.get('released_task_id')})"
                )
                return data
            if resp.status_code == 409:
                return {"success": True, "already_offline": True}
            logger.warning(f"Worker shutdown returned status {resp.status_code}")
        except Exception as exc:
            logger.warning(f"Worker shutdown request error: {exc}")
        return None


class LocalInferenceEngine:
    """
    Real local GPU inference engine using PyTorch + HuggingFace Transformers / Accelerate.
    Caches loaded model & tokenizer in VRAM across tasks and never simulates output with sleep().
    """

    def __init__(self, hardware: Dict[str, Any]) -> None:
        self.hardware = hardware
        self._loaded_model_id: Optional[str] = None
        self._loaded_precision: Optional[str] = None
        self._model: Any = None
        self._tokenizer: Any = None

    def resolve_model_spec(
        self, requested_model: Optional[str], requested_precision: Optional[str] = None
    ) -> Dict[str, Any]:
        model_key = (requested_model or "qwen-2.5-coder-14b").strip()
        spec = DEFAULT_MODEL_CATALOG.get(model_key)
        if spec:
            precision = (requested_precision or spec["default_precision"]).lower()
            min_vram = (
                spec["min_vram_mb_int4"] if precision == "int4" else spec["min_vram_mb_fp16"]
            )
            return {
                "registry_id": model_key,
                "weights_source": spec["weights_source"],
                "category": spec["category"],
                "precision": precision,
                "min_vram_mb": min_vram,
            }

        # Direct HuggingFace repo ID (e.g. "Qwen/Qwen2.5-0.5B-Instruct")
        precision = (requested_precision or ("int4" if "14B" in model_key or "7B" in model_key else "fp16")).lower()
        return {
            "registry_id": model_key,
            "weights_source": model_key,
            "category": "text",
            "precision": precision,
            "min_vram_mb": 0,
        }

    def check_inference_prerequisites(self, spec: Dict[str, Any], require_gpu: bool = True) -> None:
        missing: List[str] = []
        for pkg in ("torch", "transformers", "accelerate"):
            try:
                __import__(pkg)
            except ImportError:
                missing.append(pkg)

        if missing:
            raise RuntimeError(
                f"Local inference cannot start: missing required Python packages: {', '.join(missing)}"
            )

        import torch

        if require_gpu and not torch.cuda.is_available():
            raise RuntimeError(
                "Local inference requires CUDA GPU acceleration, but torch.cuda.is_available() is False"
            )

        available_vram = self.hardware.get("vram_mb", 0)
        required_vram = spec.get("min_vram_mb", 0)
        if require_gpu and required_vram > 0 and available_vram < required_vram:
            raise RuntimeError(
                f"Insufficient GPU VRAM for '{spec['weights_source']}' ({spec['precision']}): "
                f"requires {required_vram} MB, worker has {available_vram} MB"
            )

    def ensure_model_loaded(
        self,
        spec: Dict[str, Any],
        progress_cb: Optional[Callable[[str], None]] = None,
    ) -> float:
        weights_source = spec["weights_source"]
        precision = spec["precision"]

        if (
            self._model is not None
            and self._tokenizer is not None
            and self._loaded_model_id == weights_source
            and self._loaded_precision == precision
        ):
            if progress_cb:
                progress_cb(f"Model '{weights_source}' ({precision}) already hot in GPU VRAM.")
            return 0.0

        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        t0 = time.monotonic()

        # Unload prior model cleanly before loading a different checkpoint
        if self._model is not None:
            del self._model
            self._model = None
        if self._tokenizer is not None:
            del self._tokenizer
            self._tokenizer = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        if progress_cb:
            progress_cb(f"Loading tokenizer from '{weights_source}'...")

        tokenizer = AutoTokenizer.from_pretrained(weights_source, trust_remote_code=False)
        if tokenizer.pad_token_id is None and tokenizer.eos_token_id is not None:
            tokenizer.pad_token_id = tokenizer.eos_token_id

        load_kwargs: Dict[str, Any] = {
            "trust_remote_code": False,
            "low_cpu_mem_usage": True,
        }

        if torch.cuda.is_available():
            load_kwargs["device_map"] = "auto"
            if precision == "int4":
                try:
                    from transformers import BitsAndBytesConfig

                    load_kwargs["quantization_config"] = BitsAndBytesConfig(
                        load_in_4bit=True,
                        bnb_4bit_quant_type="nf4",
                        bnb_4bit_compute_dtype=torch.float16,
                        bnb_4bit_use_double_quant=True,
                    )
                    if progress_cb:
                        progress_cb(
                            f"Loading '{weights_source}' with 4-bit NF4 quantization across "
                            f"{torch.cuda.device_count()} CUDA device(s)..."
                        )
                except ImportError as exc:
                    raise RuntimeError(
                        "INT4 quantization requested, but 'bitsandbytes' is not installed."
                    ) from exc
            else:
                load_kwargs["torch_dtype"] = torch.float16
                if progress_cb:
                    progress_cb(
                        f"Loading '{weights_source}' in FP16 across "
                        f"{torch.cuda.device_count()} CUDA device(s)..."
                    )
        else:
            load_kwargs["torch_dtype"] = torch.float32
            if progress_cb:
                progress_cb(f"Loading '{weights_source}' in FP32 on CPU...")

        model = AutoModelForCausalLM.from_pretrained(weights_source, **load_kwargs)
        model.eval()

        self._model = model
        self._tokenizer = tokenizer
        self._loaded_model_id = weights_source
        self._loaded_precision = precision
        return round(time.monotonic() - t0, 3)

    def generate_text(
        self,
        *,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_new_tokens: int = 512,
        temperature: float = 0.2,
        stream_cb: Optional[Callable[[int, str], None]] = None,
    ) -> Dict[str, Any]:
        if self._model is None or self._tokenizer is None:
            raise RuntimeError("Model must be loaded before calling generate_text()")

        import torch
        from transformers import TextIteratorStreamer

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        if hasattr(self._tokenizer, "apply_chat_template") and self._tokenizer.chat_template:
            formatted_prompt = self._tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
        else:
            formatted_prompt = (
                f"System: {system_prompt}\n\nUser: {prompt}\n\nAssistant:"
                if system_prompt
                else prompt
            )

        inputs = self._tokenizer(formatted_prompt, return_tensors="pt")
        target_device = getattr(self._model, "device", None)
        if target_device is not None:
            inputs = {k: v.to(target_device) for k, v in inputs.items()}

        prompt_token_count = int(inputs["input_ids"].shape[-1])
        streamer = TextIteratorStreamer(
            self._tokenizer, skip_prompt=True, skip_special_tokens=True
        )

        do_sample = temperature is not None and float(temperature) > 0.0
        gen_kwargs: Dict[str, Any] = {
            **inputs,
            "max_new_tokens": int(max_new_tokens),
            "streamer": streamer,
            "do_sample": do_sample,
            "pad_token_id": self._tokenizer.pad_token_id,
        }
        if do_sample:
            gen_kwargs["temperature"] = float(temperature)

        generation_error: List[BaseException] = []

        def _worker() -> None:
            try:
                with torch.inference_mode():
                    self._model.generate(**gen_kwargs)
            except BaseException as exc:  # pragma: no cover
                generation_error.append(exc)

        t0 = time.monotonic()
        gen_thread = threading.Thread(target=_worker, daemon=True)
        gen_thread.start()

        chunks: List[str] = []
        chunk_count = 0
        last_report_ts = time.monotonic()
        for piece in streamer:
            chunks.append(piece)
            chunk_count += 1
            now = time.monotonic()
            if stream_cb and (now - last_report_ts >= 3.0):
                last_report_ts = now
                stream_cb(chunk_count, "".join(chunks))

        gen_thread.join()
        if generation_error:
            raise generation_error[0]

        gen_duration = max(time.monotonic() - t0, 1e-4)
        generated_text = "".join(chunks)
        generated_tokens = len(
            self._tokenizer.encode(generated_text, add_special_tokens=False)
        )
        tok_per_sec = round(generated_tokens / gen_duration, 2)

        peak_vram_mb = 0
        if torch.cuda.is_available():
            peak_bytes = sum(
                torch.cuda.max_memory_allocated(i) for i in range(torch.cuda.device_count())
            )
            peak_vram_mb = int(peak_bytes // (1024 * 1024))

        return {
            "output_text": generated_text,
            "prompt_tokens": prompt_token_count,
            "generated_tokens": generated_tokens,
            "tokens_per_second": tok_per_sec,
            "inference_time_seconds": round(gen_duration, 3),
            "peak_vram_mb": peak_vram_mb,
        }


class TaskExecutor:
    """
    Executes claimed tasks on the worker using registered task handlers or the
    real local inference engine while reporting step progress and uploading
    artifacts to R2.
    """

    def __init__(
        self,
        client: WorkerApiClient,
        hardware: Dict[str, Any],
        custom_handler: Optional[Callable[[Dict[str, Any], WorkerApiClient], Dict[str, Any]]] = None,
    ) -> None:
        self.client = client
        self.hardware = hardware
        self.custom_handler = custom_handler
        self.inference_engine = LocalInferenceEngine(hardware)
        self._handlers: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {}

    def register_handler(
        self, task_type: str, handler: Callable[[Dict[str, Any]], Dict[str, Any]]
    ) -> None:
        self._handlers[task_type] = handler

    def _run_hardware_diagnostic(self, task: Dict[str, Any]) -> Dict[str, Any]:
        """Run a genuine PyTorch tensor compute check on local GPU/CPU hardware."""
        task_id = task["id"]
        input_payload = task.get("input_payload") or {}
        require_gpu = bool(input_payload.get("require_gpu", False))
        matrix_dim = int(input_payload.get("matrix_dim", 512))
        if matrix_dim < 16 or matrix_dim > 8192:
            raise ValueError("matrix_dim must be between 16 and 8192")

        try:
            import torch
        except ImportError as exc:
            raise RuntimeError("hardware_diagnostic requires PyTorch ('torch') to be installed") from exc

        cuda_ready = torch.cuda.is_available()
        if require_gpu and not cuda_ready:
            raise RuntimeError("hardware_diagnostic requested require_gpu=True but CUDA is unavailable")

        device = torch.device("cuda:0" if cuda_ready else "cpu")
        self.client.update_progress(
            task_id,
            1,
            "Verify Local PyTorch Tensor Compute",
            "running",
            f"Executing {matrix_dim}x{matrix_dim} FP32 matmul verification on device '{device}'...",
            40,
        )

        t0 = time.monotonic()
        torch.manual_seed(42)
        a = torch.randn((matrix_dim, matrix_dim), device=device, dtype=torch.float32)
        b = torch.randn((matrix_dim, matrix_dim), device=device, dtype=torch.float32)
        c = torch.matmul(a, b)
        if cuda_ready:
            torch.cuda.synchronize()
        elapsed = max(time.monotonic() - t0, 1e-6)

        flops = 2.0 * (matrix_dim ** 3)
        gflops = round((flops / elapsed) / 1e9, 2)
        checksum = float(c.sum().item())

        return {
            "status": "success",
            "task_type": "hardware_diagnostic",
            "executed_by": self.client.worker_id,
            "device": str(device),
            "cuda_available": cuda_ready,
            "gpu_count": torch.cuda.device_count() if cuda_ready else 0,
            "matrix_dim": matrix_dim,
            "gflops": gflops,
            "tensor_checksum": round(checksum, 6),
            "duration_seconds": round(elapsed, 4),
            "telemetry": get_telemetry(),
        }

    def execute_task(self, task: Dict[str, Any]) -> None:
        task_id = task["id"]
        title = task.get("title", "Distributed Task")
        input_payload = task.get("input_payload") or {}
        worker_id = self.client.worker_id
        logger.info(f"Executing claimed task '{task_id}': {title}")

        start_ts = time.monotonic()

        # Optional custom callable injected by harness / tests
        if self.custom_handler is not None:
            result_payload = self.custom_handler(task, self.client)
            self.client.complete_task(task_id, result_payload)
            logger.info(f"Completed task '{task_id}' via configured handler.")
            return

        task_type = str(input_payload.get("task_type") or "").strip().lower()
        if task_type and task_type in self._handlers:
            result_payload = self._handlers[task_type](task)
            self.client.complete_task(task_id, result_payload)
            logger.info(f"Completed task '{task_id}' via handler '{task_type}'.")
            return

        if task_type == "hardware_diagnostic":
            result_payload = self._run_hardware_diagnostic(task)
            self.client.complete_task(task_id, result_payload)
            logger.info(f"Completed hardware diagnostic task '{task_id}'.")
            return

        # Standard local LLM inference workflow
        requested_model = input_payload.get("model") or task.get("model") or "qwen-2.5-coder-14b"
        requested_precision = input_payload.get("precision")
        require_gpu = bool(input_payload.get("require_gpu", True))
        spec = self.inference_engine.resolve_model_spec(requested_model, requested_precision)

        # Step 1: Preflight check & download any referenced input files from R2
        self.client.update_progress(
            task_id,
            1,
            "Preflight Hardware Check & Input Context",
            "downloading",
            f"Worker {worker_id} verifying model '{spec['weights_source']}' ({spec['precision']})...",
            10,
        )
        self.inference_engine.check_inference_prerequisites(spec, require_gpu=require_gpu)

        context_sections: List[str] = []
        input_keys = input_payload.get("input_file_keys")
        if isinstance(input_keys, list) and input_keys:
            for key in input_keys[:8]:
                raw_bytes = self.client.download_file(str(key))
                text_snippet = redact_secrets(
                    raw_bytes.decode("utf-8", errors="replace"),
                    self.client._active_secrets(),
                )
                context_sections.append(f"--- Input File: {key} ---\n{text_snippet[:12000]}")

        # Step 2: Load model weights into local GPU VRAM
        self.client.update_progress(
            task_id,
            2,
            "Load Model Weights into Local VRAM",
            "loading_model",
            f"Initializing '{spec['weights_source']}' ({spec['precision']}) across local GPUs...",
            25,
        )
        load_seconds = self.inference_engine.ensure_model_loaded(
            spec,
            progress_cb=lambda msg: self.client.update_progress(
                task_id, 2, "Load Model Weights into Local VRAM", "loading_model", msg, 40
            ),
        )

        # Step 3: Build prompt & stream real token generation
        prompt_text = str(
            input_payload.get("prompt")
            or input_payload.get("instruction")
            or task.get("description")
            or title
        )
        if context_sections:
            prompt_text = f"{prompt_text}\n\n" + "\n\n".join(context_sections)

        system_prompt = input_payload.get("system_instructions") or (
            "You are an autonomous AI engineer running on dedicated distributed GPU compute. "
            "Produce accurate, directly verifiable technical output."
        )
        max_new_tokens = int(input_payload.get("max_tokens", 512))
        temperature = float(input_payload.get("temperature", 0.2))

        self.client.update_progress(
            task_id,
            3,
            "Execute Local Tensor Inference",
            "running",
            f"Streaming tokens from '{spec['weights_source']}' on local GPU...",
            50,
        )

        def on_stream_chunk(chunk_idx: int, partial_text: str) -> None:
            pct = min(89, 50 + int(chunk_idx / max(max_new_tokens, 1) * 39))
            self.client.update_progress(
                task_id,
                3,
                "Execute Local Tensor Inference",
                "running",
                f"Generated ~{chunk_idx} chunks ({len(partial_text)} chars)...",
                pct,
            )

        gen_stats = self.inference_engine.generate_text(
            prompt=prompt_text,
            system_prompt=system_prompt,
            max_new_tokens=max_new_tokens,
            temperature=temperature,
            stream_cb=on_stream_chunk,
        )

        # Step 4: Persist verified output artifact to Cloudflare R2
        self.client.update_progress(
            task_id,
            4,
            "Upload Output Artifact to Cloudflare R2",
            "uploading",
            f"Uploading generation artifact ({gen_stats['generated_tokens']} tokens, "
            f"{gen_stats['tokens_per_second']} tok/s)...",
            92,
        )

        artifact_body = json.dumps(
            {
                "task_id": task_id,
                "title": title,
                "worker_id": worker_id,
                "model": spec["weights_source"],
                "precision": spec["precision"],
                "output_text": gen_stats["output_text"],
                "metrics": {
                    "prompt_tokens": gen_stats["prompt_tokens"],
                    "generated_tokens": gen_stats["generated_tokens"],
                    "tokens_per_second": gen_stats["tokens_per_second"],
                    "load_time_seconds": load_seconds,
                    "inference_time_seconds": gen_stats["inference_time_seconds"],
                    "peak_vram_mb": gen_stats["peak_vram_mb"],
                },
            },
            indent=2,
        ).encode("utf-8")

        uploaded_file = self.client.upload_artifact(
            task_id,
            f"result_{task_id}.json",
            artifact_body,
            content_type="application/json",
        )

        total_elapsed = round(time.monotonic() - start_ts, 3)
        result_payload = {
            "status": "success",
            "executed_by": worker_id,
            "model": spec["weights_source"],
            "precision": spec["precision"],
            "summary": gen_stats["output_text"],
            "artifact_r2_key": uploaded_file["key"],
            "metrics": {
                "duration_seconds": total_elapsed,
                "load_time_seconds": load_seconds,
                "inference_time_seconds": gen_stats["inference_time_seconds"],
                "prompt_tokens": gen_stats["prompt_tokens"],
                "generated_tokens": gen_stats["generated_tokens"],
                "tokens_per_second": gen_stats["tokens_per_second"],
                "peak_vram_mb": gen_stats["peak_vram_mb"],
            },
        }

        self.client.complete_task(task_id, result_payload)
        logger.info(
            f"Task '{task_id}' completed in {total_elapsed}s "
            f"({gen_stats['tokens_per_second']} tok/s, R2 key: {uploaded_file['key']})"
        )


def run_worker(
    *,
    platform_url: Optional[str] = None,
    worker_id: Optional[str] = None,
    worker_key: Optional[str] = None,
    registration_token: Optional[str] = None,
    poll_interval: Optional[int] = None,
    max_iterations: Optional[int] = None,
    custom_task_handler: Optional[Callable[[Dict[str, Any], WorkerApiClient], Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Main worker lifecycle runner:
    1. Detect local GPU/CPU hardware.
    2. Authenticate with existing credentials or register strictly (no fake fallback).
    3. Poll for tasks with periodic heartbeats and keepalive lease renewal.
    4. Execute claimed tasks or report real failures to /api/workers/tasks/:id/fail.
    5. Gracefully shut down on SIGINT/SIGTERM/exit, releasing any in-flight task.
    """
    resolved_url = (
        platform_url
        or os.environ.get("AETHER_PLATFORM_URL")
        or DEFAULT_PLATFORM_URL
    )
    resolved_wid = worker_id if worker_id is not None else os.environ.get("AETHER_WORKER_ID")
    resolved_key = worker_key if worker_key is not None else os.environ.get("AETHER_WORKER_KEY")
    resolved_reg = (
        registration_token
        if registration_token is not None
        else os.environ.get("AETHER_REGISTRATION_TOKEN")
    )
    interval = (
        int(poll_interval)
        if poll_interval is not None
        else int(os.environ.get("AETHER_POLL_INTERVAL", "15"))
    )

    hardware = detect_hardware()
    logger.info(
        f"Hardware detected: {hardware['gpu_count']}x {hardware['gpu_model']} | "
        f"VRAM: {hardware['vram_mb']} MB | RAM: {hardware['system_ram_mb']} MB | "
        f"Provider: {hardware['provider']}"
    )

    client = WorkerApiClient(
        resolved_url,
        worker_id=resolved_wid,
        worker_key=resolved_key,
        registration_token=resolved_reg,
    )

    assigned_id = client.ensure_authenticated(hardware)
    executor = TaskExecutor(client, hardware, custom_handler=custom_task_handler)

    stop_event = threading.Event()
    in_main_thread = threading.current_thread() is threading.main_thread()
    prev_sigint = None
    prev_sigterm = None

    def _handle_stop(signum: int, _frame: Any) -> None:
        logger.info(f"Received signal {signum}; initiating graceful worker shutdown...")
        stop_event.set()

    if in_main_thread:
        prev_sigint = signal.signal(signal.SIGINT, _handle_stop)
        prev_sigterm = signal.signal(signal.SIGTERM, _handle_stop)

    # Background heartbeat keepalive thread so leases never expire during long model loads
    start_time = time.monotonic()

    def _keepalive_loop() -> None:
        while not stop_event.wait(timeout=max(interval, 15)):
            try:
                client.send_heartbeat(
                    status="online",
                    uptime_seconds=int(time.monotonic() - start_time),
                )
            except Exception as exc:
                logger.warning(f"Background keepalive heartbeat failed: {exc}")

    keepalive = threading.Thread(target=_keepalive_loop, daemon=True)
    keepalive.start()

    tasks_completed = 0
    tasks_failed = 0
    iterations = 0

    try:
        logger.info(f"Worker '{assigned_id}' polling '{client.platform_url}' (interval: {interval}s)")
        while not stop_event.is_set():
            if max_iterations is not None and iterations >= max_iterations:
                break
            iterations += 1

            uptime = int(time.monotonic() - start_time)
            client.send_heartbeat(status="online", uptime_seconds=uptime)

            task = client.claim_task()
            if task:
                try:
                    executor.execute_task(task)
                    tasks_completed += 1
                except Exception as exc:
                    tasks_failed += 1
                    logger.error(f"Task '{task['id']}' execution failed: {exc}")
                    try:
                        client.fail_task(task["id"], str(exc))
                    except Exception as fail_exc:
                        logger.error(f"Failed to report task failure to platform: {fail_exc}")
                continue

            if max_iterations is not None and iterations >= max_iterations:
                break

            stop_event.wait(timeout=interval)
    finally:
        stop_event.set()
        if in_main_thread:
            if prev_sigint is not None:
                signal.signal(signal.SIGINT, prev_sigint)
            if prev_sigterm is not None:
                signal.signal(signal.SIGTERM, prev_sigterm)
        client.shutdown(uptime_seconds=int(time.monotonic() - start_time))

    return {
        "worker_id": assigned_id,
        "iterations": iterations,
        "tasks_completed": tasks_completed,
        "tasks_failed": tasks_failed,
    }


def main() -> None:
    try:
        run_worker()
    except Exception as exc:
        logger.error(f"Worker halted with error: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
