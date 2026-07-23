'use client';

import { useEffect, useMemo, useState } from 'react';

type Tab = 'new' | 'reports' | 'audit' | 'templates';

type ExtractionResult = {
  id: string;
  documentId: string;
  file: string;
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
  issues: Array<{ field: string; severity: string; message: string }>;
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
    subtitle: 'Upload ITR acknowledgements, review extracted values, and create separate Word reports.',
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
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function describeAudit(item: AuditItem) {
  const data = item.after ?? {};

  if (item.action === 'DOCUMENT_EXTRACTED') {
    return `${String(data.clientName ?? 'Unknown client')} · AY ${String(data.assessmentYear ?? '—')} · ${String(data.issueCount ?? 0)} review issue(s)`;
  }

  if (item.action === 'REPORT_GENERATED') {
    const years = Array.isArray(data.assessmentYears) ? data.assessmentYears.join(', ') : '—';
    return `${String(data.clientName ?? 'Unknown client')} · ${years}`;
  }

  if (item.action === 'TEMPLATE_UPDATED') {
    return `${String(data.name ?? 'Template')} · ${data.isActive ? 'Active' : 'Inactive'}`;
  }

  return item.entityId;
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<Tab>('new');
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<ExtractionResult[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [sectionBusy, setSectionBusy] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const grouped = useMemo(() => {
    return results.reduce<Record<string, ExtractionResult[]>>((acc, item) => {
      const key = `${item.extraction.pan}:${item.extraction.name.toUpperCase()}`;
      (acc[key] ??= []).push(item);
      return acc;
    }, {});
  }, [results]);

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
    if (!response.ok) throw new Error(body.error ?? 'Request failed');
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

  async function extract() {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const form = new FormData();
      files.forEach((file) => form.append('files', file));
      const body = await fetchJson<{ results: ExtractionResult[] }>('/v1/documents/extract', {
        method: 'POST',
        body: form
      });
      setResults(body.results);
      setNotice(`${body.results.length} document(s) extracted and stored in the audit history.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Extraction failed');
    } finally {
      setBusy(false);
    }
  }

  async function generate(items: ExtractionResult[]) {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const first = items[0].extraction;
      const payload = {
        clientName: first.name,
        pan: first.pan,
        reportDate: new Date().toLocaleDateString('en-GB'),
        rows: items.map(({ extraction }) => ({
          acknowledgementNumber: extraction.acknowledgementNumber,
          filingDate: extraction.filingDate,
          filingType: extraction.filingType,
          assessmentYear: extraction.assessmentYear,
          totalIncome: extraction.totalIncome,
          totalTaxInterestFeePayable: extraction.totalTaxInterestFeePayable,
          totalTaxesPaid: extraction.totalTaxesPaid
        }))
      };
      const body = await fetchJson<{ outputKey: string }>('/v1/reports/individual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const link = document.createElement('a');
      link.href = `${apiUrl}/v1/reports/download?key=${encodeURIComponent(body.outputKey)}`;
      link.click();
      setNotice('Word report generated and added to the report library.');
      setActiveTab('reports');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Report generation failed');
    } finally {
      setBusy(false);
    }
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
      setTemplates((current) => current.map((item) => item.id === body.template.id ? body.template : item));
      setNotice('Template defaults saved. New reports will use these values.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Template update failed');
    } finally {
      setSavingTemplate('');
    }
  }

  const heading = tabContent[activeTab];

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
          <div><p className="eyebrow">{heading.eyebrow}</p><h1>{heading.title}</h1><p>{heading.subtitle}</p></div>
          <div className="secure">{heading.badge}</div>
        </header>

        {notice && <div className="notice">{notice}</div>}
        {error && <div className="error">{error}</div>}

        {activeTab === 'new' && <>
          <div className="upload-card">
            <label className="dropzone">
              <input type="file" multiple accept="application/pdf" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
              <div className="upload-icon">PDF</div>
              <strong>Drop ITR acknowledgement PDFs here</strong>
              <span>Machine-readable PDF · Maximum 20 files · 25 MB each</span>
            </label>
            <div className="upload-footer">
              <div><strong>{files.length ? `${files.length} file(s) selected` : 'No files selected'}</strong><span>Different taxpayers are separated by PAN and name.</span></div>
              <button className="primary" disabled={!files.length || busy} onClick={extract}>{busy ? 'Processing…' : 'Extract with DeepSeek'}</button>
            </div>
          </div>

          {Object.entries(grouped).map(([key, items]) => {
            const client = items[0].extraction;
            return <article className="panel client" key={key}>
              <div className="client-head">
                <div><p className="mini-label">TAXPAYER</p><h2>{client.name}</h2><span>{client.pan} · {items.length} return(s)</span></div>
                <button className="primary" disabled={busy} onClick={() => generate(items)}>Generate Word report</button>
              </div>
              <div className="table-wrap"><table><thead><tr><th>AY</th><th>Acknowledgement</th><th>Filed</th><th>Type</th><th>Total income</th><th>Tax payable</th><th>Taxes paid</th><th>Review</th></tr></thead><tbody>
                {[...items].sort((a, b) => b.extraction.assessmentYear.localeCompare(a.extraction.assessmentYear)).map((item) => <tr key={item.id}><td><strong>{item.extraction.assessmentYear}</strong></td><td>{item.extraction.acknowledgementNumber}</td><td>{item.extraction.filingDate}</td><td>{item.extraction.filingType}</td><td>₹{item.extraction.totalIncome.toLocaleString('en-IN')}</td><td>₹{item.extraction.totalTaxInterestFeePayable.toLocaleString('en-IN')}</td><td>₹{item.extraction.totalTaxesPaid.toLocaleString('en-IN')}</td><td><span className={item.issues.length ? 'warning' : 'ok'}>{item.issues.length ? `${item.issues.length} issue(s)` : 'Ready'}</span></td></tr>)}
              </tbody></table></div>
            </article>;
          })}
        </>}

        {activeTab === 'reports' && <>
          <div className="stats-grid">
            <div className="stat-card"><span>Total reports</span><strong>{reportStats.total}</strong></div>
            <div className="stat-card"><span>Unique clients</span><strong>{reportStats.clients}</strong></div>
            <div className="stat-card"><span>Generated in 30 days</span><strong>{reportStats.recent}</strong></div>
          </div>
          <section className="panel">
            <div className="panel-head"><div><h2>Report library</h2><p>Generated Word files remain available in persistent storage.</p></div><button className="secondary" onClick={() => void loadSection('reports')}>Refresh</button></div>
            {sectionBusy ? <div className="empty-state">Loading reports…</div> : reports.length === 0 ? <div className="empty-state"><strong>No reports yet</strong><span>Generate the first report from the New report tab.</span></div> :
              <div className="table-wrap"><table><thead><tr><th>Client</th><th>PAN</th><th>Report type</th><th>Status</th><th>Generated</th><th>File</th></tr></thead><tbody>
                {reports.map((report) => <tr key={report.id}><td><strong>{report.client.name}</strong></td><td>{report.client.pan ?? '—'}</td><td>{report.reportType.replaceAll('_', ' ')}</td><td><span className="ok">{report.status}</span></td><td>{formatDate(report.generatedAt ?? report.createdAt)}</td><td>{report.outputKey ? <a className="download-link" href={`${apiUrl}/v1/reports/download?key=${encodeURIComponent(report.outputKey)}`}>Download DOCX</a> : '—'}</td></tr>)}
              </tbody></table></div>}
          </section>
        </>}

        {activeTab === 'audit' && <section className="panel">
          <div className="panel-head"><div><h2>Activity timeline</h2><p>Latest 300 system actions, newest first.</p></div><button className="secondary" onClick={() => void loadSection('audit')}>Refresh</button></div>
          {sectionBusy ? <div className="empty-state">Loading activity…</div> : auditLogs.length === 0 ? <div className="empty-state"><strong>No activity recorded</strong><span>Upload a document to create the first audit entry.</span></div> :
            <div className="audit-list">{auditLogs.map((item) => <article className="audit-row" key={item.id}><div className="audit-symbol">{item.action.charAt(0)}</div><div className="audit-copy"><div><strong>{item.action.replaceAll('_', ' ')}</strong><span>{item.entityType}</span></div><p>{describeAudit(item)}</p></div><time>{formatDate(item.createdAt)}</time></article>)}</div>}
        </section>}

        {activeTab === 'templates' && <>
          {sectionBusy ? <div className="panel empty-state">Loading templates…</div> : templates.map((template) => <section className="panel template-panel" key={template.id}>
            <div className="panel-head template-title"><div><p className="mini-label">{template.reportType.replaceAll('_', ' ')}</p><input className="title-input" value={template.name} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, name: event.target.value } : item))} /><textarea value={template.description ?? ''} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, description: event.target.value } : item))} /></div><label className="switch"><input type="checkbox" checked={template.isActive} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, isActive: event.target.checked } : item))} /><span />Active</label></div>
            <div className="form-section"><h3>Addressee and reference</h3><div className="form-grid">
              <label>Bank name<input value={template.config.bankName} onChange={(event) => updateTemplateField(template.id, 'bankName', event.target.value)} /></label>
              <label>Branch name<input value={template.config.branchName} onChange={(event) => updateTemplateField(template.id, 'branchName', event.target.value)} /></label>
              <label className="wide">Address<input value={template.config.address} onChange={(event) => updateTemplateField(template.id, 'address', event.target.value)} /></label>
              <label>UDIN default<input value={template.config.udin} onChange={(event) => updateTemplateField(template.id, 'udin', event.target.value)} /></label>
              <label>Reference format<input value={template.config.reference} onChange={(event) => updateTemplateField(template.id, 'reference', event.target.value)} /></label>
            </div></div>
            <div className="form-section"><h3>Firm and signing block</h3><div className="form-grid">
              <label>Firm name<input value={template.config.firmName} onChange={(event) => updateTemplateField(template.id, 'firmName', event.target.value)} /></label>
              <label>Firm description<input value={template.config.firmDescription} onChange={(event) => updateTemplateField(template.id, 'firmDescription', event.target.value)} /></label>
              <label>Firm registration<input value={template.config.firmRegistration} onChange={(event) => updateTemplateField(template.id, 'firmRegistration', event.target.value)} /></label>
              <label>Signing CA<input value={template.config.signerName} onChange={(event) => updateTemplateField(template.id, 'signerName', event.target.value)} /></label>
              <label>Designation<input value={template.config.signerDesignation} onChange={(event) => updateTemplateField(template.id, 'signerDesignation', event.target.value)} /></label>
              <label>Membership number<input value={template.config.membershipNumber} onChange={(event) => updateTemplateField(template.id, 'membershipNumber', event.target.value)} /></label>
            </div></div>
            <div className="template-footer"><span>Last updated {formatDate(template.updatedAt)}</span><button className="primary" disabled={savingTemplate === template.id} onClick={() => void saveTemplate(template)}>{savingTemplate === template.id ? 'Saving…' : 'Save template'}</button></div>
          </section>)}
        </>}
      </section>
    </main>
  );
}
