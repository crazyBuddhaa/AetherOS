/**
 * AetherOS Defensive Cybersecurity Assessment Engine (Phase 10)
 *
 * Strictly defensive, read-only, non-destructive security analysis:
 * 1. Website & HTTP Security-Header Analysis
 * 2. TLS & Transport Posture Verification
 * 3. DNS Security Record Checks (SPF, DMARC, CAA via Cloudflare DoH)
 * 4. Dependency Vulnerability & Supply-Chain Assessment
 * 5. Static Source-Code Security Analysis
 * 6. Configuration Auditing
 * 7. Structured Vulnerability Reporting, Risk Prioritization & Remediation
 *
 * Safety & Authorization Guarantees:
 * - Requires explicit operator authorization (`authorization_confirmed: true`) for any target assessment.
 * - Enforces SSRF protection against private, loopback, and cloud metadata IP ranges.
 * - Never performs exploit attempts, brute-force, or destructive requests.
 * - Clearly separates `verified_finding` from `unverified_indicator`.
 */

import { generateSecureId, redactSecrets } from './auth.ts';

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingConfidence = 'verified_finding' | 'unverified_indicator';

export interface SecurityFinding {
  id: string;
  category:
    | 'http_headers'
    | 'tls_transport'
    | 'dns_security'
    | 'dependency_audit'
    | 'dependencies'
    | 'source_code'
    | 'configuration';
  title: string;
  severity: SecuritySeverity;
  confidence: FindingConfidence;
  classification?: FindingConfidence;
  cvss_estimate: number;
  cwe_id?: string;
  affected_component: string;
  evidence: string;
  impact: string;
  remediation: string;
}

export interface DefensiveSecurityAssessmentInput {
  scope?: string;
  target_url?: string;
  domain?: string;
  response_headers?: Record<string, string>;
  package_json?: string | Record<string, any>;
  package_json_content?: string | Record<string, any>;
  source_code?: string;
  source_filename?: string;
  config_content?: string;
  config_filename?: string;
  authorization_confirmed: boolean;
  authorized_scope_note?: string;
  allow_localhost_for_test?: boolean;
}

export interface DefensiveSecurityAssessmentReport {
  report_id: string;
  assessed_at: string;
  scope: string;
  target: string;
  authorization_verified: boolean;
  authorized_scope_note: string;
  target_summary: {
    target_url?: string;
    domain?: string;
    source_filename?: string;
    config_filename?: string;
    modules_executed: string[];
  };
  overall_risk_level: SecuritySeverity;
  security_score: number; // 0 to 100
  summary: {
    total_findings: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    verified_findings: number;
    unverified_indicators: number;
    overall_risk_score: number;
  };
  counts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    verified_findings: number;
    unverified_indicators: number;
  };
  findings: SecurityFinding[];
  prioritized_remediation_plan: Array<{
    priority_rank: number;
    finding_id: string;
    title: string;
    severity: SecuritySeverity;
    confidence: FindingConfidence;
    recommended_action: string;
  }>;
  markdown_report: string;
}

/**
 * Validate that a target URL is safe to inspect (SSRF protection).
 */
export function validateSafeTargetUrl(
  rawUrl: string,
  allowLocalhost = false
): { ok: true; url: URL } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { ok: false, error: `Invalid target URL '${rawUrl}'` };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: `Unsupported URL scheme '${parsed.protocol}'; only https: and http: are allowed` };
  }

  const host = parsed.hostname.toLowerCase();

  // Always block cloud metadata endpoints
  if (
    host === '169.254.169.254' ||
    host === 'metadata.google.internal' ||
    host === '100.100.100.200' ||
    host.endsWith('.internal')
  ) {
    return {
      ok: false,
      error: `Refusing to scan cloud metadata or internal host '${host}' (SSRF protection)`,
    };
  }

  if (!allowLocalhost) {
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return {
        ok: false,
        error: `Refusing to scan private or loopback address '${host}' without local test override`,
      };
    }
  }

  return { ok: true, url: parsed };
}

/**
 * 1 & 2. HTTP Security-Header & TLS Configuration Analysis
 */
