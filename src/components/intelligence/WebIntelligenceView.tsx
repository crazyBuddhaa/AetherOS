import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiClient } from '../../services/api-client';
import {
  Globe,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Cpu,
  Layers,
  FileText,
  ExternalLink,
  Download,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Server,
  Lock,
  Compass,
  ArrowRight,
  Code2,
  Terminal,
} from 'lucide-react';

export const WebIntelligenceView: React.FC = () => {
  const { workers, submitTask, uploadFile, showNotification } = useApp();

  const [targetInput, setTargetInput] = useState<string>('https://www.getcustomcarebot.xyz');
  const [investigationNotes, setInvestigationNotes] = useState<string>(
    'Investigate website infrastructure, DNS routing, technology stack, and security posture.'
  );
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [activeReport, setActiveReport] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'domain' | 'tech' | 'security' | 'seo' | 'evidence'>('overview');

  const onlineTextWorkers = workers.filter(
    w =>
      (w.status === 'online' || w.status === 'busy') &&
      (!w.capabilities || w.capabilities.length === 0 || w.capabilities.includes('text') || w.capabilities.includes('code'))
  );

  const handleStartInvestigation = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanTarget = targetInput.trim();
    if (!cleanTarget) return;

    setIsRunning(true);
    setActiveReport(null);

    try {
      // 1. Dispatch through AetherOS Web Intelligence Engine
      const res = await apiClient.investigateWebTarget({
        target: cleanTarget,
        timeout_ms: 15000,
      });

      if (res && res.success && res.report) {
        setActiveReport(res.report);
        showNotification(`Investigation on ${res.report.target_domain} completed`, 'success');

        // Also record a real Task in the orchestrator for audit tracing
        try {
          await submitTask({
            agentId: 'agent_web_intelligence',
            title: `Web Intelligence: ${res.report.target_domain}`,
            description: investigationNotes || `Reconnaissance on ${cleanTarget}`,
            inputPayload: {
              workspace: 'web_intelligence',
              task_type: 'web_intelligence',
              target: cleanTarget,
              report_id: res.report.report_id,
            },
            priority: 'medium',
          });
        } catch {
          // ignore task audit failures if backend already synced
        }
      } else {
        showNotification('Web intelligence investigation returned no report', 'error');
      }
    } catch (err: any) {
      showNotification(err?.message || 'Investigation request failed', 'error');
    } finally {
      setIsRunning(false);
    }
  };

  const handleExportJsonToR2 = async () => {
    if (!activeReport) return;
    try {
      const payload = JSON.stringify(activeReport, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const file = new File([blob], `${activeReport.report_id || 'intelligence_report'}.json`, {
        type: 'application/json',
      });
      await uploadFile(file);
      showNotification('Exported intelligence report to Cloudflare R2', 'success');
    } catch (err: any) {
      showNotification(err?.message || 'Failed to export report', 'error');
    }
  };

  return (
    <div className="space-y-6 pb-12 w-full max-w-full min-w-0">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800 min-w-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span className="whitespace-nowrap">Autonomous Intelligence</span>
            <span>/</span>
            <span className="text-slate-900 dark:text-slate-200 font-medium whitespace-nowrap">AetherEye</span>
            <span>·</span>
            <span className="font-mono tabular-nums whitespace-nowrap">Web Intelligence Agent</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <Globe className="w-6 h-6 text-blue-600 dark:text-blue-400 shrink-0" />
            <span>Web Intelligence & Domain Reconnaissance</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
            Live HTTP crawling, metadata & SEO analysis, technology fingerprinting, DNS-over-HTTPS intelligence, and passive security inspection.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start lg:self-center">
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono ${
              onlineTextWorkers.length > 0
                ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                : 'border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
            }`}
          >
            <Cpu className="w-3.5 h-3.5 shrink-0" />
            <span>
              {onlineTextWorkers.length > 0
                ? `${onlineTextWorkers.length} Kaggle Node Ready`
                : 'Cloudflare Edge + Kaggle Pipeline'}
            </span>
          </div>
        </div>
      </div>

      {/* Target Input Form */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
        <form onSubmit={handleStartInvestigation} className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 min-w-0">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Search className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={targetInput}
                onChange={e => setTargetInput(e.target.value)}
                placeholder="e.g. https://www.getcustomcarebot.xyz or example.com"
                className="w-full pl-10 pr-4 py-2.5 text-xs sm:text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                disabled={isRunning}
              />
            </div>
            <button
              type="submit"
              disabled={isRunning || !targetInput.trim()}
              className="flex items-center justify-center gap-2 px-5 py-2.5 text-xs sm:text-sm font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-60 whitespace-nowrap shadow-xs"
            >
              {isRunning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Investigating...</span>
                </>
              ) : (
                <>
                  <Compass className="w-4 h-4" />
                  <span>Execute Reconnaissance</span>
                </>
              )}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium">Quick Targets:</span>
            <button
              type="button"
              onClick={() => {
                setTargetInput('https://www.getcustomcarebot.xyz');
              }}
              className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 font-mono text-[11px]"
            >
              www.getcustomcarebot.xyz
            </button>
            <button
              type="button"
              onClick={() => {
                setTargetInput('https://cloudflare.com');
              }}
              className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 font-mono text-[11px]"
            >
              cloudflare.com
            </button>
            <button
              type="button"
              onClick={() => {
                setTargetInput('https://github.com');
              }}
              className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 font-mono text-[11px]"
            >
              github.com
            </button>
          </div>
        </form>
      </div>

      {/* Investigation Report Display */}
      {activeReport && (
        <div className="space-y-6">
          {/* Executive Summary Card */}
          <div
            className={`p-5 rounded-xl border ${
              activeReport.investigation_status === 'completed'
                ? 'border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20'
                : activeReport.investigation_status === 'partial'
                ? 'border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20'
                : 'border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/60 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                {activeReport.investigation_status === 'completed' ? (
                  <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0" />
                ) : activeReport.investigation_status === 'partial' ? (
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                ) : (
                  <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
                )}
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    Executive Intelligence Summary: {activeReport.target_domain}
                  </h2>
                  <div className="text-xs text-slate-500 font-mono">
                    ID: {activeReport.report_id} · Timestamp: {new Date(activeReport.investigated_at).toLocaleTimeString()}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportJsonToR2}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export JSON to R2</span>
                </button>
                {activeReport.target_url && (
                  <a
                    href={activeReport.target_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <span>Visit Target</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 mt-3 leading-relaxed">
              {activeReport.executive_summary}
            </p>

            {/* Stat Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <div className="p-3 rounded-lg border border-slate-200/60 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60">
                <div className="text-[11px] text-slate-500">HTTP Status</div>
                <div className="text-sm sm:text-base font-bold font-mono text-slate-900 dark:text-white mt-0.5">
                  {activeReport.website_overview.http_status || 'Unreachable'}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200/60 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60">
                <div className="text-[11px] text-slate-500">Response Latency</div>
                <div className="text-sm sm:text-base font-bold font-mono text-slate-900 dark:text-white mt-0.5">
                  {activeReport.website_overview.response_time_ms} ms
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200/60 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60">
                <div className="text-[11px] text-slate-500">Links Discovered</div>
                <div className="text-sm sm:text-base font-bold font-mono text-slate-900 dark:text-white mt-0.5">
                  {activeReport.website_overview.internal_links_count} in / {activeReport.website_overview.external_links_count} out
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200/60 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60">
                <div className="text-[11px] text-slate-500">Security Headers</div>
                <div className="text-sm sm:text-base font-bold font-mono text-slate-900 dark:text-white mt-0.5">
                  {activeReport.security_findings.missing_security_headers.length === 0 ? 'Full' : `${activeReport.security_findings.missing_security_headers.length} missing`}
                </div>
              </div>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="border-b border-slate-200 dark:border-slate-800 flex items-center gap-4 text-xs font-semibold overflow-x-auto">
            <button
              onClick={() => setActiveTab('overview')}
              className={`pb-2.5 whitespace-nowrap transition-colors border-b-2 ${
                activeTab === 'overview'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Overview & Metadata
            </button>
            <button
              onClick={() => setActiveTab('domain')}
              className={`pb-2.5 whitespace-nowrap transition-colors border-b-2 ${
                activeTab === 'domain'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              DNS & Infrastructure ({activeReport.domain_and_infrastructure.nameservers.length} NS)
            </button>
            <button
              onClick={() => setActiveTab('tech')}
              className={`pb-2.5 whitespace-nowrap transition-colors border-b-2 ${
                activeTab === 'tech'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Technology Stack ({activeReport.technology_stack.length})
            </button>
            <button
              onClick={() => setActiveTab('security')}
              className={`pb-2.5 whitespace-nowrap transition-colors border-b-2 ${
                activeTab === 'security'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Security Inspection
            </button>
            <button
              onClick={() => setActiveTab('evidence')}
              className={`pb-2.5 whitespace-nowrap transition-colors border-b-2 ${
                activeTab === 'evidence'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Verified Findings ({activeReport.findings.length})
            </button>
          </div>

          {/* Sub-tab 1: Overview */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Website Meta & Structure</h3>
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-slate-500">Document Title:</span>
                    <div className="font-semibold text-slate-900 dark:text-white mt-0.5">
                      {activeReport.website_overview.title || 'None declared'}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Meta Description:</span>
                    <div className="text-slate-700 dark:text-slate-300 mt-0.5">
                      {activeReport.website_overview.description || 'None declared'}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Final Resolved URL:</span>
                    <div className="font-mono text-slate-900 dark:text-white mt-0.5 break-all">
                      {activeReport.website_overview.final_url}
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-slate-500">Privacy & Terms Discovery:</span>
                    <div className="mt-1 space-y-1">
                      <div>
                        Privacy Policy:{' '}
                        {activeReport.privacy_and_legal.privacy_policy_url ? (
                          <a
                            href={activeReport.privacy_and_legal.privacy_policy_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline font-mono"
                          >
                            {activeReport.privacy_and_legal.privacy_policy_url}
                          </a>
                        ) : (
                          <span className="text-amber-600">Not detected on homepage</span>
                        )}
                      </div>
                      <div>
                        Terms of Service:{' '}
                        {activeReport.privacy_and_legal.terms_of_service_url ? (
                          <a
                            href={activeReport.privacy_and_legal.terms_of_service_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline font-mono"
                          >
                            {activeReport.privacy_and_legal.terms_of_service_url}
                          </a>
                        ) : (
                          <span className="text-amber-600">Not detected on homepage</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">SEO & Usability Posture</h3>
                <div className="space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Robots.txt:</span>
                    <span className={activeReport.seo_findings.has_robots_txt ? 'text-emerald-600 font-semibold' : 'text-slate-400'}>
                      {activeReport.seo_findings.has_robots_txt ? 'Present' : 'Missing'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Sitemap.xml:</span>
                    <span className={activeReport.seo_findings.has_sitemap ? 'text-emerald-600 font-semibold' : 'text-slate-400'}>
                      {activeReport.seo_findings.has_sitemap ? 'Present' : 'Missing'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Canonical Tag:</span>
                    <span className={activeReport.seo_findings.has_canonical ? 'text-emerald-600 font-semibold' : 'text-slate-400'}>
                      {activeReport.seo_findings.has_canonical ? 'Configured' : 'Missing'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Mobile Viewport Meta:</span>
                    <span className={activeReport.usability_and_accessibility.has_viewport_meta ? 'text-emerald-600 font-semibold' : 'text-rose-600'}>
                      {activeReport.usability_and_accessibility.has_viewport_meta ? 'Configured' : 'Missing'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-400">H1 Tag Count:</span>
                    <span className="font-mono">{activeReport.seo_findings.headings_structure.h1_count}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Sub-tab 2: Domain Intelligence */}
          {activeTab === 'domain' && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">DNS & Domain Records (Cloudflare 1.1.1.1 DoH)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                <div>
                  <span className="text-slate-500 font-sans">Delegated Nameservers (NS):</span>
                  <div className="mt-1 p-2 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    {activeReport.domain_and_infrastructure.nameservers.length > 0 ? (
                      activeReport.domain_and_infrastructure.nameservers.map((ns: string, i: number) => (
                        <div key={i}>{ns}</div>
                      ))
                    ) : (
                      <div className="text-slate-400 font-sans">No NS records returned</div>
                    )}
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 font-sans">A / IPv4 Records:</span>
                  <div className="mt-1 p-2 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    {activeReport.domain_and_infrastructure.records.A?.length > 0 ? (
                      activeReport.domain_and_infrastructure.records.A.map((a: any, i: number) => (
                        <div key={i}>{a.data} (TTL {a.TTL})</div>
                      ))
                    ) : (
                      <div className="text-rose-600 font-sans">NXDOMAIN / 0 A records</div>
                    )}
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 font-sans">Mail Exchanger (MX):</span>
                  <div className="mt-1 p-2 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    {activeReport.domain_and_infrastructure.mailServers?.length > 0 ? (
                      activeReport.domain_and_infrastructure.mailServers.map((m: string, i: number) => (
                        <div key={i}>{m}</div>
                      ))
                    ) : (
                      <div className="text-slate-400 font-sans">No MX records defined</div>
                    )}
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 font-sans">SPF & DMARC Posture:</span>
                  <div className="mt-1 p-2 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div>
                      SPF:{' '}
                      {activeReport.domain_and_infrastructure.spf_records?.length > 0
                        ? activeReport.domain_and_infrastructure.spf_records.join(', ')
                        : 'Missing'}
                    </div>
                    <div>
                      DMARC:{' '}
                      {activeReport.domain_and_infrastructure.dmarc_records?.length > 0
                        ? activeReport.domain_and_infrastructure.dmarc_records.join(', ')
                        : 'Missing'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Sub-tab 3: Tech Stack */}
          {activeTab === 'tech' && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Detected Technologies & Frameworks</h3>
              {activeReport.technology_stack.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {activeReport.technology_stack.map((t: any, idx: number) => (
                    <div key={idx} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 dark:text-white">{t.name}</span>
                        <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                          {t.category}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono mt-1 truncate">
                        {t.evidence}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-500">No technology signatures detected (host offline or minimal HTML).</div>
              )}
            </div>
          )}

          {/* Sub-tab 4: Security */}
          {activeTab === 'security' && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Passive Security Posture</h3>
              <div className="space-y-3 text-xs">
                <div>
                  <span className="text-slate-500">Missing Defensive Headers:</span>
                  {activeReport.security_findings.missing_security_headers.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {activeReport.security_findings.missing_security_headers.map((h: string, i: number) => (
                        <span key={i} className="px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-mono text-[11px] border border-rose-200 dark:border-rose-900/60">
                          {h}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-emerald-600 font-semibold mt-1">All primary security headers present</div>
                  )}
                </div>

                <div>
                  <span className="text-slate-500">Potential Misconfigurations:</span>
                  {activeReport.security_findings.potential_misconfigurations.length > 0 ? (
                    <ul className="mt-1 space-y-1 list-disc list-inside text-slate-700 dark:text-slate-300">
                      {activeReport.security_findings.potential_misconfigurations.map((m: string, i: number) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-slate-400 mt-1">None observed</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Sub-tab 5: Verified Findings */}
          {activeTab === 'evidence' && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Evidence-Based Findings</h3>
              <div className="space-y-3">
                {activeReport.findings.map((f: any, i: number) => (
                  <div key={i} className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 dark:text-white">{f.title}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {f.confidence}
                      </span>
                    </div>
                    <div className="text-slate-600 dark:text-slate-400 font-mono text-[11px] break-all">
                      {f.evidence}
                    </div>
                    {f.recommendation && (
                      <div className="text-blue-600 dark:text-blue-400 text-[11px] mt-1">
                        Recommendation: {f.recommendation}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
