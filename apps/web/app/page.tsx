'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ExtractionErrorDetails,
  type ExtractionErrorLog
} from './ExtractionErrorDetails';

type Tab = 'new' | 'reports' | 'audit' | 'templates';
type ReportMode = 'individual' | 'consolidated';
type Issue = { field: string; severity: string; message: string; code?: string };

type ExtractionResult = {
  id: string;
  documentId: string;
  file: string;
  extractionMode: 'PDF_TEXT' | 'OCR';
  extraction: {
    name: string;
    pan: string;
    assessmentYear: string;
    acknowledgementNumber: string;
    filingDate: string;
    filingType: string;
    totalIncome: number;
    totalTaxInterestFeePayable: number;
    totalTaxesPaid: number;
  };
  issues: Issue[];
};

type BundleExtractionResult = {
  id: string;
  documentId?: string;
  file: string;
  extractionMode?: 'PDF_TEXT' | 'OCR';
  extraction?: Record<string, unknown> & {
    documentType?: string;
    name?: string;
    pan?: string;
    gstin?: string;
    cin?: string;
    assessmentYear?: string;
    financialYear?: string;
    taxPeriod?: string;
  };
  issues: Issue[];
  requiresReview: boolean;
  error?: string;
  errorLog?: ExtractionErrorLog;
};

type DraftIssue = {
  code: string;
  severity: 'WARNING' | 'REVIEW_REQUIRED';
  message: string;
  documentIds: string[];
};

type ReportItem = {
  id: string;
  reportType: string;
  status: string;
  outputKey: string | null;
  generatedAt: string | null;
  createdAt: string;
  client: { name: string; pan: string | null };
};

type AuditItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  after: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
};

type TemplateConfig = {
  bankName: string;
  branchName: string;
  address: string;
  udin: string;
  reference: string;
  firmName: string;
  firmDescription: string;
  firmRegistration: string;
  signerName: string;
  signerDesignation: string;
  membershipNumber: string;
};

type TemplateItem = {
  id: string;
  key: string;
  name: string;
  reportType: string;
  description: string | null;
  isActive: boolean;
  config: TemplateConfig;
  updatedAt: string;
};

const apiUrl = '/backend';

const tabContent: Record<Tab, { eyebrow: string; title: string; subtitle: string; badge: string }> = {
  new: {
    eyebrow: 'DOCUMENT AUTOMATION',
    title: 'Generate verification reports',
    subtitle: 'Process individual acknowledgements or a complete company bundle containing ITR, GST, Form 26AS and audited financial statements.',
    badge: 'Human approval required'
  },
  reports: {
    eyebrow: 'REPORT LIBRARY',
    title: 'Generated reports',
    subtitle: 'Review previously generated files and download them again whenever required.',
    badge: 'Persistent storage'
  },
  audit: {
    eyebrow: 'CONTROL & TRACEABILITY',
    title: 'Audit log',
    subtitle: 'Track document extraction, report generation, and template changes in one timeline.',
    badge: 'Activity recorded'
  },
  templates: {
    eyebrow: 'FIRM CONFIGURATION',
    title: 'Report templates',
    subtitle: 'Manage addressee, firm, reference, and signing defaults used in generated Word reports.',
    badge: 'Database backed'
  }
};

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(value));
}

function describeAudit(item: AuditItem) {
  const data = item.after ?? {};
  if (item.action === 'DOCUMENT_EXTRACTED') {
    return `${String(data.clientName ?? 'Unknown client')} · ${String(data.documentType ?? 'Document')} · ${String(data.issueCount ?? 0)} review issue(s)`;
  }
  if (item.action === 'REPORT_GENERATED') {
    if (data.reportType === 'COMPANY_CONSOLIDATED_VERIFICATION') {
      return `${String(data.clientName ?? 'Company')} · ${String(data.itrSections ?? 0)} ITR section(s) · ${String(data.gstRegistrations ?? 0)} GST registration(s)`;
    }
    if (data.reportType === 'MULTI_INDIVIDUAL_ITR') {
      const taxpayers = Array.isArray(data.taxpayers) ? data.taxpayers.length : 0;
      return `${taxpayers} taxpayer section(s) in one consolidated ITR report`;
    }
    const years = Array.isArray(data.assessmentYears) ? data.assessmentYears.join(', ') : '—';
    return `${String(data.clientName ?? 'Unknown client')} · ${years}`;
  }
  if (item.action === 'TEMPLATE_UPDATED') {
    return `${String(data.name ?? 'Template')} · ${data.isActive ? 'Active' : 'Inactive'}`;
  }
  return item.entityId;
}

