-- Migration 0002: Distributed Multimodal Compute Grid & Model Registry for AetherOS on Cloudflare D1

-- 1. Compute Workers Table (Self-Hosted & Contributor GPU Nodes)
CREATE TABLE IF NOT EXISTS compute_workers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'kaggle' CHECK(provider IN ('kaggle', 'oracle', 'runpod', 'self_hosted', 'custom')),
    gpu_model TEXT NOT NULL,
    gpu_count INTEGER NOT NULL DEFAULT 1,
    vram_mb INTEGER NOT NULL DEFAULT 0,
    system_ram_mb INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'offline' CHECK(status IN ('online', 'busy', 'offline', 'maintenance')),
    api_key_hash TEXT NOT NULL,
    contributor_name TEXT DEFAULT 'Anonymous',
    contributor_email TEXT,
    current_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    last_heartbeat TIMESTAMP,
    uptime_seconds INTEGER DEFAULT 0,
    total_tasks_completed INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Model Registry Table (Multimodal Model Definitions & Requirements)
CREATE TABLE IF NOT EXISTS model_registry (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('text', 'image', 'video', 'image_processing', 'audio')),
    min_vram_mb INTEGER NOT NULL,
    supported_precisions TEXT NOT NULL DEFAULT '["fp16"]',
    weights_source TEXT NOT NULL,
    description TEXT,
    execution_constraints TEXT DEFAULT '{}',
    is_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Worker Metrics Telemetry Table
CREATE TABLE IF NOT EXISTS worker_metrics (
    id TEXT PRIMARY KEY,
    worker_id TEXT NOT NULL REFERENCES compute_workers(id) ON DELETE CASCADE,
    gpu_utilization_percent REAL DEFAULT 0,
    gpu_memory_used_mb INTEGER DEFAULT 0,
    gpu_temperature_c REAL DEFAULT 0,
    recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient scheduling & heartbeat leasing
CREATE INDEX IF NOT EXISTS idx_workers_status ON compute_workers(status, last_heartbeat DESC);
CREATE INDEX IF NOT EXISTS idx_workers_provider ON compute_workers(provider);
CREATE INDEX IF NOT EXISTS idx_model_registry_category ON model_registry(category, is_enabled);
CREATE INDEX IF NOT EXISTS idx_worker_metrics_worker ON worker_metrics(worker_id, recorded_at DESC);

-- Seed Models into Registry
INSERT OR IGNORE INTO model_registry (id, name, category, min_vram_mb, supported_precisions, weights_source, description)
VALUES 
    ('qwen-2.5-coder-14b', 'Qwen 2.5 Coder 14B', 'text', 14336, '["fp16", "int4", "awq"]', 'Qwen/Qwen2.5-Coder-14B-Instruct', 'Premier open coding & reasoning model. Optimized for tensor-parallel on dual T4.'),
    ('deepseek-r1-distill-qwen-14b', 'DeepSeek R1 Distill 14B', 'text', 15360, '["fp16", "int4", "gptq"]', 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B', 'High-throughput reasoning model with deep chain-of-thought distillation.'),
    ('sd-1.5-standard', 'Stable Diffusion 1.5', 'image', 6144, '["fp16"]', 'runwayml/stable-diffusion-v1-5', 'Fast text-to-image synthesis (~2.5s generation per step on T4).'),
    ('sdxl-lightning', 'SDXL Lightning 4-Step', 'image', 10240, '["fp16"]', 'ByteDance/SDXL-Lightning', 'Photorealistic high-resolution 1024x1024 generation in 4 inference steps.'),
    ('real-esrgan-4x', 'Real-ESRGAN 4x+ Upscaler', 'image_processing', 4096, '["fp16"]', 'xinntao/Real-ESRGAN', 'High-fidelity spatial super-resolution upscaler.'),
    ('birefnet-bg-removal', 'BiRefNet Background Removal', 'image_processing', 4096, '["fp16"]', 'ZhengPeng7/BiRefNet', 'Ultra-clean background extraction for multimodal agent workflows.'),
    ('animatediff-motion-v3', 'AnimateDiff Motion Module v3', 'video', 12288, '["fp16"]', 'guoyww/animatediff-motion-adapter-v1-5-3', 'Short video synthesis from text prompt (16-32 frames at 512x512).'),
    ('whisper-large-v3-turbo', 'Whisper Large v3 Turbo', 'audio', 4096, '["fp16"]', 'openai/whisper-large-v3-turbo', 'Fast multilingual speech-to-text transcription engine.');

-- Seed Baseline Workers
INSERT OR IGNORE INTO compute_workers (id, name, provider, gpu_model, gpu_count, vram_mb, system_ram_mb, status, api_key_hash, contributor_name, uptime_seconds, total_tasks_completed, last_heartbeat)
VALUES 
    ('worker_admin_kaggle_01', 'Admin Kaggle T4x2 Cluster', 'kaggle', 'NVIDIA Tesla T4', 2, 30720, 32768, 'online', '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', 'Alex Vance (Lead Architect)', 14200, 48, CURRENT_TIMESTAMP),
    ('worker_community_t4_02', 'Community Contributor Node 02', 'kaggle', 'NVIDIA Tesla T4', 2, 30720, 32768, 'online', '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8', 'Community Node #042', 8400, 22, CURRENT_TIMESTAMP);
