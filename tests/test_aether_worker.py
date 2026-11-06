#!/usr/bin/env python3
"""
Unit & Integration Tests for AetherOS Kaggle / Distributed Compute Worker Runtime
(worker-runtime/aether_worker.py & worker-runtime/kaggle_single_cell.py)
"""

from __future__ import annotations

import hashlib
import hmac
import io
import json
import logging
import os
import secrets
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT_DIR = Path(__file__).resolve().parent.parent
WORKER_RUNTIME_DIR = ROOT_DIR / "worker-runtime"
if str(WORKER_RUNTIME_DIR) not in sys.path:
    sys.path.insert(0, str(WORKER_RUNTIME_DIR))

import aether_worker  # noqa: E402
import kaggle_single_cell  # noqa: E402


class MockControlPlaneState:
    """Thread-safe in-memory control plane enforcing exact security & replay rules."""

    def __init__(self, required_reg_token: Optional[str] = None) -> None:
        self.lock = threading.Lock()
        self.required_reg_token = required_reg_token
        self.workers: Dict[str, Dict[str, Any]] = {}
        self.key_hashes: Dict[str, Tuple[str, str]] = {}  # worker_id -> (salt_hex, hmac_hex)
        self.used_nonces: set[Tuple[str, str]] = set()
        self.tasks: Dict[str, Dict[str, Any]] = {}
        self.artifacts: Dict[str, bytes] = {}
        self.request_audit: List[Dict[str, Any]] = []
        self.pepper = "python_test_pepper_secret"
        self.force_register_error: Optional[int] = None

    def register_worker(self, payload: Dict[str, Any], reg_token: Optional[str]) -> Tuple[int, Dict[str, Any]]:
        with self.lock:
            if self.force_register_error is not None:
                return self.force_register_error, {"error": "Forced registration failure", "success": False}
            if self.required_reg_token:
                if not reg_token or not hmac.compare_digest(reg_token, self.required_reg_token):
                    return 401, {"error": "Invalid registration token", "success": False}
            if not payload.get("gpu_model"):
                return 400, {"error": "Missing gpu_model", "success": False}

            worker_id = f"wrk_{payload.get('provider', 'kaggle')}_{secrets.token_hex(8)}"
            raw_key = f"ak_live_{secrets.token_hex(32)}"
            salt_hex = secrets.token_hex(16)
            digest_hex = hmac.new(
                self.pepper.encode("utf-8"),
                f"{salt_hex}:{raw_key}".encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()

            worker_obj = {
                "id": worker_id,
                "name": payload.get("name", "Test Node"),
                "provider": payload.get("provider", "kaggle"),
                "gpu_model": payload["gpu_model"],
                "gpu_count": payload.get("gpu_count", 0),
                "vram_mb": payload.get("vram_mb", 0),
                "system_ram_mb": payload.get("system_ram_mb", 16384),
                "status": "online",
                "key_prefix": raw_key[:16],
                "current_task_id": None,
                "total_tasks_completed": 0,
            }
            self.workers[worker_id] = worker_obj
            self.key_hashes[worker_id] = (salt_hex, digest_hex)
            return 201, {"success": True, "worker": worker_obj, "api_key": raw_key}

    def authenticate(self, headers: Dict[str, str], declared_wid: Optional[str] = None) -> Tuple[int, Optional[Dict[str, Any]], Optional[str]]:
        auth_hdr = headers.get("authorization", "")
        if not auth_hdr.startswith("Bearer "):
            return 401, None, "Missing Bearer header"
        raw_key = auth_hdr[7:].strip()

        ts_hdr = headers.get("x-worker-timestamp")
        nonce_hdr = headers.get("x-worker-nonce")
        if not ts_hdr or not nonce_hdr:
            return 400, None, "Missing X-Worker-Timestamp or X-Worker-Nonce"
        try:
            ts_ms = int(ts_hdr)
        except ValueError:
            return 400, None, "Invalid timestamp"
        if abs(int(time.time() * 1000) - ts_ms) > 300_000:
            return 401, None, "Timestamp expired"

        matched_worker = None
        for wid, (salt_hex, expected_hex) in self.key_hashes.items():
            actual_hex = hmac.new(
                self.pepper.encode("utf-8"),
                f"{salt_hex}:{raw_key}".encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()
            if hmac.compare_digest(actual_hex, expected_hex):
                matched_worker = self.workers[wid]
                break

        if not matched_worker:
            return 401, None, "Invalid worker API key"

        hdr_wid = headers.get("x-worker-id")
        eff_declared = hdr_wid or declared_wid
        if hdr_wid and declared_wid and hdr_wid != declared_wid:
            return 400, None, "Conflicting X-Worker-Id and payload worker_id"
        if eff_declared and eff_declared != matched_worker["id"]:
            return 403, None, "Cross-worker impersonation denied"

        nonce_key = (matched_worker["id"], nonce_hdr)
        if nonce_key in self.used_nonces:
            return 409, None, "Replay attack detected: duplicate nonce"
        self.used_nonces.add(nonce_key)
        return 200, matched_worker, None


def make_handler(state: MockControlPlaneState):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: Any) -> None:
            return

        def _send_json(self, status: int, body: Dict[str, Any]) -> None:
            raw = json.dumps(body).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def _read_body(self) -> bytes:
            length = int(self.headers.get("Content-Length", "0"))
            return self.rfile.read(length) if length > 0 else b""

        def _lower_headers(self) -> Dict[str, str]:
            return {k.lower(): v for k, v in self.headers.items()}

        def do_GET(self) -> None:
            hdrs = self._lower_headers()
            state.request_audit.append({"method": "GET", "path": self.path, "headers": hdrs})

            if self.path == "/api/health":
                self._send_json(200, {"status": "online", "d1_connected": True, "r2_connected": True})
                return

            if self.path == "/api/workers/me":
                with state.lock:
                    status, worker, err = state.authenticate(hdrs)
                if status != 200 or not worker:
                    self._send_json(status, {"error": err, "success": False})
                    return
                self._send_json(200, {"success": True, "worker": worker})
                return

            self._send_json(404, {"error": "Not found", "success": False})

        def do_POST(self) -> None:
            raw_body = self._read_body()
            hdrs = self._lower_headers()
            state.request_audit.append({"method": "POST", "path": self.path, "headers": hdrs})

            content_type = hdrs.get("content-type", "")
            payload: Dict[str, Any] = {}
            if "application/json" in content_type and raw_body:
                payload = json.loads(raw_body.decode("utf-8"))

            if self.path == "/api/workers/register":
                status, resp = state.register_worker(payload, hdrs.get("x-registration-token"))
                self._send_json(status, resp)
                return

            with state.lock:
                status, worker, err = state.authenticate(hdrs, payload.get("worker_id"))
                if status != 200 or not worker:
                    self._send_json(status, {"error": err, "success": False})
                    return

                wid = worker["id"]

                if self.path == "/api/workers/heartbeat":
                    worker["status"] = payload.get("status") or (
                        "busy" if worker["current_task_id"] else "online"
                    )
                    self._send_json(200, {"success": True, "worker": worker})
                    return

                if self.path == "/api/workers/shutdown":
                    released = None
                    if worker["current_task_id"] and worker["current_task_id"] in state.tasks:
                        t = state.tasks[worker["current_task_id"]]
                        t["status"] = "queued"
                        t["claimed_by_worker"] = None
                        released = t["id"]
                    worker["status"] = "offline"
                    worker["current_task_id"] = None
                    self._send_json(200, {"success": True, "worker_id": wid, "released_task_id": released})
                    return

                if self.path == "/api/workers/tasks/claim":
                    if worker["status"] != "online":
                        self._send_json(403, {"error": "Worker not online", "success": False})
                        return
                    queued = [t for t in state.tasks.values() if t["status"] in ("queued", "pending")]
                    if not queued:
                        self._send_json(200, {"success": True, "task": None})
                        return
                    task = queued[0]
                    task["status"] = "assigned"
                    task["claimed_by_worker"] = wid
                    worker["status"] = "busy"
                    worker["current_task_id"] = task["id"]
                    self._send_json(200, {"success": True, "task": task})
                    return

                if self.path.startswith("/api/workers/tasks/"):
                    parts = self.path.strip("/").split("/")
                    # api / workers / tasks / <id> / <action>
                    if len(parts) == 5:
                        task_id, action = parts[3], parts[4]
                        task = state.tasks.get(task_id)
                        if not task:
                            self._send_json(404, {"error": "Task not found", "success": False})
                            return
                        if task.get("claimed_by_worker") != wid:
                            self._send_json(403, {"error": "Cross-worker access denied", "success": False})
                            return

                        if action == "progress":
                            stage = payload.get("status", "running")
                            allowed_steps = {"pending", "running", "completed", "failed", "skipped", "waiting_approval"}
                            active_stages = {"downloading", "loading_model", "running", "uploading"}
                            if stage not in allowed_steps and stage not in active_stages:
                                self._send_json(400, {"error": f"Invalid task progress status '{stage}'", "success": False})
                                return
                            step_status = "running" if stage in active_stages else stage
                            task["progress_percent"] = payload.get("progress_percent", task.get("progress_percent", 0))
                            if stage in active_stages:
                                task["status"] = stage
                            state.request_audit[-1]["step_status"] = step_status
                            state.request_audit[-1]["task_status"] = task["status"]
                            self._send_json(
                                200,
                                {
                                    "success": True,
                                    "step_status": step_status,
                                    "task_status": task["status"],
                                },
                            )
                            return

                        if action == "artifacts":
                            art_key = f"tasks/{task_id}/artifact_{len(state.artifacts) + 1}.bin"
                            state.artifacts[art_key] = raw_body
                            self._send_json(
                                201,
                                {
                                    "success": True,
                                    "file": {
                                        "key": art_key,
                                        "filename": "output.json",
                                        "size": len(raw_body),
                                    },
                                },
                            )
                            return

                        if action == "result":
                            task["status"] = "completed"
                            task["progress_percent"] = 100
                            task["result_payload"] = payload.get("result_payload", {})
                            worker["status"] = "online"
                            worker["current_task_id"] = None
                            worker["total_tasks_completed"] += 1
                            self._send_json(200, {"success": True})
                            return

                        if action == "fail":
                            task["status"] = "failed"
                            task["error_message"] = payload.get("error_message", "Failed")
                            worker["status"] = "online"
                            worker["current_task_id"] = None
                            self._send_json(200, {"success": True})
                            return

            self._send_json(404, {"error": "Unknown endpoint", "success": False})

    return Handler


class WorkerRuntimeTestSuite(unittest.TestCase):
    def setUp(self) -> None:
        self.state = MockControlPlaneState()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.state))
        self.port = self.server.server_address[1]
        self.base_url = f"http://127.0.0.1:{self.port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

        self.log_stream = io.StringIO()
        self.log_handler = logging.StreamHandler(self.log_stream)
        self.log_handler.setFormatter(logging.Formatter("%(levelname)s %(message)s"))
        aether_worker.logger.addHandler(self.log_handler)

    def tearDown(self) -> None:
        aether_worker.logger.removeHandler(self.log_handler)
        self.log_handler.close()
        self.server.shutdown()
        self.server.server_close()

    def test_strict_registration_no_fake_fallbacks(self) -> None:
        self.state.force_register_error = 500
        with self.assertRaises(RuntimeError) as ctx:
            aether_worker.run_worker(platform_url=self.base_url, poll_interval=1, max_iterations=1)
        self.assertIn("500", str(ctx.exception))
        self.assertEqual(len(self.state.workers), 0)

        # Partial credentials (worker_id without worker_key) must fail explicitly
        self.state.force_register_error = None
        client = aether_worker.WorkerApiClient(self.base_url, worker_id="wrk_partial", worker_key="")
        with self.assertRaises(RuntimeError):
            client.ensure_authenticated(aether_worker.detect_hardware())

        # Remote non-HTTPS platform URL must be rejected
        with self.assertRaises(ValueError):
            aether_worker.validate_platform_url("http://untrusted-remote-host.example.com")

    def test_full_lifecycle_secret_redaction_and_replay_headers(self) -> None:
        self.state.required_reg_token = "reg_secret_test_value_999"
        self.state.tasks["tsk_test_01"] = {
            "id": "tsk_test_01",
            "title": "Compute Checksum Task",
            "description": "Compute real SHA-256 verification",
            "input_payload": {"mode": "verify"},
            "status": "queued",
            "progress_percent": 0,
        }

        def custom_executor(task: Dict[str, Any], client: aether_worker.WorkerApiClient) -> Dict[str, Any]:
            for step_idx, (stage, pct) in enumerate(
                [("downloading", 15), ("loading_model", 35), ("running", 60), ("uploading", 90)],
                start=1,
            ):
                client.update_progress(
                    task["id"],
                    step_idx,
                    f"Stage {stage}",
                    stage,
                    logs=f"Computed {stage} payload without exposing credentials",
                    progress_percent=pct,
                )
            art = client.upload_artifact(
                task["id"],
                "output.json",
                b'{"verified": true}',
                content_type="application/json",
            )
            return {
                "status": "success",
                "executed_by": client.worker_id,
                "artifact_r2_key": art["key"],
            }

        summary = aether_worker.run_worker(
            platform_url=self.base_url,
            registration_token="reg_secret_test_value_999",
            poll_interval=1,
            max_iterations=2,
            custom_task_handler=custom_executor,
        )

        self.assertEqual(summary["tasks_completed"], 1)
        self.assertEqual(summary["tasks_failed"], 0)

        wid = summary["worker_id"]
        self.assertEqual(self.state.workers[wid]["status"], "offline")
        self.assertEqual(self.state.workers[wid]["total_tasks_completed"], 1)
        self.assertEqual(self.state.tasks["tsk_test_01"]["status"], "completed")
        self.assertEqual(self.state.tasks["tsk_test_01"]["progress_percent"], 100)
        self.assertEqual(len(self.state.artifacts), 1)

        # Verify zero secret leakage in logs
        logs_output = self.log_stream.getvalue()
        self.assertNotIn("ak_live_", logs_output)
        self.assertNotIn("reg_secret_test_value_999", logs_output)

        # Verify multi-stage progress normalization and preserved task statuses
        progress_reqs = [
            r for r in self.state.request_audit if r["path"].endswith("/progress")
        ]
        self.assertEqual(len(progress_reqs), 4)
        self.assertEqual(
            [r["task_status"] for r in progress_reqs],
            ["downloading", "loading_model", "running", "uploading"],
        )
        self.assertTrue(all(r["step_status"] == "running" for r in progress_reqs))

        # Verify every authenticated request carried Bearer auth + unique replay nonces
        auth_reqs = [r for r in self.state.request_audit if r["path"] != "/api/workers/register"]
        self.assertGreaterEqual(len(auth_reqs), 9)
        seen_nonces = set()
        for req in auth_reqs:
            hdrs = req["headers"]
            self.assertTrue(hdrs.get("authorization", "").startswith("Bearer ak_live_"))
            self.assertEqual(hdrs.get("x-worker-id"), wid)
            self.assertIn("x-worker-timestamp", hdrs)
            nonce = hdrs.get("x-worker-nonce")
            self.assertIsNotNone(nonce)
            self.assertNotIn(nonce, seen_nonces)
            seen_nonces.add(nonce)

    def test_failure_reporting_on_unmet_inference_or_execution_error(self) -> None:
        # Enqueue an LLM task without custom handler; when ML libs or CUDA GPU are missing,
        # the worker must NOT sleep/simulate success — it must fail truthfully and call /fail.
        self.state.tasks["tsk_fail_01"] = {
            "id": "tsk_fail_01",
            "title": "Run Qwen 2.5 Coder 14B Inference",
            "input_payload": {"model": "qwen-2.5-coder-14b", "prompt": "SELECT 1;", "require_gpu": True},
            "status": "queued",
            "progress_percent": 0,
        }

        summary = aether_worker.run_worker(
            platform_url=self.base_url,
            poll_interval=1,
            max_iterations=2,
        )

        self.assertEqual(summary["tasks_completed"], 0)
        self.assertEqual(summary["tasks_failed"], 1)
        task_state = self.state.tasks["tsk_fail_01"]
        self.assertEqual(task_state["status"], "failed")
        self.assertTrue(bool(task_state.get("error_message")))
        self.assertNotIn("ak_live_", task_state.get("error_message", ""))

        # Worker remains healthy (offline after run_worker finishes) and not stuck in 'busy'
        wid = summary["worker_id"]
        self.assertIsNone(self.state.workers[wid]["current_task_id"])
        self.assertEqual(self.state.workers[wid]["status"], "offline")

    def test_kaggle_single_cell_delegates_to_canonical_worker(self) -> None:
        resolved = kaggle_single_cell.resolve_worker_runtime_dir()
        self.assertEqual(resolved.resolve(), WORKER_RUNTIME_DIR.resolve())


if __name__ == "__main__":
    unittest.main()