export function analyzeHttpHeadersAndTls(
  targetUrl: string,
  rawHeaders: Record<string, string>
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawHeaders || {})) {
    headers[k.toLowerCase().trim()] = String(v || '').trim();
  }

  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    parsedUrl = null;
  }

  // TLS / HTTPS transport check
  if (parsedUrl && parsedUrl.protocol === 'http:') {
    findings.push({
      id: generateSecureId('fnd', 6),
      category: 'tls_transport',
      title: 'Unencrypted HTTP Transport Scheme Detected',
      severity: 'high',
      confidence: 'verified_finding',
      cvss_estimate: 7.4,
      cwe_id: 'CWE-319',
      affected_component: targetUrl,
      evidence: `Target URL uses '${parsedUrl.protocol}' instead of 'https:'`,
      impact: 'Traffic between clients and the endpoint can be intercepted or modified in transit (MITM).',
      remediation: 'Enforce TLS 1.2/1.3 over HTTPS and redirect all HTTP requests (301) to HTTPS.',
    });
  }

  // HSTS check
  const hsts = headers['strict-transport-security'];
  if (!hsts) {
    findings.push({
      id: generateSecureId('fnd', 6),
      category: 'http_headers',
      title: 'Missing Strict-Transport-Security (HSTS) Header',
      severity: 'medium',
      confidence: 'verified_finding',
      cvss_estimate: 5.3,
      cwe_id: 'CWE-523',
      affected_component: targetUrl,
      evidence: 'HTTP response does not include a Strict-Transport-Security header.',
      impact: 'Browsers may allow downgrade attacks (SSL stripping) on initial connections.',
      remediation:
        'Add `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` on all HTTPS responses.',
    });
  } else {
    const maxAgeMatch = hsts.match(/max-age=(\d+)/i);
    const maxAge = maxAgeMatch ? Number(maxAgeMatch[1]) : 0;
    if (maxAge < 15768000) {
      findings.push({
        id: generateSecureId('fnd', 6),
        category: 'tls_transport',
        title: 'Weak HSTS max-age Duration (< 6 Months)',
        severity: 'low',
        confidence: 'verified_finding',
        cvss_estimate: 3.1,
        cwe_id: 'CWE-523',
        affected_component: targetUrl,
        evidence: `Strict-Transport-Security: ${hsts}`,
        impact: 'Short HSTS cache duration leaves infrequent visitors exposed to protocol downgrade.',
        remediation: 'Increase HSTS `max-age` to at least `31536000` (1 year) and include `includeSubDomains`.',
      });
    }
  }

  // Content-Security-Policy check
  const csp = headers['content-security-policy'];
  if (!csp) {
    findings.push({
      id: generateSecureId('fnd', 6),
      category: 'http_headers',
      title: 'Missing Content-Security-Policy (CSP) Header',
      severity: 'medium',
      confidence: 'verified_finding',
      cvss_estimate: 5.4,
      cwe_id: 'CWE-693',
      affected_component: targetUrl,
      evidence: 'HTTP response does not include a Content-Security-Policy header.',
      impact: 'Lack of CSP increases the blast radius of any Cross-Site Scripting (XSS) or data injection flaw.',
      remediation:
        "Define a restrictive `Content-Security-Policy` header (e.g., `default-src 'self'; frame-ancestors 'self'; object-src 'none'`).",
    });
  } else if (csp.includes("'unsafe-eval'")) {
    findings.push({
      id: generateSecureId('fnd', 6),
      category: 'http_headers',
      title: "Permissive CSP Allows 'unsafe-eval'",
      severity: 'medium',
      confidence: 'verified_finding',
      cvss_estimate: 5.0,
      cwe_id: 'CWE-693',
      affected_component: targetUrl,
      evidence: `Content-Security-Policy contains 'unsafe-eval': ${csp.slice(0, 140)}`,
      impact: "Allows dynamic code evaluation via eval() or Function(), weakening XSS mitigation.",
      remediation: "Remove `'unsafe-eval'` from script-src directives and refactor dynamic code evaluation.",
    });
  }

  // X-Content-Type-Options check
  const xcto = headers['x-content-type-options'];
  if (!xcto || xcto.toLowerCase() !== 'nosniff') {
    findings.push({
      id: generateSecureId('fnd', 6),
      category: 'http_headers',
      title: 'Missing X-Content-Type-Options: nosniff Header',
      severity: 'low',
      confidence: 'verified_finding',
      cvss_estimate: 3.7,
      cwe_id: 'CWE-16',
      affected_component: targetUrl,
      evidence: `X-Content-Type-Options: ${xcto || '(absent)'}`,
      impact: 'Browsers may MIME-sniff responses away from declared Content-Type, enabling script execution in uploaded files.',
      remediation: 'Set `X-Content-Type-Options: nosniff` on all HTTP responses.',
    });
  }

  // Clickjacking protection (X-Frame-Options or CSP frame-ancestors)
  const xfo = headers['x-frame-options'];
  const hasFrameAncestors = Boolean(csp && /frame-ancestors/i.test(csp));
  if (!xfo && !hasFrameAncestors) {
    findings.push({
      id: generateSecureId('fnd', 6),
      category: 'http_headers',
      title: 'Missing Clickjacking Protection (X-Frame-Options / frame-ancestors)',
      severity: 'low',
      confidence: 'verified_finding',
      cvss_estimate: 4.3,
      cwe_id: 'CWE-1021',
      affected_component: targetUrl,
      evidence: 'Neither X-Frame-Options nor CSP frame-ancestors directive was present.',
      impact: 'Pages may be embedded in cross-origin iframes for UI redressing (Clickjacking).',
      remediation: "Set `X-Frame-Options: SAMEORIGIN` (or `DENY`) and CSP `frame-ancestors 'self'`.",
    });
  }

  // Referrer-Policy check
  const refPol = headers['referrer-policy'];
  if (!refPol) {
    findings.push({
      id: generateSecureId('fnd', 6),
      category: 'http_headers',
      title: 'Missing Referrer-Policy Header',
      severity: 'info',
      confidence: 'verified_finding',
      cvss_estimate: 2.0,
      cwe_id: 'CWE-200',
      affected_component: targetUrl,
      evidence: 'Referrer-Policy header is absent.',
      impact: 'Full URL paths and query parameters may be leaked to external origins via the Referer header.',
      remediation: 'Add `Referrer-Policy: strict-origin-when-cross-origin`.',
    });
  }

  // CORS wildcard with credentials check
  const acao = headers['access-control-allow-origin'];
  const acac = headers['access-control-allow-credentials'];
  if (acao === '*' && acac && acac.toLowerCase() === 'true') {
    findings.push({
      id: generateSecureId('fnd', 6),
      category: 'http_headers',
      title: 'Misconfigured CORS Wildcard with Credentials Enabled',
      severity: 'high',
      confidence: 'verified_finding',
      cvss_estimate: 7.5,
      cwe_id: 'CWE-942',
      affected_component: targetUrl,
      evidence: `Access-Control-Allow-Origin: *, Access-Control-Allow-Credentials: ${acac}`,
      impact: 'Signals overly broad cross-origin access configuration.',
      remediation: 'Restrict Access-Control-Allow-Origin to explicit trusted origins when credentials are used.',
    });
  }

  // Cookie security flags check
  const setCookie = headers['set-cookie'];
  if (setCookie) {
    if (!/httponly/i.test(setCookie)) {
      findings.push({
        id: generateSecureId('fnd', 6),
        category: 'http_headers',
        title: 'Session Cookie Missing HttpOnly Flag',
        severity: 'medium',
        confidence: 'verified_finding',
        cvss_estimate: 5.4,
        cwe_id: 'CWE-1004',
        affected_component: targetUrl,
        evidence: `Set-Cookie header lacks HttpOnly attribute`,
        impact: 'Client-side scripts can read the cookie via document.cookie if XSS occurs.',
        remediation: 'Append `; HttpOnly; Secure; SameSite=Lax` to all authentication cookies.',
      });
    }
    if (!/secure/i.test(setCookie) && parsedUrl?.protocol === 'https:') {
      findings.push({
        id: generateSecureId('fnd', 6),
        category: 'http_headers',
        title: 'Cookie Missing Secure Flag on HTTPS Endpoint',
        severity: 'medium',
        confidence: 'verified_finding',
        cvss_estimate: 5.1,
        cwe_id: 'CWE-614',
        affected_component: targetUrl,
        evidence: `Set-Cookie header lacks Secure attribute`,
        impact: 'Cookie could be transmitted over plaintext HTTP connections.',
        remediation: 'Include the `Secure` attribute on all cookies issued over HTTPS.',
      });
    }
  }

  return findings;
}

