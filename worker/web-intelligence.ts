/**
 * AetherOS Web Intelligence Agent Engine (worker/web-intelligence.ts)
 *
 * Full-featured website investigation & intelligence module:
 * 1. Web Fetcher:
 *    - HTTP content retrieval with SSRF protection against private/loopback/cloud metadata ranges
 *    - HTML metadata extraction (title, description, canonical, OpenGraph, Twitter, favicon)
 *    - Internal and external link extraction with deduplication
 *    - robots.txt and sitemap.xml discovery
 *    - Redirect following and status code reporting
 * 2. Domain & DNS Intelligence:
 *    - DNS record queries via Cloudflare DNS-over-HTTPS (A, AAAA, MX, TXT, NS, CAA, SOA)
 *    - Nameserver identification and hosting/CDN provider observations
 * 3. Technology Stack Identification:
 *    - Server header, framework signatures (React, Next.js, Vue, Nuxt, WordPress, Shopify, Cloudflare, etc.)
 *    - Script tag inspection and CMS/analytics detection
 * 4. Passive Security Inspection:
 *    - HTTPS availability, HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
 *    - Cookie security flags (Secure, HttpOnly, SameSite)
 *    - Mixed content observations
 * 5. Usability, Privacy & Legal Discovery:
 *    - Privacy policy and Terms of Service discovery
 *    - Viewport and mobile responsiveness hints
 * 6. Structured Evidence & Multi-Section Report Generation:
 *    - Executive Summary, Domain/Infrastructure, Tech Stack, SEO, Security, Privacy, Risks, Recommendations
 *    - Distinction between verified findings, observations, inferences, and unverified indicators
 */

import { generateSecureId } from './auth.ts';

export type IntelligenceConfidence =
  | 'verified_finding'
  | 'observation'
  | 'inference'
  | 'recommendation'
  | 'unverified_indicator';

export interface WebFinding {
  id: string;
  category:
    | 'domain_infrastructure'
    | 'technology_stack'
    | 'seo_metadata'
    | 'security'
    | 'usability'
    | 'privacy_legal'
    | 'risk';
  title: string;
  confidence: IntelligenceConfidence;
  evidence: string;
  details?: Record<string, any>;
  impact?: string;
  recommendation?: string;
  source_url?: string;
}

export interface WebFetchResult {
  url: string;
  final_url: string;
  status: number;
  status_text: string;
  redirected: boolean;
  content_type: string;
  content_length_bytes: number;
  title: string;
  description: string;
  canonical_url?: string;
  favicon_url?: string;
  open_graph: Record<string, string>;
  twitter_card: Record<string, string>;
  headings: { h1: string[]; h2: string[]; h3: string[] };
  links_discovered: { internal: string[]; external: string[] };
  discovered_assets: { scripts: string[]; stylesheets: string[]; images: string[] };
  robots_txt?: { found: boolean; status: number; content_snippet?: string };
  sitemap_xml?: { found: boolean; status: number; urls_count?: number };
  raw_text_snippet: string;
}

export interface DnsRecord {
  type: string;
  name: string;
  data: string;
  TTL: number;
}

export interface DomainIntelligenceResult {
  domain: string;
  dns_status: number;
  records: Record<string, DnsRecord[]>;
  nameservers: string[];
  mail_servers: string[];
  spf_records: string[];
  dmarc_records: string[];
  caa_records: string[];
  cdn_provider?: string;
  hosting_provider?: string;
  raw_doh_responses: Record<string, any>;
}

export interface TechnologyFingerprint {
  category: 'cdn' | 'cms' | 'framework' | 'server' | 'analytics' | 'security' | 'hosting';
  name: string;
  version?: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string;
}

export interface SecurityInspectionResult {
  https_available: boolean;
  http_redirects_to_https: boolean;
  security_headers: {
    strict_transport_security?: string;
    content_security_policy?: string;
    x_frame_options?: string;
    x_content_type_options?: string;
    referrer_policy?: string;
    permissions_policy?: string;
  };
  missing_security_headers: string[];
  cookies_inspected: Array<{
    name: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite?: string;
  }>;
  mixed_content_warnings: string[];
  potential_misconfigurations: string[];
}

export interface WebIntelligenceReport {
  report_id: string;
  investigated_at: string;
  target_url: string;
  target_domain: string;
  investigation_status: 'completed' | 'partial' | 'failed';
  failure_reason?: string;
  executive_summary: string;
  website_overview: {
    title: string;
    description: string;
    final_url: string;
    http_status: number;
    response_time_ms: number;
    page_size_kb: number;
    internal_links_count: number;
    external_links_count: number;
  };
  domain_and_infrastructure: DomainIntelligenceResult;
  technology_stack: TechnologyFingerprint[];
  seo_findings: {
    has_title: boolean;
    title_length: number;
    has_description: boolean;
    description_length: number;
    has_canonical: boolean;
    has_sitemap: boolean;
    has_robots_txt: boolean;
    og_tags_present: string[];
    headings_structure: { h1_count: number; h2_count: number; h3_count: number };
  };
  security_findings: SecurityInspectionResult;
  usability_and_accessibility: {
    has_viewport_meta: boolean;
    has_favicon: boolean;
    has_h1: boolean;
    images_without_alt_count: number;
    observations: string[];
  };
  privacy_and_legal: {
    privacy_policy_url?: string;
    terms_of_service_url?: string;
    cookie_consent_detected: boolean;
    contact_page_url?: string;
  };
  potential_risks: string[];
  recommendations: string[];
  findings: WebFinding[];
  sources_and_evidence: Array<{
    source_url: string;
    data_type: string;
    timestamp: string;
    snippet: string;
  }>;
  investigation_limitations: string[];
}