function bundleSummary(item: BundleExtractionResult) {
  const extraction = item.extraction;
  if (!extraction) return { type: 'FAILED', entity: item.file, identifier: '—', period: '—' };
  return {
    type: String(extraction.documentType ?? 'UNKNOWN').replaceAll('_', ' '),
    entity: String(extraction.name ?? 'Unknown entity'),
    identifier: String(extraction.gstin ?? extraction.pan ?? extraction.cin ?? '—'),
    period: String(extraction.assessmentYear ?? extraction.taxPeriod ?? extraction.financialYear ?? '—')
  };
}

function reportRows(items: ExtractionResult[]) {
  return items.map(({ extraction }) => ({
    acknowledgementNumber: extraction.acknowledgementNumber,
    filingDate: extraction.filingDate,
    filingType: extraction.filingType,
    assessmentYear: extraction.assessmentYear,
    totalIncome: extraction.totalIncome,
    totalTaxInterestFeePayable: extraction.totalTaxInterestFeePayable,
    totalTaxesPaid: extraction.totalTaxesPaid
  }));
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<Tab>('new');
  const [reportMode, setReportMode] = useState<ReportMode>('individual');
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<ExtractionResult[]>([]);
  const [bundleResults, setBundleResults] = useState<BundleExtractionResult[]>([]);
  const [draftText, setDraftText] = useState('');
  const [draftIssues, setDraftIssues] = useState<DraftIssue[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [sectionBusy, setSectionBusy] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const grouped = useMemo(() => results.reduce<Record<string, ExtractionResult[]>>((acc, item) => {
    const key = `${item.extraction.pan}:${item.extraction.name.toUpperCase()}`;
    (acc[key] ??= []).push(item);
    return acc;
  }, {}), [results]);

  const groupedTaxpayers = useMemo(
    () => Object.values(grouped).sort((a, b) => a[0].extraction.name.localeCompare(b[0].extraction.name)),
    [grouped]
  );
  const successfulBundleIds = useMemo(
    () => bundleResults.flatMap((item) => item.documentId ? [item.documentId] : []),
    [bundleResults]
  );
  const reportStats = useMemo(() => ({
    total: reports.length,
    clients: new Set(reports.map((report) => report.client.pan ?? report.client.name)).size,
    recent: reports.filter((report) => Date.now() - new Date(report.createdAt).getTime() < 30 * 24 * 60 * 60 * 1000).length
  }), [reports]);

  useEffect(() => {
    if (activeTab === 'new') return;
    void loadSection(activeTab);
  }, [activeTab]);

  async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${apiUrl}${path}`, options);
    const body = await response.json();
    if (!response.ok) {
      const requestId = body.requestId ? ` Request ID: ${body.requestId}.` : '';
      const diagnostic = body.diagnostic
        ? `\n${JSON.stringify(body.diagnostic, null, 2)}`
        : '';
      throw new Error(`${body.error ?? 'Request failed'}.${requestId}${diagnostic}`);
    }
    return body as T;
  }

  async function loadSection(tab: Exclude<Tab, 'new'>) {
    setSectionBusy(true);
    setError('');
    try {
      if (tab === 'reports') {
        const body = await fetchJson<{ reports: ReportItem[] }>('/v1/reports');
        setReports(body.reports);
      } else if (tab === 'audit') {
        const body = await fetchJson<{ auditLogs: AuditItem[] }>('/v1/audit-logs');
        setAuditLogs(body.auditLogs);
      } else {
        const body = await fetchJson<{ templates: TemplateItem[] }>('/v1/templates');
        setTemplates(body.templates);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load section');
    } finally {
      setSectionBusy(false);
    }
  }

  function changeMode(mode: ReportMode) {
    setReportMode(mode);
    setFiles([]);
    setResults([]);
    setBundleResults([]);
    setDraftText('');
    setDraftIssues([]);
    setError('');
    setNotice('');
  }

  async function extract() {
    setBusy(true);
    setError('');
    setNotice('');
    setDraftText('');
    setDraftIssues([]);
    try {
      const form = new FormData();
      files.forEach((file) => form.append('files', file));
      if (reportMode === 'individual') {
        const body = await fetchJson<{ results: ExtractionResult[] }>('/v1/documents/extract', {
          method: 'POST',
          body: form
        });
        setResults(body.results);
        setBundleResults([]);
        setNotice(`${body.results.length} acknowledgement(s) extracted. Review every row before generating.`);
      } else {
        const body = await fetchJson<{
          requestId: string;
          results: BundleExtractionResult[];
          failedCount: number;
          successfulLogicalDocumentCount: number;
        }>('/v1/documents/extract-bundle', { method: 'POST', body: form });
        setBundleResults(body.results);
        setResults([]);
        setNotice(`${body.successfulLogicalDocumentCount} logical document(s) extracted; ${body.failedCount} physical file(s) failed. Request ID: ${body.requestId}.`);
        if (body.failedCount > 0) {
          setError('One or more files failed. Open “View error log” in the Review column to see the exact stage, error code, schema path, upstream response and stack trace.');
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Extraction failed');
    } finally {
      setBusy(false);
    }
  }

  async function generateIndividual(items: ExtractionResult[]) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const first = items[0].extraction;
      const payload = {
        clientName: first.name,
        pan: first.pan,
        reportDate: new Date().toLocaleDateString('en-GB'),
        rows: reportRows(items)
      };
      const body = await fetchJson<{ outputKey: string }>('/v1/reports/individual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      download(body.outputKey);
      setNotice('Word report generated and added to the report library.');
      setActiveTab('reports');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Report generation failed');
    } finally {
      setBusy(false);
    }
  }

  async function generateMultiIndividual() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const itrSections = groupedTaxpayers.map((items) => {
        const first = items[0].extraction;
        return {
          sectionLabel: 'Individual',
          clientName: first.name,
          pan: first.pan,
          entityType: 'INDIVIDUAL',
          relationshipStatus: 'DOCUMENT_VERIFIED',
          rows: reportRows(items)
        };
      });
      const payload = {
        reportDate: new Date().toLocaleDateString('en-GB'),
        subjectEntities: itrSections.map((section) => ({
          name: section.clientName,
          pan: section.pan
        })),
        itrSections
      };
      const body = await fetchJson<{ outputKey: string }>('/v1/reports/multi-individual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      download(body.outputKey);
      setNotice('One consolidated Word report was generated for all selected taxpayers.');
      setActiveTab('reports');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Multi-individual report generation failed');
    } finally {
      setBusy(false);
    }
  }

  async function buildDraft() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = await fetchJson<{
        draft: Record<string, unknown>;
        issues: DraftIssue[];
        sourceDocumentCount: number;
        logicalDocumentCount: number;
      }>('/v1/reports/consolidated/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentIds: successfulBundleIds,
          reportDate: new Date().toLocaleDateString('en-GB')
        })
      });
      setDraftText(JSON.stringify(body.draft, null, 2));
      setDraftIssues(body.issues);
      setNotice(`Draft built from ${body.sourceDocumentCount} physical file(s) and ${body.logicalDocumentCount} logical document(s). Edit and approve the JSON before generation.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to build consolidated draft');
    } finally {
      setBusy(false);
    }
  }

  async function generateConsolidated() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = JSON.parse(draftText) as Record<string, unknown>;
      const body = await fetchJson<{ outputKey: string }>('/v1/reports/consolidated', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      download(body.outputKey);
      setNotice('Consolidated Word report generated and added to the report library.');
      setActiveTab('reports');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Consolidated report generation failed');
    } finally {
      setBusy(false);
    }
  }

  function download(outputKey: string) {
    const link = document.createElement('a');
    link.href = `${apiUrl}/v1/reports/download?key=${encodeURIComponent(outputKey)}`;
    link.click();
  }

  function updateTemplateField(templateId: string, field: keyof TemplateConfig, value: string) {
    setTemplates((current) => current.map((template) => template.id === templateId
      ? { ...template, config: { ...template.config, [field]: value } }
      : template));
  }

  async function saveTemplate(template: TemplateItem) {
    setSavingTemplate(template.id);
    setError('');
    setNotice('');
    try {
      const body = await fetchJson<{ template: TemplateItem }>(`/v1/templates/${template.key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: template.name,
          description: template.description ?? '',
          isActive: template.isActive,
          config: template.config
        })
      });
      setTemplates((current) => current.map((item) => (
        item.id === body.template.id ? body.template : item
      )));
      setNotice('Template defaults saved. New reports will use these values.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Template update failed');
    } finally {
      setSavingTemplate('');
    }
  }

  const headingContent = tabContent[activeTab];
  const dropTitle = reportMode === 'individual'
    ? 'Drop ITR acknowledgement PDFs here'
    : 'Drop the complete company verification bundle here';
  const dropHelp = reportMode === 'individual'
    ? 'Acknowledgement PDFs · Maximum 100 files · OCR fallback available'
    : 'ITR, Form 26AS, GSTR-1, GSTR-3B and audited statements · Maximum 100 PDFs';

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">IR</div>
          <div><strong>ITR Engine</strong><span>Verification workspace</span></div>
        </div>
        <nav className="navigation" aria-label="Main navigation">
          <button className={activeTab === 'new' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab('new')}><span>01</span>New report</button>
          <button className={activeTab === 'reports' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab('reports')}><span>02</span>Reports</button>
          <button className={activeTab === 'audit' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab('audit')}><span>03</span>Audit log</button>
          <button className={activeTab === 'templates' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab('templates')}><span>04</span>Templates</button>
        </nav>
        <div className="sidebar-foot"><span className="status-dot" />Docker services online</div>
      </aside>

      <section className="content">
        <header className="page-header">
          <div><p className="eyebrow">{headingContent.eyebrow}</p><h1>{headingContent.title}</h1><p>{headingContent.subtitle}</p></div>
          <div className="secure">{headingContent.badge}</div>
        </header>
        {notice && <div className="notice">{notice}</div>}
        {error && <div className="error">{error}</div>}

        {activeTab === 'new' && <>
          <div className="mode-switcher" role="tablist" aria-label="Report mode">
            <button className={reportMode === 'individual' ? 'mode-button active' : 'mode-button'} onClick={() => changeMode('individual')}><strong>Individual ITR</strong><span>Separate reports or one consolidated report for multiple taxpayers</span></button>
            <button className={reportMode === 'consolidated' ? 'mode-button active' : 'mode-button'} onClick={() => changeMode('consolidated')}><strong>Company consolidated</strong><span>Company, directors, GST states, tax credits and financial statements</span></button>
          </div>

          <div className="upload-card">
            <label className="dropzone">
              <input type="file" multiple accept="application/pdf" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
              <div className="upload-icon">PDF</div><strong>{dropTitle}</strong><span>{dropHelp}</span>
            </label>
            <div className="upload-footer">
              <div><strong>{files.length ? `${files.length} file(s) selected` : 'No files selected'}</strong><span>Every entity is isolated by PAN; GST registrations are isolated by GSTIN.</span></div>
              <button className="primary" disabled={!files.length || busy} onClick={extract}>{busy ? 'Processing…' : 'Extract and classify'}</button>
            </div>
          </div>

          {reportMode === 'individual' && groupedTaxpayers.length > 1 && <section className="panel">
            <div className="panel-head">
              <div><p className="mini-label">CONSOLIDATED INDIVIDUAL OUTPUT</p><h2>{groupedTaxpayers.length} taxpayers detected</h2><p>Generate one report with a common header and signature, plus a separate ITR table for every PAN.</p></div>
              <button className="primary" disabled={busy} onClick={generateMultiIndividual}>Generate one consolidated report</button>
            </div>
          </section>}

          {reportMode === 'individual' && groupedTaxpayers.map((items) => {
            const client = items[0].extraction;
            const key = `${client.pan}:${client.name}`;
            return <article className="panel client" key={key}>
              <div className="client-head"><div><p className="mini-label">TAXPAYER</p><h2>{client.name}</h2><span>{client.pan} · {items.length} return(s)</span></div><button className="primary" disabled={busy} onClick={() => generateIndividual(items)}>Generate separate Word report</button></div>
              <div className="table-wrap"><table><thead><tr><th>AY</th><th>Acknowledgement</th><th>Filed</th><th>Type</th><th>Total income</th><th>Tax payable</th><th>Taxes paid</th><th>Extraction</th><th>Review</th></tr></thead><tbody>
                {[...items].sort((a, b) => b.extraction.assessmentYear.localeCompare(a.extraction.assessmentYear)).map((item) => <tr key={item.id}><td><strong>{item.extraction.assessmentYear}</strong></td><td>{item.extraction.acknowledgementNumber}</td><td>{item.extraction.filingDate}</td><td>{item.extraction.filingType}</td><td>₹{item.extraction.totalIncome.toLocaleString('en-IN')}</td><td>₹{item.extraction.totalTaxInterestFeePayable.toLocaleString('en-IN')}</td><td>₹{item.extraction.totalTaxesPaid.toLocaleString('en-IN')}</td><td>{item.extractionMode}</td><td><span className={item.issues.length ? 'warning' : 'ok'}>{item.issues.length ? `${item.issues.length} issue(s)` : 'Ready'}</span></td></tr>)}
              </tbody></table></div>
            </article>;
          })}

          {reportMode === 'consolidated' && bundleResults.length > 0 && <section className="panel bundle-panel">
            <div className="panel-head"><div><h2>Classified bundle</h2><p>Check document type, entity, identifier and period before building the report draft.</p></div><button className="primary" disabled={!successfulBundleIds.length || busy} onClick={buildDraft}>Build review draft</button></div>
            <div className="table-wrap"><table><thead><tr><th>File</th><th>Document type</th><th>Entity</th><th>PAN/GSTIN/CIN</th><th>Period</th><th>Mode</th><th>Review</th></tr></thead><tbody>
              {bundleResults.map((item) => {
                const summary = bundleSummary(item);
                return <tr key={item.id} className={item.errorLog ? 'failed-row' : undefined}>
                  <td><strong>{item.file}</strong></td>
                  <td>{summary.type}</td>
                  <td>{summary.entity}</td>
                  <td>{summary.identifier}</td>
                  <td>{summary.period}</td>
                  <td>{item.extractionMode ?? '—'}</td>
                  <td>
                    {item.errorLog
                      ? <ExtractionErrorDetails log={item.errorLog} />
                      : <span className={item.issues.length ? 'warning' : 'ok'}>
                        {item.issues.length ? `${item.issues.length} issue(s)` : 'Ready'}
                      </span>}
                  </td>
                </tr>;
              })}
            </tbody></table></div>
          </section>}

          {reportMode === 'consolidated' && draftText && <section className="panel review-panel">
            <div className="panel-head"><div><p className="mini-label">HUMAN REVIEW</p><h2>Consolidated report draft</h2><p>Correct classifications, values, relationships and remarks. Generation uses exactly this approved JSON.</p></div><button className="primary" disabled={busy} onClick={generateConsolidated}>{busy ? 'Generating…' : 'Approve and generate DOCX'}</button></div>
            {draftIssues.length > 0 && <div className="review-issues">{draftIssues.map((issue, index) => <div className={issue.severity === 'REVIEW_REQUIRED' ? 'review-issue critical' : 'review-issue'} key={`${issue.code}-${index}`}><strong>{issue.code.replaceAll('_', ' ')}</strong><span>{issue.message}</span></div>)}</div>}
            <textarea className="json-editor" value={draftText} onChange={(event) => setDraftText(event.target.value)} spellCheck={false} />
          </section>}
        </>}

        {activeTab === 'reports' && <>
          <div className="stats-grid"><div className="stat-card"><span>Total reports</span><strong>{reportStats.total}</strong></div><div className="stat-card"><span>Unique clients</span><strong>{reportStats.clients}</strong></div><div className="stat-card"><span>Generated in 30 days</span><strong>{reportStats.recent}</strong></div></div>
          <section className="panel"><div className="panel-head"><div><h2>Report library</h2><p>Generated Word files remain available in persistent storage.</p></div><button className="secondary" onClick={() => void loadSection('reports')}>Refresh</button></div>
            {sectionBusy ? <div className="empty-state">Loading reports…</div> : reports.length === 0 ? <div className="empty-state"><strong>No reports yet</strong><span>Generate the first report from the New report tab.</span></div> : <div className="table-wrap"><table><thead><tr><th>Client</th><th>PAN</th><th>Report type</th><th>Status</th><th>Generated</th><th>File</th></tr></thead><tbody>{reports.map((report) => <tr key={report.id}><td><strong>{report.client.name}</strong></td><td>{report.client.pan ?? '—'}</td><td>{report.reportType.replaceAll('_', ' ')}</td><td><span className="ok">{report.status}</span></td><td>{formatDate(report.generatedAt ?? report.createdAt)}</td><td>{report.outputKey ? <a className="download-link" href={`${apiUrl}/v1/reports/download?key=${encodeURIComponent(report.outputKey)}`}>Download DOCX</a> : '—'}</td></tr>)}</tbody></table></div>}
          </section>
        </>}

        {activeTab === 'audit' && <section className="panel"><div className="panel-head"><div><h2>Activity timeline</h2><p>Latest 300 system actions, newest first.</p></div><button className="secondary" onClick={() => void loadSection('audit')}>Refresh</button></div>{sectionBusy ? <div className="empty-state">Loading activity…</div> : auditLogs.length === 0 ? <div className="empty-state"><strong>No activity recorded</strong><span>Upload a document to create the first audit entry.</span></div> : <div className="audit-list">{auditLogs.map((item) => <article className="audit-row" key={item.id}><div className="audit-symbol">{item.action.charAt(0)}</div><div className="audit-copy"><div><strong>{item.action.replaceAll('_', ' ')}</strong><span>{item.entityType}</span></div><p>{describeAudit(item)}</p></div><time>{formatDate(item.createdAt)}</time></article>)}</div>}</section>}

        {activeTab === 'templates' && <>{sectionBusy ? <div className="panel empty-state">Loading templates…</div> : templates.map((template) => <section className="panel template-panel" key={template.id}>
          <div className="panel-head template-title"><div><p className="mini-label">{template.reportType.replaceAll('_', ' ')}</p><input className="title-input" value={template.name} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, name: event.target.value } : item))} /><textarea value={template.description ?? ''} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, description: event.target.value } : item))} /></div><label className="switch"><input type="checkbox" checked={template.isActive} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, isActive: event.target.checked } : item))} /><span />Active</label></div>
          <div className="form-section"><h3>Addressee and reference</h3><div className="form-grid"><label>Bank name<input value={template.config.bankName} onChange={(event) => updateTemplateField(template.id, 'bankName', event.target.value)} /></label><label>Branch name<input value={template.config.branchName} onChange={(event) => updateTemplateField(template.id, 'branchName', event.target.value)} /></label><label className="wide">Address<input value={template.config.address} onChange={(event) => updateTemplateField(template.id, 'address', event.target.value)} /></label><label>UDIN default<input value={template.config.udin} onChange={(event) => updateTemplateField(template.id, 'udin', event.target.value)} /></label><label>Reference format<input value={template.config.reference} onChange={(event) => updateTemplateField(template.id, 'reference', event.target.value)} /></label></div></div>
          <div className="form-section"><h3>Firm and signing block</h3><div className="form-grid"><label>Firm name<input value={template.config.firmName} onChange={(event) => updateTemplateField(template.id, 'firmName', event.target.value)} /></label><label>Firm description<input value={template.config.firmDescription} onChange={(event) => updateTemplateField(template.id, 'firmDescription', event.target.value)} /></label><label>Firm registration<input value={template.config.firmRegistration} onChange={(event) => updateTemplateField(template.id, 'firmRegistration', event.target.value)} /></label><label>Signing CA<input value={template.config.signerName} onChange={(event) => updateTemplateField(template.id, 'signerName', event.target.value)} /></label><label>Designation<input value={template.config.signerDesignation} onChange={(event) => updateTemplateField(template.id, 'signerDesignation', event.target.value)} /></label><label>Membership number<input value={template.config.membershipNumber} onChange={(event) => updateTemplateField(template.id, 'membershipNumber', event.target.value)} /></label></div></div>
          <div className="template-footer"><span>Last updated {formatDate(template.updatedAt)}</span><button className="primary" disabled={savingTemplate === template.id} onClick={() => void saveTemplate(template)}>{savingTemplate === template.id ? 'Saving…' : 'Save template'}</button></div>
        </section>)}</>}
      </section>
    </main>
  );
}
