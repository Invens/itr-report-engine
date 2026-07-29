'use client';

import { useState } from 'react';

export type ExtractionErrorLog = {
  requestId: string;
  file: string;
  stage: string;
  code: string;
  message: string;
  errorName: string;
  timestamp: string;
  details?: unknown;
  stack?: string;
};

export function ExtractionErrorDetails({ log }: { log: ExtractionErrorLog }) {
  const [copied, setCopied] = useState(false);
  const formatted = JSON.stringify(log, null, 2);

  async function copyLog() {
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <details className="extraction-error-details">
      <summary>
        <span>View error log</span>
        <code>{log.code}</code>
      </summary>
      <div className="extraction-error-head">
        <div><span>Stage</span><strong>{log.stage.replaceAll('_', ' ')}</strong></div>
        <div><span>Request ID</span><strong>{log.requestId}</strong></div>
        <button type="button" className="secondary compact" onClick={copyLog}>
          {copied ? 'Copied' : 'Copy log'}
        </button>
      </div>
      <p className="extraction-error-message">{log.message}</p>
      <pre>{formatted}</pre>
    </details>
  );
}