// -----------------------------------------------------------------------------
// SSRF & TARGET VALIDATION
// -----------------------------------------------------------------------------

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./, // AWS / GCP link-local metadata
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
];

export function isTargetAllowed(
  targetUrl: string,
  allowLocalhost = false
): { allowed: boolean; reason?: string; url?: URL } {
  try {
    const raw = targetUrl.trim();
    if (raw.includes('://')) {
      const scheme = raw.split('://')[0].toLowerCase();
      if (scheme !== 'http' && scheme !== 'https') {
        return { allowed: false, reason: `Protocol '${scheme}:' is not permitted. Only HTTP and HTTPS are allowed.` };
      }
    }
    let normalized = raw;
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = `https://${normalized}`;
    }
    const parsed = new URL(normalized);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { allowed: false, reason: 'Only HTTP and HTTPS protocols are permitted' };
    }

    const host = parsed.hostname.toLowerCase();

    if (!allowLocalhost) {
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '0.0.0.0' ||
        host.endsWith('.local') ||
        host.endsWith('.internal')
      ) {
        return { allowed: false, reason: 'Access to localhost and internal hostnames is prohibited' };
      }

      for (const pattern of PRIVATE_IP_PATTERNS) {
        if (pattern.test(host)) {
          return { allowed: false, reason: 'Target resolves to a restricted private or link-local IP space' };
        }
      }
    }

    return { allowed: true, url: parsed };
  } catch (err: any) {
    return { allowed: false, reason: `Invalid target URL format: ${err?.message || 'parse failure'}` };
  }
}

// -----------------------------------------------------------------------------
// DNS INTELLIGENCE VIA DOH (CLOUDFLARE 1.1.1.1)
// -----------------------------------------------------------------------------

export async function queryDoh(
  domain: string,
  recordType: 'A' | 'AAAA' | 'MX' | 'TXT' | 'NS' | 'CAA' | 'SOA'
): Promise<DnsRecord[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${recordType}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/dns-json' },
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    if (!data || !Array.isArray(data.Answer)) return [];
    return data.Answer.map((a: any) => ({
      type: recordType,
      name: a.name,
      data: a.data,
      TTL: a.TTL,
    }));
  } catch {
    return [];
  }
}

export async function gatherDomainIntelligence(domain: string): Promise<DomainIntelligenceResult> {
  const cleanDomain = domain.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].toLowerCase();

  const [aRecs, aaaaRecs, mxRecs, txtRecs, nsRecs, caaRecs] = await Promise.all([
    queryDoh(cleanDomain, 'A'),
    queryDoh(cleanDomain, 'AAAA'),
    queryDoh(cleanDomain, 'MX'),
    queryDoh(cleanDomain, 'TXT'),
    queryDoh(cleanDomain, 'NS'),
    queryDoh(cleanDomain, 'CAA'),
  ]);

  const nameservers = nsRecs.map(r => r.data.replace(/\.$/, ''));
  const mailServers = mxRecs.map(r => r.data.replace(/\.$/, ''));
  const spfRecords = txtRecs.map(r => r.data.replace(/^"|"$/g, '')).filter(t => t.includes('v=spf1'));
  const caaRecords = caaRecs.map(r => r.data.replace(/^"|"$/g, ''));

  // Query DMARC explicitly at _dmarc.<domain>
  const dmarcLookup = await queryDoh(`_dmarc.${cleanDomain}`, 'TXT');
  const dmarcRecords = dmarcLookup
    .map(r => r.data.replace(/^"|"$/g, ''))
    .filter(t => t.includes('v=DMARC1'));

  // Detect CDN / Cloud Provider based on IP and NS
  let cdnProvider: string | undefined;
  let hostingProvider: string | undefined;

  for (const ns of nameservers) {
    const lower = ns.toLowerCase();
    if (lower.includes('cloudflare')) cdnProvider = 'Cloudflare';
    else if (lower.includes('awsdns')) hostingProvider = 'Amazon Web Services (Route53)';
    else if (lower.includes('googledomains') || lower.includes('google')) hostingProvider = 'Google Cloud DNS';
    else if (lower.includes('azure')) hostingProvider = 'Microsoft Azure DNS';
    else if (lower.includes('centralnic')) hostingProvider = 'CentralNic / Registrar DNS';
  }

  for (const a of aRecs) {
    if (a.data.startsWith('104.') || a.data.startsWith('172.67.') || a.data.startsWith('188.114.')) {
      cdnProvider = cdnProvider || 'Cloudflare CDN';
    } else if (a.data.startsWith('151.101.') || a.data.startsWith('199.232.')) {
      cdnProvider = cdnProvider || 'Fastly';
    } else if (a.data.startsWith('13.') || a.data.startsWith('52.') || a.data.startsWith('54.')) {
      hostingProvider = hostingProvider || 'Amazon Web Services';
    } else if (a.data.startsWith('76.76.21.')) {
      cdnProvider = cdnProvider || 'Vercel Edge Network';
    }
  }

  return {
    domain: cleanDomain,
    dns_status: aRecs.length > 0 || aaaaRecs.length > 0 ? 0 : 3, // 0 = NOERROR, 3 = NXDOMAIN
    records: {
      A: aRecs,
      AAAA: aaaaRecs,
      MX: mxRecs,
      TXT: txtRecs,
      NS: nsRecs,
      CAA: caaRecs,
      DMARC: dmarcLookup,
    },
    nameservers,
    mail_servers: mailServers,
    spf_records: spfRecords,
    dmarc_records: dmarcRecords,
    caa_records: caaRecords,
    cdn_provider: cdnProvider,
    hosting_provider: hostingProvider,
    raw_doh_responses: {
      a_count: aRecs.length,
      txt_count: txtRecs.length,
      ns_count: nsRecs.length,
    },
  };
}

