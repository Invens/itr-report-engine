'use client';

import { useMemo, useState } from 'react';

type ExtractionResult = {
  id: string;
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

const apiUrl = '/backend';

export default function HomePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<ExtractionResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const grouped = useMemo(() => {
    return results.reduce<Record<string, ExtractionResult[]>>((acc, item) => {
      const key = `${item.extraction.pan}:${item.extraction.name.toUpperCase()}`;
      (acc[key] ??= []).push(item);
      return acc;
    }, {});
  }, [results]);

  async function extract() {
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      files.forEach((file) => form.append('files', file));
      const response = await fetch(`${apiUrl}/v1/documents/extract`, { method: 'POST', body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Extraction failed');
      setResults(body.results);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Extraction failed');
    } finally {
      setBusy(false);
    }
  }

  async function generate(items: ExtractionResult[]) {
    setError('');
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
    const response = await fetch(`${apiUrl}/v1/reports/individual`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? 'Report generation failed');
    else window.location.assign(`${apiUrl}/v1/reports/download?key=${encodeURIComponent(body.outputKey)}`);
  }

  return (
    <main>
      <aside>
        <div className="brand">ITR Engine</div>
        <nav><span className="active">New report</span><span>Reports</span><span>Audit log</span><span>Templates</span></nav>
      </aside>
      <section className="content">
        <header><div><p className="eyebrow">DOCUMENT AUTOMATION</p><h1>Generate verification reports</h1><p>Upload ITR acknowledgements, review extracted values, and create separate Word reports.</p></div><div className="secure">Human approval required</div></header>
        <div className="upload-card">
          <label className="dropzone">
            <input type="file" multiple accept="application/pdf" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
            <strong>Drop ITR acknowledgement PDFs here</strong>
            <span>Maximum 20 files, 25 MB each</span>
          </label>
          <div className="upload-footer"><span>{files.length ? `${files.length} file(s) selected` : 'No files selected'}</span><button disabled={!files.length || busy} onClick={extract}>{busy ? 'Extracting…' : 'Extract with DeepSeek'}</button></div>
          {error && <p className="error">{error}</p>}
        </div>
        {Object.entries(grouped).map(([key, items]) => {
          const client = items[0].extraction;
          return <article className="client" key={key}>
            <div className="client-head"><div><h2>{client.name}</h2><span>{client.pan} · {items.length} return(s)</span></div><button onClick={() => generate(items)}>Generate Word report</button></div>
            <div className="table-wrap"><table><thead><tr><th>AY</th><th>Acknowledgement</th><th>Filed</th><th>Type</th><th>Total income</th><th>Tax payable</th><th>Taxes paid</th><th>Review</th></tr></thead><tbody>
              {items.sort((a,b) => b.extraction.assessmentYear.localeCompare(a.extraction.assessmentYear)).map((item) => <tr key={item.id}><td>{item.extraction.assessmentYear}</td><td>{item.extraction.acknowledgementNumber}</td><td>{item.extraction.filingDate}</td><td>{item.extraction.filingType}</td><td>₹{item.extraction.totalIncome.toLocaleString('en-IN')}</td><td>₹{item.extraction.totalTaxInterestFeePayable.toLocaleString('en-IN')}</td><td>₹{item.extraction.totalTaxesPaid.toLocaleString('en-IN')}</td><td><span className={item.issues.length ? 'warning' : 'ok'}>{item.issues.length ? `${item.issues.length} issue(s)` : 'Ready'}</span></td></tr>)}
            </tbody></table></div>
          </article>;
        })}
      </section>
    </main>
  );
}