/**
 * 3. DNS Security Checks (SPF, DMARC, CAA) via Cloudflare DNS-over-HTTPS
 */
export async function analyzeDomainDnsSecurity(
  rawDomain: string,
  fetchFn: typeof fetch = fetch
): Promise<SecurityFinding[]> {
  const cleanDomain = rawDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0];

  if (!cleanDomain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleanDomain)) {
    return [];
  }

  const findings: SecurityFinding[] = [];

  const queryDnsTxt = async (name: string, type = 'TXT'): Promise<string[]> => {
    try {
      const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
      const res = await fetchFn(url, {
        headers: { Accept: 'application/dns-json' },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { Answer?: Array<{ data?: string }> };
      return (data.Answer || []).map((a) => String(a.data || '').replace(/^"|"$/g, ''));
    } catch {
      return [];
    }
  };

  const [txtRecords, dmarcRecords, caaRecords] = await Promise.all([
    queryDnsTxt(cleanDomain, 'TXT'),
    queryDnsTxt(`_dmarc.${cleanDomain}`, 'TXT'),
    queryDnsTxt(cleanDomain, 'CAA'),
  ]);

  const spfRecord = txtRecords.find((r) => r.toLowerCase().includes('v=spf1'));
  if (!spfRecord) {
    findings.push({
      id: generateSecureId('fnd', 6),
      category: 'dns_security',
      title: 'Missing SPF (Sender Policy Framework) DNS Record',
      severity: 'low',
      confidence: 'verified_finding',
      cvss_estimate: 3.5,
      cwe_id: 'CWE-290',
      affected_component: `DNS TXT (${cleanDomain})`,
      evidence: `No TXT record starting with 'v=spf1' found on ${cleanDomain}`,
      impact: 'Unauthorized mail servers may spoof emails appearing to originate from this domain.',
      remediation: `Publish a DNS TXT record on ${cleanDomain} (e.g., \`v=spf1 -all\` if the domain sends no mail, or authorize specific mail providers with \`~all\` / \`-all\`).`,
    });
  } else if (spfRecord.includes('+all')) {
    findings.push({
      id: generateSecureId('fnd', 6),
      category: 'dns_security',
      title: 'Overly Permissive SPF Record (+all)',
      severity: 'high',
      confidence: 'verified_finding',
      cvss_estimate: 7.2,
      cwe_id: 'CWE-290',
      affected_component: `DNS TXT (${cleanDomain})`,
      evidence: `SPF record contains '+all': ${spfRecord}`,
      impact: 'Allows any host on the internet to send authenticated email on behalf of the domain.',
      remediation: 'Replace `+all` with `-all` (hard fail) or `~all` (soft fail) in the SPF TXT record.',
    });
  }

  const dmarcRecord = dmarcRecords.find((r) => r.toLowerCase().includes('v=dmarc1'));
  if (!dmarcRecord) {
    findings.push({
      id: generateSecureId('fnd', 6),
      category: 'dns_security',
      title: 'Missing DMARC Policy Record (_dmarc)',
      severity: 'low',
      confidence: 'verified_finding',
      cvss_estimate: 3.5,
      cwe_id: 'CWE-290',
      affected_component: `DNS TXT (_dmarc.${cleanDomain})`,
      evidence: `No TXT record starting with 'v=DMARC1' found at _dmarc.${cleanDomain}`,
      impact: 'Receiving mail servers lack policy instructions for handling spoofed messages.',
      remediation: `Publish a DMARC record at \`_dmarc.${cleanDomain}\` such as \`v=DMARC1; p=quarantine; rua=mailto:security@${cleanDomain}\`.`,
    });
  } else if (/p=none/i.test(dmarcRecord)) {
    findings.push({
      id: generateSecureId('fnd', 6),
      category: 'dns_security',
      title: 'DMARC Policy in Monitoring-Only Mode (p=none)',
      severity: 'info',
      confidence: 'verified_finding',
      cvss_estimate: 2.1,
      cwe_id: 'CWE-290',
      affected_component: `DNS TXT (_dmarc.${cleanDomain})`,
      evidence: `DMARC record specifies 'p=none': ${dmarcRecord}`,
      impact: 'Failing emails are reported but not quarantined or rejected.',
      remediation: 'Transition DMARC policy from `p=none` to `p=quarantine` or `p=reject` once legitimate senders are aligned.',
    });
  }

  if (caaRecords.length === 0) {
    findings.push({
      id: generateSecureId('fnd', 6),
      category: 'dns_security',
      title: 'No CAA (Certificate Authority Authorization) Records Configured',
      severity: 'info',
      confidence: 'unverified_indicator',
      cvss_estimate: 2.0,
      cwe_id: 'CWE-295',
      affected_component: `DNS CAA (${cleanDomain})`,
      evidence: `No CAA records returned for ${cleanDomain}`,
      impact: 'Any public Certificate Authority can issue TLS certificates for this domain if domain validation is satisfied.',
      remediation: `Add DNS CAA records restricting issuance to your authorized CAs (e.g., \`0 issue "letsencrypt.org"\`, \`0 issue "pki.goog"\`).`,
    });
  }

  return findings;
}

/**
 * 4. Dependency Vulnerability & Supply-Chain Assessment
 */
export function analyzePackageDependencies(
  packageJsonInput: string | Record<string, any>
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  let pkg: Record<string, any>;

  if (typeof packageJsonInput === 'string') {
    try {
      pkg = JSON.parse(packageJsonInput);
    } catch {
      return [
        {
          id: generateSecureId('fnd', 6),
          category: 'dependency_audit',
          title: 'Invalid JSON in package.json Manifest',
          severity: 'low',
          confidence: 'verified_finding',
          cvss_estimate: 2.5,
          affected_component: 'package.json',
          evidence: 'Failed to parse provided package.json string as valid JSON.',
          impact: 'Cannot deterministically verify dependency version constraints.',
          remediation: 'Ensure package.json is valid, well-formed JSON.',
        },
      ];
    }
  } else {
    pkg = packageJsonInput || {};
  }

  const allDeps: Array<{ section: string; name: string; spec: string }> = [];
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const map = pkg[section];
    if (map && typeof map === 'object') {
      for (const [name, spec] of Object.entries(map)) {
        allDeps.push({ section, name, spec: String(spec) });
      }
    }
  }

  // Known high-risk / deprecated or vulnerable version patterns
  const KNOWN_ADVISORIES: Array<{
    name: string;
    test: (spec: string) => boolean;
    severity: SecuritySeverity;
    cvss: number;
    cwe: string;
    title: string;
    impact: string;
    remediation: string;
  }> = [
    {
      name: 'lodash',
      test: (s) => /^[~^]?[0-3]\.|^[~^]?4\.(0|1[0-6]|17\.([0-9]|1[0-9]|20))\b/.test(s),
      severity: 'high',
      cvss: 7.4,
      cwe: 'CWE-1321',
      title: 'Outdated lodash Version Vulnerable to Prototype Pollution / Command Injection',
      impact: 'Versions of lodash prior to 4.17.21 are vulnerable to prototype pollution (CVE-2020-8203) and template command injection (CVE-2021-23337).',
      remediation: 'Upgrade `lodash` to `^4.17.21` or replace with native ES2022 array/object methods.',
    },
    {
      name: 'jsonwebtoken',
      test: (s) => /^[~^]?[0-8]\./.test(s),
      severity: 'high',
      cvss: 7.6,
      cwe: 'CWE-347',
      title: 'Outdated jsonwebtoken (< 9.0.0) Vulnerable to Key Confusion / Insecure Defaults',
      impact: 'jsonwebtoken < 9.0.0 is affected by CVE-2022-23529 and algorithm confusion risks.',
      remediation: 'Upgrade `jsonwebtoken` to `^9.0.2` or use Web Crypto `crypto.subtle` HMAC/ECDSA.',
    },
    {
      name: 'axios',
      test: (s) => /^[~^]?0\./.test(s),
      severity: 'medium',
      cvss: 6.5,
      cwe: 'CWE-918',
      title: 'Legacy axios 0.x Branch Vulnerable to SSRF & CSRF Credential Leakage',
      impact: 'axios 0.x contains known SSRF and XSRF-TOKEN leakage vulnerabilities (CVE-2023-45857).',
      remediation: 'Upgrade `axios` to `^1.7.4` or use native `fetch()`.',
    },
    {
      name: 'request',
      test: () => true,
      severity: 'medium',
      cvss: 5.5,
      cwe: 'CWE-1104',
      title: 'Deprecated Unmaintained Package: request',
      impact: 'The `request` package is permanently deprecated and receives no security patches.',
      remediation: 'Replace `request` with the standard `fetch` API.',
    },
  ];

  for (const dep of allDeps) {
    // Check unpinned wildcard / latest
    if (dep.spec === '*' || dep.spec.toLowerCase() === 'latest') {
      findings.push({
        id: generateSecureId('fnd', 6),
        category: 'dependency_audit',
        title: `Unpinned Wildcard Dependency Version: ${dep.name}`,
        severity: 'medium',
        confidence: 'verified_finding',
        cvss_estimate: 5.8,
        cwe_id: 'CWE-1104',
        affected_component: `package.json (${dep.section}.${dep.name})`,
        evidence: `"${dep.name}": "${dep.spec}"`,
        impact: 'Unpinned wildcard versions expose builds to supply-chain compromise or breaking upstream releases.',
        remediation: `Pin \`${dep.name}\` to an explicit semantic version range and commit a lockfile.`,
      });
    }

    // Check insecure HTTP tarball or unpinned git URL
    if (dep.spec.startsWith('http://') || dep.spec.startsWith('git://')) {
      findings.push({
        id: generateSecureId('fnd', 6),
        category: 'dependency_audit',
        title: `Insecure Cleartext Transport for Dependency: ${dep.name}`,
        severity: 'high',
        confidence: 'verified_finding',
        cvss_estimate: 8.1,
        cwe_id: 'CWE-829',
        affected_component: `package.json (${dep.section}.${dep.name})`,
        evidence: `"${dep.name}": "${dep.spec}"`,
        impact: 'Fetching dependency tarballs over cleartext HTTP or git:// allows arbitrary code execution via MITM.',
        remediation: `Use HTTPS registry packages or pin git dependencies over \`https://\` with a full commit SHA.`,
      });
    }

    // Check known advisories
    for (const adv of KNOWN_ADVISORIES) {
      if (dep.name === adv.name && adv.test(dep.spec)) {
        findings.push({
          id: generateSecureId('fnd', 6),
          category: 'dependency_audit',
          title: adv.title,
          severity: adv.severity,
          confidence: 'verified_finding',
          cvss_estimate: adv.cvss,
          cwe_id: adv.cwe,
          affected_component: `package.json (${dep.section}.${dep.name})`,
          evidence: `"${dep.name}": "${dep.spec}"`,
          impact: adv.impact,
          remediation: adv.remediation,
        });
      }
    }
  }

  // Check dangerous lifecycle scripts
  const scripts = pkg.scripts;
  if (scripts && typeof scripts === 'object') {
    for (const [hook, cmd] of Object.entries(scripts)) {
      const cmdStr = String(cmd);
      if (/curl\s+.*\|\s*(sh|bash)|wget\s+.*\|\s*(sh|bash)/i.test(cmdStr)) {
        findings.push({
          id: generateSecureId('fnd', 6),
          category: 'dependency_audit',
          title: `Remote Shell Pipe in npm Script (${hook})`,
          severity: 'critical',
          confidence: 'verified_finding',
          cvss_estimate: 9.3,
          cwe_id: 'CWE-829',
          affected_component: `package.json (scripts.${hook})`,
          evidence: redactSecrets(cmdStr),
          impact: 'Piping remote URLs directly into a shell executes untrusted code during build or install.',
          remediation: 'Remove remote shell execution from npm scripts and verify checksums before running binaries.',
        });
      }
    }
  }

  return findings;
}