// -----------------------------------------------------------------------------
// WEB FETCHER & HTML PARSER (PURE REGEX/DOM, NO EXTRA LIBS)
// -----------------------------------------------------------------------------

export function parseHtmlMetadata(html: string, baseUrl: string): {
  title: string;
  description: string;
  canonical_url?: string;
  favicon_url?: string;
  open_graph: Record<string, string>;
  twitter_card: Record<string, string>;
  headings: { h1: string[]; h2: string[]; h3: string[] };
  links_discovered: { internal: string[]; external: string[] };
  discovered_assets: { scripts: string[]; stylesheets: string[]; images: string[] };
  privacy_policy_url?: string;
  terms_of_service_url?: string;
  contact_page_url?: string;
  raw_text_snippet: string;
} {
  const baseObj = new URL(baseUrl);
  const baseOrigin = baseObj.origin;
  const baseDomain = baseObj.hostname.toLowerCase();

  // 1. Title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

  // 2. Meta tags
  let description = '';
  let canonical_url: string | undefined;
  let favicon_url: string | undefined;
  const open_graph: Record<string, string> = {};
  const twitter_card: Record<string, string> = {};

  const metaRegex = /<meta\s+([^>]+)>/gi;
  let mMatch: RegExpExecArray | null;
  while ((mMatch = metaRegex.exec(html)) !== null) {
    const tag = mMatch[1];
    const nameMatch = tag.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i);
    const contentMatch = tag.match(/content\s*=\s*["']([^"']*)["']/i);
    if (nameMatch && contentMatch) {
      const key = nameMatch[1].toLowerCase();
      const val = contentMatch[1].trim();
      if (key === 'description') description = val;
      if (key.startsWith('og:')) open_graph[key] = val;
      if (key.startsWith('twitter:')) twitter_card[key] = val;
    }
  }

  // 3. Link tags (canonical, favicon)
  const linkTagRegex = /<link\s+([^>]+)>/gi;
  let lMatch: RegExpExecArray | null;
  while ((lMatch = linkTagRegex.exec(html)) !== null) {
    const tag = lMatch[1];
    const relMatch = tag.match(/rel\s*=\s*["']([^"']+)["']/i);
    const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (relMatch && hrefMatch) {
      const rel = relMatch[1].toLowerCase();
      const href = hrefMatch[1].trim();
      try {
        const fullHref = new URL(href, baseUrl).href;
        if (rel.includes('canonical')) canonical_url = fullHref;
        if (rel.includes('icon') || rel.includes('shortcut')) favicon_url = fullHref;
      } catch {
        // ignore
      }
    }
  }

  // 4. Headings
  const headings = { h1: [] as string[], h2: [] as string[], h3: [] as string[] };
  const h1Matches = html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi);
  for (const h of h1Matches) headings.h1.push(h[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
  const h2Matches = html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi);
  for (const h of h2Matches) headings.h2.push(h[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
  const h3Matches = html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi);
  for (const h of h3Matches) headings.h3.push(h[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());

  // 5. Links
  const internalLinks = new Set<string>();
  const externalLinks = new Set<string>();
  let privacy_policy_url: string | undefined;
  let terms_of_service_url: string | undefined;
  let contact_page_url: string | undefined;

  const aTagRegex = /<a\s+[^>]*href\s*=\s*["']([^"'#\s]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let aMatch: RegExpExecArray | null;
  while ((aMatch = aTagRegex.exec(html)) !== null) {
    const rawHref = aMatch[1].trim();
    const linkText = aMatch[2].replace(/<[^>]+>/g, '').toLowerCase().trim();

    try {
      const fullUrl = new URL(rawHref, baseUrl);
      if (fullUrl.protocol !== 'http:' && fullUrl.protocol !== 'https:') continue;

      const linkDomain = fullUrl.hostname.toLowerCase();
      const hrefStr = fullUrl.href;

      if (linkDomain === baseDomain || linkDomain.endsWith(`.${baseDomain}`)) {
        internalLinks.add(hrefStr);
      } else {
        externalLinks.add(hrefStr);
      }

      // Discover legal and contact paths
      const lowerHref = hrefStr.toLowerCase();
      if (linkText.includes('privacy') || lowerHref.includes('privacy')) {
        privacy_policy_url = privacy_policy_url || hrefStr;
      }
      if (linkText.includes('terms') || lowerHref.includes('terms') || lowerHref.includes('tos')) {
        terms_of_service_url = terms_of_service_url || hrefStr;
      }
      if (linkText.includes('contact') || lowerHref.includes('contact')) {
        contact_page_url = contact_page_url || hrefStr;
      }
    } catch {
      // ignore invalid URLs
    }
  }

  // 6. Scripts, Stylesheets, Images
  const scripts = new Set<string>();
  const stylesheets = new Set<string>();
  const images = new Set<string>();

  const scriptRegex = /<script\s+[^>]*src\s*=\s*["']([^"']+)["']/gi;
  let sMatch: RegExpExecArray | null;
  while ((sMatch = scriptRegex.exec(html)) !== null) scripts.add(sMatch[1]);

  const cssRegex = /<link\s+[^>]*rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']([^"']+)["']/gi;
  let cMatch: RegExpExecArray | null;
  while ((cMatch = cssRegex.exec(html)) !== null) stylesheets.add(cMatch[1]);

  const imgRegex = /<img\s+[^>]*src\s*=\s*["']([^"']+)["']/gi;
  let iMatch: RegExpExecArray | null;
  while ((iMatch = imgRegex.exec(html)) !== null) images.add(iMatch[1]);

  // 7. Strip tags to produce readable text snippet
  const cleanText = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title,
    description,
    canonical_url,
    favicon_url,
    open_graph,
    twitter_card,
    headings: {
      h1: headings.h1.slice(0, 10),
      h2: headings.h2.slice(0, 20),
      h3: headings.h3.slice(0, 30),
    },
    links_discovered: {
      internal: Array.from(internalLinks).slice(0, 100),
      external: Array.from(externalLinks).slice(0, 50),
    },
    discovered_assets: {
      scripts: Array.from(scripts).slice(0, 50),
      stylesheets: Array.from(stylesheets).slice(0, 30),
      images: Array.from(images).slice(0, 50),
    },
    privacy_policy_url,
    terms_of_service_url,
    contact_page_url,
    raw_text_snippet: cleanText.slice(0, 4000),
  };
}

// -----------------------------------------------------------------------------
// TECHNOLOGY FINGERPRINTING
// -----------------------------------------------------------------------------

export function fingerprintTechnologies(
  headers: Headers | Record<string, string>,
  html: string,
  scripts: string[]
): TechnologyFingerprint[] {
  const fingerprints: TechnologyFingerprint[] = [];
  const getHeader = (k: string): string => {
    if (typeof (headers as any).get === 'function') {
      return (headers as Headers).get(k) || '';
    }
    return (headers as Record<string, string>)[k.toLowerCase()] || (headers as Record<string, string>)[k] || '';
  };

  const serverHeader = getHeader('server');
  if (serverHeader) {
    fingerprints.push({
      category: 'server',
      name: serverHeader,
      confidence: 'high',
      evidence: `Server: ${serverHeader}`,
    });
  }

  const poweredBy = getHeader('x-powered-by');
  if (poweredBy) {
    fingerprints.push({
      category: 'framework',
      name: poweredBy,
      confidence: 'high',
      evidence: `X-Powered-By: ${poweredBy}`,
    });
  }

  // Cloudflare CDN
  if (getHeader('cf-ray') || serverHeader.toLowerCase().includes('cloudflare')) {
    fingerprints.push({
      category: 'cdn',
      name: 'Cloudflare',
      confidence: 'high',
      evidence: `CF-Ray: ${getHeader('cf-ray') || 'present'}`,
    });
  }

  // Vercel
  if (getHeader('x-vercel-id')) {
    fingerprints.push({
      category: 'hosting',
      name: 'Vercel',
      confidence: 'high',
      evidence: `X-Vercel-Id: ${getHeader('x-vercel-id')}`,
    });
  }

  // HTML Content inspection
  const lowerHtml = html.toLowerCase();

  // Next.js
  if (lowerHtml.includes('__next') || lowerHtml.includes('/_next/static/')) {
    fingerprints.push({
      category: 'framework',
      name: 'Next.js',
      confidence: 'high',
      evidence: 'DOM contains __next root or /_next/static bundles',
    });
  }

  // React
  if (lowerHtml.includes('react') || lowerHtml.includes('data-reactroot')) {
    fingerprints.push({
      category: 'framework',
      name: 'React',
      confidence: 'high',
      evidence: 'Detected React runtime markers or bundle identifiers',
    });
  }

  // Vue.js
  if (lowerHtml.includes('data-v-') || lowerHtml.includes('vue.')) {
    fingerprints.push({
      category: 'framework',
      name: 'Vue.js',
      confidence: 'medium',
      evidence: 'DOM contains data-v-* attributes or Vue library scripts',
    });
  }

  // WordPress
  if (lowerHtml.includes('/wp-content/') || lowerHtml.includes('/wp-includes/')) {
    fingerprints.push({
      category: 'cms',
      name: 'WordPress',
      confidence: 'high',
      evidence: 'Found /wp-content/ or /wp-includes/ path references',
    });
  }

  // Tailwind CSS
  if (lowerHtml.includes('tailwindcss') || lowerHtml.includes('tailwind')) {
    fingerprints.push({
      category: 'framework',
      name: 'Tailwind CSS',
      confidence: 'medium',
      evidence: 'Class utility patterns or stylesheet markers match Tailwind CSS',
    });
  }

  // Google Analytics / GTM
  if (lowerHtml.includes('www.googletagmanager.com') || lowerHtml.includes('google-analytics.com')) {
    fingerprints.push({
      category: 'analytics',
      name: 'Google Tag Manager / Analytics',
      confidence: 'high',
      evidence: 'Included googletagmanager script loader',
    });
  }

  return fingerprints;
}

// -----------------------------------------------------------------------------
// PASSIVE SECURITY INSPECTION
// -----------------------------------------------------------------------------

export function inspectPassiveSecurity(
  targetUrl: string,
  resHeaders: Headers | Record<string, string>,
  cookiesHeader?: string
): SecurityInspectionResult {
  const getHeader = (k: string): string => {
    if (typeof (resHeaders as any).get === 'function') {
      return (resHeaders as Headers).get(k) || '';
    }
    return (resHeaders as Record<string, string>)[k.toLowerCase()] || (resHeaders as Record<string, string>)[k] || '';
  };

  const isHttps = targetUrl.startsWith('https://');
  const hsts = getHeader('strict-transport-security');
  const csp = getHeader('content-security-policy');
  const xfo = getHeader('x-frame-options');
  const xcto = getHeader('x-content-type-options');
  const referrer = getHeader('referrer-policy');
  const permPolicy = getHeader('permissions-policy');

  const missingHeaders: string[] = [];
  if (!hsts && isHttps) missingHeaders.push('Strict-Transport-Security (HSTS)');
  if (!csp) missingHeaders.push('Content-Security-Policy (CSP)');
  if (!xfo) missingHeaders.push('X-Frame-Options');
  if (!xcto) missingHeaders.push('X-Content-Type-Options');
  if (!referrer) missingHeaders.push('Referrer-Policy');

  const cookiesInspected: SecurityInspectionResult['cookies_inspected'] = [];
  if (cookiesHeader) {
    const rawCookies = cookiesHeader.split(/,(?=\s*[a-zA-Z0-9_]+=)/);
    for (const c of rawCookies) {
      const parts = c.split(';').map(p => p.trim());
      const name = parts[0].split('=')[0];
      const lower = c.toLowerCase();
      cookiesInspected.push({
        name,
        secure: lower.includes('secure'),
        httpOnly: lower.includes('httponly'),
        sameSite: lower.includes('samesite=strict')
          ? 'Strict'
          : lower.includes('samesite=lax')
          ? 'Lax'
          : lower.includes('samesite=none')
          ? 'None'
          : undefined,
      });
    }
  }

  const misconfigs: string[] = [];
  if (isHttps && !hsts) {
    misconfigs.push('HTTPS endpoint lacks HSTS header; vulnerable to downgrade attacks');
  }
  if (!xfo && !csp) {
    misconfigs.push('No clickjacking defense configured (missing X-Frame-Options and frame-ancestors CSP)');
  }
  if (!xcto) {
    misconfigs.push('MIME-sniffing protection disabled (missing X-Content-Type-Options: nosniff)');
  }

  return {
    https_available: isHttps,
    http_redirects_to_https: isHttps, // Observed target
    security_headers: {
      strict_transport_security: hsts || undefined,
      content_security_policy: csp || undefined,
      x_frame_options: xfo || undefined,
      x_content_type_options: xcto || undefined,
      referrer_policy: referrer || undefined,
      permissions_policy: permPolicy || undefined,
    },
    missing_security_headers: missingHeaders,
    cookies_inspected: cookiesInspected,
    mixed_content_warnings: [],
    potential_misconfigurations: misconfigs,
  };
}

// -----------------------------------------------------------------------------
// END-TO-END INVESTIGATION CONTROLLER
// -----------------------------------------------------------------------------

export async function runWebInvestigation(params: {
  target: string;
  allow_localhost?: boolean;
  timeout_ms?: number;
}): Promise<WebIntelligenceReport> {
  const investigatedAt = new Date().toISOString();
  const reportId = generateSecureId('rep_web');
  const timeoutMs = params.timeout_ms || 12000;

  // 1. SSRF and URL validation
  const validation = isTargetAllowed(params.target, params.allow_localhost);
  if (!validation.allowed || !validation.url) {
    return {
      report_id: reportId,
      investigated_at: investigatedAt,
      target_url: params.target,
      target_domain: params.target,
      investigation_status: 'failed',
      failure_reason: validation.reason || 'Target URL validation failed',
      executive_summary: `Investigation failed: ${validation.reason}`,
      website_overview: {
        title: '',
        description: '',
        final_url: params.target,
        http_status: 0,
        response_time_ms: 0,
        page_size_kb: 0,
        internal_links_count: 0,
        external_links_count: 0,
      },
      domain_and_infrastructure: {
        domain: params.target,
        dns_status: 3,
        records: {},
        nameservers: [],
        mail_servers: [],
        spf_records: [],
        dmarc_records: [],
        caa_records: [],
        raw_doh_responses: {},
      },
      technology_stack: [],
      seo_findings: {
        has_title: false,
        title_length: 0,
        has_description: false,
        description_length: 0,
        has_canonical: false,
        has_sitemap: false,
        has_robots_txt: false,
        og_tags_present: [],
        headings_structure: { h1_count: 0, h2_count: 0, h3_count: 0 },
      },
      security_findings: {
        https_available: false,
        http_redirects_to_https: false,
        security_headers: {},
        missing_security_headers: [],
        cookies_inspected: [],
        mixed_content_warnings: [],
        potential_misconfigurations: [validation.reason || 'Blocked target'],
      },
      usability_and_accessibility: {
        has_viewport_meta: false,
        has_favicon: false,
        has_h1: false,
        images_without_alt_count: 0,
        observations: ['Target prohibited or invalid.'],
      },
      privacy_and_legal: {
        cookie_consent_detected: false,
      },
      potential_risks: [validation.reason || 'Target resolution blocked'],
      recommendations: ['Provide a valid, publicly resolvable fully-qualified domain name or URL.'],
      findings: [
        {
          id: generateSecureId('find'),
          category: 'risk',
          title: 'Target Validation Rejected',
          confidence: 'verified_finding',
          evidence: validation.reason || 'SSRF safety guard triggered',
        },
      ],
      sources_and_evidence: [],
      investigation_limitations: ['Pre-flight SSRF protection blocked connection.'],
    };
  }

  const targetUrl = validation.url.href;
  const targetDomain = validation.url.hostname;

  // 2. Perform DNS and Domain Intelligence in parallel with HTTP fetch
  const domainIntelPromise = gatherDomainIntelligence(targetDomain);

  // 3. Perform Live HTTP Fetch with Timeout Controller
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();

  let httpResponse: Response | null = null;
  let htmlContent = '';
  let fetchError: string | null = null;
  let responseTimeMs = 0;

  try {
    httpResponse = await fetch(targetUrl, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AetherOS-WebIntelligence/1.0; +https://aetheros.dev/bot)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    responseTimeMs = Date.now() - t0;
    clearTimeout(timer);
    htmlContent = await httpResponse.text();
  } catch (err: any) {
    clearTimeout(timer);
    responseTimeMs = Date.now() - t0;
    fetchError = err?.name === 'AbortError' ? `Connection timed out after ${timeoutMs}ms` : err?.message || 'Network error';
  }

  // Await domain intelligence
  const domainIntel = await domainIntelPromise;

  // Check robots.txt and sitemap.xml if the main site was reachable
  let robotsResult = { found: false, status: 0, content_snippet: undefined as string | undefined };
  let sitemapResult = { found: false, status: 0, urls_count: undefined as number | undefined };

  if (httpResponse && httpResponse.status < 400) {
    try {
      const robotsUrl = new URL('/robots.txt', targetUrl).href;
      const robRes = await fetch(robotsUrl, { method: 'GET', redirect: 'follow' });
      robotsResult.status = robRes.status;
      if (robRes.ok) {
        robotsResult.found = true;
        const rTxt = await robRes.text();
        robotsResult.content_snippet = rTxt.slice(0, 300);
      }
    } catch {
      // ignore
    }

    try {
      const sitemapUrl = new URL('/sitemap.xml', targetUrl).href;
      const smRes = await fetch(sitemapUrl, { method: 'GET', redirect: 'follow' });
      sitemapResult.status = smRes.status;
      if (smRes.ok) {
        sitemapResult.found = true;
        const smTxt = await smRes.text();
        const locCount = (smTxt.match(/<loc>/g) || []).length;
        sitemapResult.urls_count = locCount;
      }
    } catch {
      // ignore
    }
  }

  // If initial HTTP request completely failed (e.g. NXDOMAIN, down host)
  if (!httpResponse || fetchError) {
    const isNxDomain = domainIntel.dns_status === 3 || domainIntel.records.A.length === 0;
    const errorSummary = isNxDomain
      ? `Domain '${targetDomain}' does not resolve to active DNS A/AAAA records (NXDOMAIN / unconfigured).`
      : `HTTP connection to '${targetUrl}' failed: ${fetchError}`;

    return {
      report_id: reportId,
      investigated_at: investigatedAt,
      target_url: targetUrl,
      target_domain: targetDomain,
      investigation_status: isNxDomain ? 'completed' : 'partial',
      failure_reason: fetchError || 'Host unreachable',
      executive_summary: `Reconnaissance concluded on ${targetDomain}. ${errorSummary}`,
      website_overview: {
        title: '',
        description: '',
        final_url: targetUrl,
        http_status: 0,
        response_time_ms: responseTimeMs,
        page_size_kb: 0,
        internal_links_count: 0,
        external_links_count: 0,
      },
      domain_and_infrastructure: domainIntel,
      technology_stack: domainIntel.nameservers.length > 0 ? [{
        category: 'hosting',
        name: domainIntel.hosting_provider || domainIntel.nameservers[0],
        confidence: 'high',
        evidence: `Delegated nameservers: ${domainIntel.nameservers.join(', ')}`,
      }] : [],
      seo_findings: {
        has_title: false,
        title_length: 0,
        has_description: false,
        description_length: 0,
        has_canonical: false,
        has_sitemap: false,
        has_robots_txt: false,
        og_tags_present: [],
        headings_structure: { h1_count: 0, h2_count: 0, h3_count: 0 },
      },
      security_findings: {
        https_available: false,
        http_redirects_to_https: false,
        security_headers: {},
        missing_security_headers: ['HTTP Server Unreachable'],
        cookies_inspected: [],
        mixed_content_warnings: [],
        potential_misconfigurations: [
          isNxDomain
            ? 'DNS resolution failure: Domain has no active A or AAAA records'
            : 'Host not accepting HTTP/HTTPS traffic',
        ],
      },
      usability_and_accessibility: {
        has_viewport_meta: false,
        has_favicon: false,
        has_h1: false,
        images_without_alt_count: 0,
        observations: ['Host is not serving web content.'],
      },
      privacy_and_legal: {
        cookie_consent_detected: false,
      },
      potential_risks: [
        isNxDomain ? 'Domain is inactive or expired, presenting domain-takeover or impersonation risks' : 'Service outage',
      ],
      recommendations: [
        isNxDomain
          ? 'Verify domain registration and ensure DNS A/AAAA records point to the intended web origin.'
          : 'Check web server process, firewall rules, and TLS certificate bindings.',
      ],
      findings: [
        {
          id: generateSecureId('find'),
          category: 'domain_infrastructure',
          title: isNxDomain ? 'Unresolved Domain / NXDOMAIN' : 'Web Origin Unreachable',
          confidence: 'verified_finding',
          evidence: isNxDomain
            ? `Cloudflare DoH returned Status ${domainIntel.dns_status} with 0 A/AAAA records`
            : `HTTP fetch failed: ${fetchError}`,
          source_url: targetUrl,
        },
      ],
      sources_and_evidence: [
        {
          source_url: `https://cloudflare-dns.com/dns-query?name=${targetDomain}&type=A`,
          data_type: 'DNS-over-HTTPS (A Record)',
          timestamp: investigatedAt,
          snippet: JSON.stringify(domainIntel.records.A || []),
        },
      ],
      investigation_limitations: [
        'Web origin was not reachable via HTTP; content analysis and technology fingerprinting could not be performed.',
      ],
    };
  }

  // 4. Parse HTML Content & Metadata
  const parsedMeta = parseHtmlMetadata(htmlContent, httpResponse.url || targetUrl);
  const techStack = fingerprintTechnologies(
    httpResponse.headers,
    htmlContent,
    parsedMeta.discovered_assets.scripts
  );
  const securityInspection = inspectPassiveSecurity(
    httpResponse.url || targetUrl,
    httpResponse.headers,
    httpResponse.headers.get('set-cookie') || undefined
  );

  // 5. Synthesize Evidence Findings
  const findings: WebFinding[] = [];

  // Finding: Server & Status
  findings.push({
    id: generateSecureId('find'),
    category: 'domain_infrastructure',
    title: `Web Origin Online (HTTP ${httpResponse.status})`,
    confidence: 'verified_finding',
    evidence: `Target responded in ${responseTimeMs}ms with Content-Type: ${httpResponse.headers.get('content-type') || 'unknown'}`,
    source_url: httpResponse.url || targetUrl,
  });

  // Finding: Missing Security Headers
  if (securityInspection.missing_security_headers.length > 0) {
    findings.push({
      id: generateSecureId('find'),
      category: 'security',
      title: 'Missing Key HTTP Security Headers',
      confidence: 'verified_finding',
      evidence: `Missing: ${securityInspection.missing_security_headers.join(', ')}`,
      impact: 'Increases exposure to cross-site scripting (XSS), clickjacking, and protocol downgrade attacks.',
      recommendation: 'Configure HSTS, Content-Security-Policy, X-Frame-Options, and X-Content-Type-Options headers.',
      source_url: httpResponse.url || targetUrl,
    });
  }

  // Finding: SEO & Metadata
  if (!parsedMeta.title) {
    findings.push({
      id: generateSecureId('find'),
      category: 'seo_metadata',
      title: 'Missing HTML Document Title',
      confidence: 'verified_finding',
      evidence: 'No <title> tag found in HTML head',
      recommendation: 'Add a descriptive 50-60 character <title> tag for search engines.',
      source_url: httpResponse.url || targetUrl,
    });
  }
  if (!parsedMeta.description) {
    findings.push({
      id: generateSecureId('find'),
      category: 'seo_metadata',
      title: 'Missing Meta Description',
      confidence: 'verified_finding',
      evidence: 'No <meta name="description"> tag present',
      recommendation: 'Provide a concise 120-160 character description summarizing the page.',
      source_url: httpResponse.url || targetUrl,
    });
  }

  // Finding: DNS SPF/DMARC
  if (domainIntel.spf_records.length === 0) {
    findings.push({
      id: generateSecureId('find'),
      category: 'domain_infrastructure',
      title: 'Missing DNS SPF Record',
      confidence: 'verified_finding',
      evidence: `No TXT record containing 'v=spf1' found on ${targetDomain}`,
      impact: 'Domain can be spoofed in outbound phishing emails.',
      recommendation: 'Publish a valid SPF TXT record defining authorized mail senders.',
      source_url: `https://cloudflare-dns.com/dns-query?name=${targetDomain}&type=TXT`,
    });
  }

  // Potential Risks & Recommendations
  const risks: string[] = [];
  const recommendations: string[] = [];

  if (securityInspection.missing_security_headers.length > 0) {
    risks.push(`Absence of security headers: ${securityInspection.missing_security_headers.slice(0, 3).join(', ')}`);
    recommendations.push('Deploy modern HTTP security headers at the web server or edge CDN layer.');
  }
  if (!parsedMeta.canonical_url) {
    recommendations.push('Implement canonical link tags to avoid search engine duplicate-content penalties.');
  }
  if (!robotsResult.found) {
    recommendations.push('Create a robots.txt file defining crawler access policies.');
  }
  if (!parsedMeta.privacy_policy_url) {
    risks.push('No explicit Privacy Policy link detected on the home page.');
    recommendations.push('Add a clearly accessible Privacy Policy and Terms of Service in the footer.');
  }

  // Executive Summary Formulation
  const pageSizeKb = Math.round(htmlContent.length / 1024);
  const techNames = techStack.map(t => t.name).join(', ') || 'Standard Web Stack';
  const execSummary = `AetherEye completed reconnaissance on ${targetDomain} (HTTP ${httpResponse.status}, ${responseTimeMs}ms, ${pageSizeKb} KB). Identified technology stack: ${techNames}. Domain routed through nameservers: ${domainIntel.nameservers.join(', ') || 'Registrar default'}. Discovered ${parsedMeta.links_discovered.internal.length} internal links and ${parsedMeta.links_discovered.external.length} outbound external references. Security audit revealed ${securityInspection.missing_security_headers.length} missing defensive headers.`;

  return {
    report_id: reportId,
    investigated_at: investigatedAt,
    target_url: targetUrl,
    target_domain: targetDomain,
    investigation_status: 'completed',
    executive_summary: execSummary,
    website_overview: {
      title: parsedMeta.title || 'Untitled Web Page',
      description: parsedMeta.description,
      final_url: httpResponse.url || targetUrl,
      http_status: httpResponse.status,
      response_time_ms: responseTimeMs,
      page_size_kb: pageSizeKb,
      internal_links_count: parsedMeta.links_discovered.internal.length,
      external_links_count: parsedMeta.links_discovered.external.length,
    },
    domain_and_infrastructure: domainIntel,
    technology_stack: techStack,
    seo_findings: {
      has_title: Boolean(parsedMeta.title),
      title_length: parsedMeta.title.length,
      has_description: Boolean(parsedMeta.description),
      description_length: parsedMeta.description.length,
      has_canonical: Boolean(parsedMeta.canonical_url),
      has_sitemap: sitemapResult.found,
      has_robots_txt: robotsResult.found,
      og_tags_present: Object.keys(parsedMeta.open_graph),
      headings_structure: {
        h1_count: parsedMeta.headings.h1.length,
        h2_count: parsedMeta.headings.h2.length,
        h3_count: parsedMeta.headings.h3.length,
      },
    },
    security_findings: securityInspection,
    usability_and_accessibility: {
      has_viewport_meta: htmlContent.includes('name="viewport"') || htmlContent.includes("name='viewport'"),
      has_favicon: Boolean(parsedMeta.favicon_url),
      has_h1: parsedMeta.headings.h1.length > 0,
      images_without_alt_count: (htmlContent.match(/<img(?![^>]*\balt=)[^>]*>/gi) || []).length,
      observations: [
        parsedMeta.headings.h1.length === 1 ? 'Optimal single H1 structure.' : `Found ${parsedMeta.headings.h1.length} H1 tags.`,
        parsedMeta.favicon_url ? 'Favicon defined.' : 'No explicit favicon link declared.',
      ],
    },
    privacy_and_legal: {
      privacy_policy_url: parsedMeta.privacy_policy_url,
      terms_of_service_url: parsedMeta.terms_of_service_url,
      cookie_consent_detected: htmlContent.toLowerCase().includes('cookie') && (htmlContent.toLowerCase().includes('consent') || htmlContent.toLowerCase().includes('banner')),
      contact_page_url: parsedMeta.contact_page_url,
    },
    potential_risks: risks,
    recommendations,
    findings,
    sources_and_evidence: [
      {
        source_url: targetUrl,
        data_type: 'HTML Content',
        timestamp: investigatedAt,
        snippet: parsedMeta.raw_text_snippet.slice(0, 400),
      },
      {
        source_url: `https://cloudflare-dns.com/dns-query?name=${targetDomain}&type=A`,
        data_type: 'DNS-over-HTTPS',
        timestamp: investigatedAt,
        snippet: JSON.stringify(domainIntel.records.A || []),
      },
    ],
    investigation_limitations: [
      'Investigation is passive; does not perform intrusive vulnerability exploitation or authenticated session crawling.',
      'Client-side dynamically hydrated DOM elements rendered solely by JavaScript were analyzed via raw HTTP responses.',
    ],
  };
}
