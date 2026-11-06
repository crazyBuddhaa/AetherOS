-- Migration 0006: Register Web Intelligence Agent & Model Capability
PRAGMA defer_foreign_keys = ON;

-- 1. Register Web Intelligence Tooling and Agent
INSERT OR IGNORE INTO agents (
    id, name, description, model, system_instructions, temperature, max_tokens, permitted_tools, is_enabled, avatar_color, created_by
) VALUES
    (
        'agent_web_intelligence',
        'AetherEye (Web Intelligence & OSINT Specialist)',
        'Autonomous real-world website and domain reconnaissance: HTTP content analysis, metadata/SEO auditing, technology fingerprinting, DNS/DoH intelligence, TLS/SSL inspection, passive security posture analysis, and evidence-based synthesis.',
        'qwen-2.5-coder-14b',
        'You are AetherEye, the principal Web Intelligence Agent for AetherOS. Your mission is to perform thorough, evidence-based reconnaissance on target websites and domains. Always cite verified findings from actual HTTP responses, DNS records, and TLS certificates. Never invent contact details, security vulnerabilities, or statistics. Distinguish verified findings from unverified indicators and formulate actionable technical intelligence.',
        0.2,
        8192,
        '[{"id":"tool_web_fetcher","name":"web_fetcher","description":"Retrieve and parse live website content, metadata, sitemaps, robots.txt, and link structures with SSRF protection","category":"retrieval","requires_approval":false,"risk_level":"low"},{"id":"tool_domain_intel","name":"domain_intelligence","description":"Query DNS records (A, AAAA, MX, TXT, NS, CAA) via Cloudflare DoH and inspect nameservers and infrastructure","category":"network","requires_approval":false,"risk_level":"low"},{"id":"tool_security_inspection","name":"passive_security_inspection","description":"Audit HTTP security headers, TLS posture, cookie security attributes, and common web misconfigurations","category":"network","requires_approval":false,"risk_level":"low"},{"id":"tool_tech_fingerprint","name":"technology_fingerprinting","description":"Fingerprint web frameworks, CMSs, CDN providers, analytics, and server headers from response signatures","category":"retrieval","requires_approval":false,"risk_level":"low"},{"id":"tool_r2_report_archiver","name":"r2_report_archiver","description":"Archive raw extracted HTML, structured JSON findings, and markdown intelligence reports directly to Cloudflare R2","category":"filesystem","requires_approval":false,"risk_level":"low"}]',
        1,
        '#0284C7',
        'usr_admin'
    );