/**
 * 5 & 6. Static Source-Code & Configuration Security Analysis
 */
export function analyzeSourceCodeAndConfig(
  content: string,
  filename = 'source.ts',
  isConfig = false
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  if (!content || typeof content !== 'string') return findings;

  const lines = content.split('\n');

  const RULES: Array<{
    regex: RegExp;
    title: string;
    severity: SecuritySeverity;
    confidence: FindingConfidence;
    cvss: number;
    cwe: string;
    category: 'source_code' | 'configuration';
    impact: string;
    remediation: string;
  }> = [
    {
      regex: /(?:ghp_[a-zA-Z0-9]{30,}|sk-[a-zA-Z0-9]{32,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z-_]{35}|ak_live_[0-9a-f]{32,})/,
      title: 'Hardcoded API Key or Secret Token in Source/Config',
      severity: 'critical',
      confidence: 'verified_finding',
      cvss: 9.1,
      cwe: 'CWE-798',
      category: isConfig ? 'configuration' : 'source_code',
      impact: 'Hardcoded credentials in source control can be extracted by anyone with repository read access.',
      remediation: 'Revoke the exposed credential immediately and move secrets to Cloudflare Worker secrets (`wrangler secret put`) or environment variables.',
    },
    {
      regex: /\b(?:eval|new\s+Function)\s*\(/,
      title: 'Dynamic Code Execution Sink (eval / new Function)',
      severity: 'high',
      confidence: 'unverified_indicator',
      cvss: 7.8,
      cwe: 'CWE-95',
      category: 'source_code',
      impact: 'If user-controlled input reaches eval() or new Function(), arbitrary code execution occurs.',
      remediation: 'Eliminate eval() / new Function() and use safe JSON parsing (`JSON.parse`) or explicit dispatch tables.',
    },
    {
      regex: /dangerouslySetInnerHTML|\.innerHTML\s*=/,
      title: 'Unescaped DOM HTML Injection Sink (innerHTML / dangerouslySetInnerHTML)',
      severity: 'medium',
      confidence: 'unverified_indicator',
      cvss: 6.1,
      cwe: 'CWE-79',
      category: 'source_code',
      impact: 'Rendering unsanitized strings as raw HTML can lead to Cross-Site Scripting (XSS).',
      remediation: 'Render text via standard React JSX expressions or sanitize HTML with DOMPurify before insertion.',
    },
    {
      regex: /\.prepare\s*\(\s*`[^`]*\$\{(?!PUBLIC_WORKER_COLUMNS|fields\.join|updates\.join|conditions\.join)[^}]+\}[^`]*`\s*\)/,
      title: 'Potential SQL Injection via Template Literal Interpolation in .prepare()',
      severity: 'high',
      confidence: 'unverified_indicator',
      cvss: 8.6,
      cwe: 'CWE-89',
      category: 'source_code',
      impact: 'Interpolating untrusted variables directly into SQL strings allows arbitrary SQL query manipulation.',
      remediation: 'Use parameterized `?` placeholders and `.bind(...params)` for all user-supplied values in D1 SQL queries.',
    },
    {
      regex: /child_process.*exec\s*\(\s*`[^`]*\$\{/,
      title: 'Potential OS Command Injection in Shell Execution',
      severity: 'critical',
      confidence: 'unverified_indicator',
      cvss: 9.4,
      cwe: 'CWE-78',
      category: 'source_code',
      impact: 'Interpolating variables into shell command strings allows arbitrary command execution via shell metacharacters.',
      remediation: 'Use `execFile` or `spawn` with an explicit argument array and avoid shell interpolation.',
    },
    {
      regex: /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0['"]?|rejectUnauthorized\s*:\s*false/,
      title: 'Disabled TLS Certificate Validation',
      severity: 'high',
      confidence: 'verified_finding',
      cvss: 7.4,
      cwe: 'CWE-295',
      category: isConfig ? 'configuration' : 'source_code',
      impact: 'Disabling TLS certificate verification allows trivial Man-in-the-Middle (MITM) interception.',
      remediation: 'Enable strict TLS certificate verification (`rejectUnauthorized: true`) in all environments.',
    },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('--')) {
      continue;
    }
    for (const rule of RULES) {
      if (rule.regex.test(line)) {
        findings.push({
          id: generateSecureId('fnd', 6),
          category: rule.category,
          title: rule.title,
          severity: rule.severity,
          confidence: rule.confidence,
          cvss_estimate: rule.cvss,
          cwe_id: rule.cwe,
          affected_component: `${filename}:${i + 1}`,
          evidence: `Line ${i + 1}: ${redactSecrets(trimmed).slice(0, 160)}`,
          impact: rule.impact,
          remediation: rule.remediation,
        });
      }
    }
  }

  return findings;
}

/**
 * Run a comprehensive, authorized defensive security assessment and generate
 * a prioritized report distinguishing verified findings from unverified indicators.
 */
export async function runDefensiveSecurityAssessment(
  input: DefensiveSecurityAssessmentInput,
  fetchFn: typeof fetch = fetch
): Promise<{ ok: true; report: DefensiveSecurityAssessmentReport } | { ok: false; status: number; error: string }> {
  if (input.authorization_confirmed !== true) {
    return {
      ok: false,
      status: 403,
      error:
        'Authorization boundary check failed: explicit operator confirmation (`authorization_confirmed: true`) is required before running a security assessment.',
    };
  }

  const findings: SecurityFinding[] = [];
  const modulesExecuted: string[] = [];

  // 1. Target URL / HTTP Headers & TLS Assessment
  let resolvedDomain = input.domain?.trim();
  if (input.target_url) {
    const safeCheck = validateSafeTargetUrl(input.target_url, Boolean(input.allow_localhost_for_test));
    if (!safeCheck.ok) {
      return {
        ok: false,
        status: 400,
        error: safeCheck.error,
      };
    }
    if (!resolvedDomain) {
      resolvedDomain = safeCheck.url.hostname;
    }

    let headersToAnalyze: Record<string, string> = input.response_headers
      ? { ...input.response_headers }
      : {};

    if (!input.response_headers || Object.keys(input.response_headers).length === 0) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const resp = await fetchFn(safeCheck.url.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': 'AetherOS-Defensive-Security-Auditor/1.0 (Authorized Defensive Check)',
          },
        }).finally(() => clearTimeout(timer));

        resp.headers.forEach((value, key) => {
          headersToAnalyze[key.toLowerCase()] = value;
        });
      } catch (err: any) {
        findings.push({
          id: generateSecureId('fnd', 6),
          category: 'tls_transport',
          title: 'Target Endpoint Unreachable During Read-Only Probe',
          severity: 'info',
          confidence: 'unverified_indicator',
          classification: 'unverified_indicator',
          cvss_estimate: 0.0,
          affected_component: input.target_url,
          evidence: `Probe error: ${redactSecrets(String(err?.message || err))}`,
          impact: 'Live HTTP response headers could not be retrieved from the target URL.',
          remediation: 'Verify network reachability or supply captured HTTP response headers directly for offline analysis.',
        });
      }
    }

    if (Object.keys(headersToAnalyze).length > 0 || safeCheck.url.protocol === 'http:') {
      modulesExecuted.push('http_security_headers', 'tls_transport_posture');
      findings.push(...analyzeHttpHeadersAndTls(input.target_url, headersToAnalyze));
    }
  } else if (input.response_headers && Object.keys(input.response_headers).length > 0) {
    modulesExecuted.push('http_security_headers', 'tls_transport_posture');
    findings.push(...analyzeHttpHeadersAndTls('https://analyzed-headers.local', input.response_headers));
  }

  // 2. DNS Security Assessment
  if (resolvedDomain && !['localhost', '127.0.0.1', '::1'].includes(resolvedDomain)) {
    modulesExecuted.push('dns_security_spf_dmarc_caa');
    const dnsFindings = await analyzeDomainDnsSecurity(resolvedDomain, fetchFn);
    findings.push(...dnsFindings);
  }

  // 3. Dependency Vulnerability Assessment
  const pkgInput = input.package_json_content || input.package_json;
  if (pkgInput) {
    modulesExecuted.push('dependency_vulnerability_audit');
    const depFindings = analyzePackageDependencies(pkgInput).map((f) => ({
      ...f,
      category: 'dependencies' as const,
      classification: f.confidence,
    }));
    findings.push(...depFindings);
  }

  // 4. Static Source-Code Analysis
  if (input.source_code) {
    modulesExecuted.push('static_source_code_analysis');
    findings.push(
      ...analyzeSourceCodeAndConfig(
        input.source_code,
        input.source_filename || 'source.ts',
        false
      )
    );
  }

  // 5. Configuration Auditing
  if (input.config_content) {
    modulesExecuted.push('configuration_audit');
    findings.push(
      ...analyzeSourceCodeAndConfig(
        input.config_content,
        input.config_filename || 'wrangler.toml',
        true
      )
    );
  }

  // Normalize classification alias on all findings
  for (const f of findings) {
    f.classification = f.confidence;
  }

  // Sort findings by severity & CVSS
  const severityWeight: Record<SecuritySeverity, number> = {
    critical: 5,
    high: 4,
    medium: 3,
    low: 2,
    info: 1,
  };

  findings.sort(
    (a, b) =>
      severityWeight[b.severity] - severityWeight[a.severity] ||
      b.cvss_estimate - a.cvss_estimate
  );

  const counts = {
    critical: findings.filter((f) => f.severity === 'critical').length,
    high: findings.filter((f) => f.severity === 'high').length,
    medium: findings.filter((f) => f.severity === 'medium').length,
    low: findings.filter((f) => f.severity === 'low').length,
    info: findings.filter((f) => f.severity === 'info').length,
    verified_findings: findings.filter((f) => f.confidence === 'verified_finding').length,
    unverified_indicators: findings.filter((f) => f.confidence === 'unverified_indicator').length,
  };

  let overallRisk: SecuritySeverity = 'info';
  if (counts.critical > 0) overallRisk = 'critical';
  else if (counts.high > 0) overallRisk = 'high';
  else if (counts.medium > 0) overallRisk = 'medium';
  else if (counts.low > 0) overallRisk = 'low';

  const penalty =
    counts.critical * 28 + counts.high * 16 + counts.medium * 8 + counts.low * 3;
  const securityScore = Math.max(0, Math.min(100, 100 - penalty));

  const summary = {
    total_findings: findings.length,
    ...counts,
    overall_risk_score: 100 - securityScore,
  };

  const prioritizedRemediation = findings
    .filter((f) => f.severity !== 'info')
    .map((f, idx) => ({
      priority_rank: idx + 1,
      finding_id: f.id,
      title: f.title,
      severity: f.severity,
      confidence: f.confidence,
      recommended_action: f.remediation,
    }));

  const reportId = generateSecureId('sec_rep', 8);
  const assessedAt = new Date().toISOString();
  const scopeNote =
    input.authorized_scope_note || 'Authorized defensive security posture assessment';
  const targetLabel =
    input.target_url || resolvedDomain || input.source_filename || 'inline_audit_scope';

  const mdLines: string[] = [
    `# AetherOS Defensive Security Assessment Report (${reportId})`,
    `- **Assessed At**: ${assessedAt}`,
    `- **Scope & Authorization**: Verified (${scopeNote})`,
    `- **Modules Executed**: ${modulesExecuted.join(', ') || 'baseline_posture'}`,
    `- **Overall Risk Level**: ${overallRisk.toUpperCase()} (Security Score: ${securityScore}/100)`,
    `- **Findings Summary**: ${counts.critical} Critical, ${counts.high} High, ${counts.medium} Medium, ${counts.low} Low, ${counts.info} Info (${counts.verified_findings} Verified Findings, ${counts.unverified_indicators} Unverified Indicators)`,
    '',
    '## Detailed Findings',
  ];

  if (findings.length === 0) {
    mdLines.push('No security findings or misconfigurations were detected across the inspected scope.');
  } else {
    for (const f of findings) {
      mdLines.push(
        `### [${f.severity.toUpperCase()}] ${f.title} (${f.confidence === 'verified_finding' ? 'Verified Finding' : 'Unverified Indicator — Manual Review Recommended'})`,
        `- **Component**: \`${f.affected_component}\`${f.cwe_id ? ` · **CWE**: ${f.cwe_id}` : ''} · **CVSS Estimate**: ${f.cvss_estimate.toFixed(1)}`,
        `- **Evidence**: \`${f.evidence}\``,
        `- **Impact**: ${f.impact}`,
        `- **Remediation**: ${f.remediation}`,
        ''
      );
    }
  }

  return {
    ok: true,
    report: {
      report_id: reportId,
      assessed_at: assessedAt,
      scope: input.scope || 'full_audit',
      target: targetLabel,
      authorization_verified: true,
      authorized_scope_note: scopeNote,
      target_summary: {
        target_url: input.target_url,
        domain: resolvedDomain,
        source_filename: input.source_filename,
        config_filename: input.config_filename,
        modules_executed: modulesExecuted,
      },
      overall_risk_level: overallRisk,
      security_score: securityScore,
      summary,
      counts,
      findings,
      prioritized_remediation_plan: prioritizedRemediation,
      markdown_report: mdLines.join('\n'),
    },
  };
}
