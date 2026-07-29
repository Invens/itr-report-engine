import {
  auditedFinancialStatementsExtractionSchema,
  documentExtractionSchema,
  fullItrExtractionSchema,
  gstr1AExtractionSchema,
  gstr1ExtractionSchema,
  gstr3BExtractionSchema,
  itrExtractionSchema,
  type DocumentExtraction,
  type ItrExtraction
} from '@itr/contracts';
import { env } from './config.js';

const SUPPORTED_TYPES = [
  'ITR_ACKNOWLEDGEMENT',
  'ITR_FULL',
  'GSTR_1',
  'GSTR_1A',
  'GSTR_3B',
  'AUDITED_FINANCIAL_STATEMENTS'
] as const;

type SupportedDocumentType = typeof SUPPORTED_TYPES[number];

const COMMON_RULES = `
Return JSON only. Extract exact source values and never invent a missing value.
Use the legal name printed in the return, PAN or audited statement, never a filename spelling.
Keep every taxpayer isolated by PAN and every GST registration isolated by GSTIN.
Dates should be ISO YYYY-MM-DD when possible. Money is in actual rupees unless a source unit is explicitly captured.
Include evidence snippets and confidence values. Negative GST amendments and credit notes must remain negative.`;

const ITR_RULES = `
Map filing sections semantically: 139(1)=ORIGINAL, 139(4)=BELATED, 139(5)=REVISED, 139(8A)=UPDATED.
Do not map a belated return to REVISED. Total income is distinct from current-year business loss, accounting PBT and PAT.
Use the labelled acknowledgement values, not fixed row numbers because acknowledgement layouts change.
For a revised return, capture original acknowledgement metadata when the source supplies it.
For full ITRs, extract directors/key persons, tax-audit and statutory-audit records separately, and extract Part A-BS/Part A-P&L values with semantic keys.
Accounting PBT, PAT and taxable business income are separate fields and must not be substituted.`;

const GST_RULES = `
For GSTR-1, totalOutwardValue is the final 'Total Liability (Outward supplies other than Reverse charge)' value.
Do not use gross invoice value or HSN summary as final liability. Keep reverse-charge outward value separately; its tax is not supplier output liability.
Use only amendment net differential, not amended gross amount. Preserve credit/debit-note net values with their sign.
For GSTR-1A, capture the adjustment even when outward value is zero but tax changes.
For GSTR-3B, totalOutwardValue is 3.1(a)+3.1(b)+3.1(c)+3.1(e), excluding inward reverse charge.
Store gross ITC, reversed ITC and net ITC separately. Do not report gross ITC as claimed when fully reversed.`;

const FINANCIAL_RULES = `
Detect the printed statement unit exactly: RUPEES, HUNDREDS or LAKHS. Do not normalize or calculate in the model response.
Extract Balance Sheet and Profit and Loss values by semantic key. Keep PBT, current-tax provision and PAT as separate values.
Capture statutory financial-statement audit and tax-audit records separately; different dates or UDINs are not automatically errors.`;

function stripCodeFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

async function requestJson(system: string, user: string) {
  const response = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    }),
    signal: AbortSignal.timeout(180_000)
  });

  if (!response.ok) {
    throw new Error(`DeepSeek request failed (${response.status}): ${await response.text()}`);
  }

  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned no content');
  return JSON.parse(stripCodeFence(content)) as unknown;
}

export function detectDocumentType(text: string, originalName = ''): SupportedDocumentType | 'UNKNOWN' {
  const sample = `${originalName}\n${text.slice(0, 30_000)}`.toUpperCase();

  if (/FORM\s+GSTR-3B|GSTR\s*-?\s*3B/.test(sample)) return 'GSTR_3B';
  if (/CONSOLIDATED SUMMARY OF GSTR-1 AND GSTR-1A|FORM\s+GSTR-1A/.test(sample)) return 'GSTR_1A';
  if (/FORM\s+GSTR-1|DETAILS OF OUTWARD SUPPLIES OF GOODS OR SERVICES/.test(sample)) return 'GSTR_1';
  if (/INDIAN INCOME TAX RETURN ACKNOWLEDGEMENT|ITR-V|ACKNOWLEDGEMENT NUMBER/.test(sample)
    && !/PART A-BS|PART A-P&L|SCHEDULE BP/.test(sample)) return 'ITR_ACKNOWLEDGEMENT';
  if (/ITR-[1-7]|PART A-BS|PART A-P&L|SCHEDULE BP|AUDIT INFORMATION/.test(sample)) return 'ITR_FULL';
  if (/BALANCE SHEET|PROFIT AND LOSS|AUDITOR'?S REPORT|FINANCIAL STATEMENTS/.test(sample)) {
    return 'AUDITED_FINANCIAL_STATEMENTS';
  }
  return 'UNKNOWN';
}

async function classifyUnknownDocument(text: string, originalName: string): Promise<SupportedDocumentType> {
  const value = await requestJson(
    `${COMMON_RULES}\nClassify the document into exactly one supported documentType.`,
    JSON.stringify({
      originalName,
      supportedDocumentTypes: SUPPORTED_TYPES,
      text: text.slice(0, 35_000),
      outputShape: { documentType: 'ONE_SUPPORTED_VALUE' }
    })
  ) as { documentType?: string };

  if (!SUPPORTED_TYPES.includes(value.documentType as SupportedDocumentType)) {
    throw new Error(`Unsupported or unrecognized document type: ${value.documentType ?? 'UNKNOWN'}`);
  }
  return value.documentType as SupportedDocumentType;
}

function relevantExcerpt(text: string, type: SupportedDocumentType) {
  if (text.length <= 120_000) return text;

  const keywords: Record<SupportedDocumentType, string[]> = {
    ITR_ACKNOWLEDGEMENT: ['ACKNOWLEDGEMENT NUMBER', 'TOTAL INCOME', 'TOTAL TAX', 'TAXES PAID', 'REFUNDABLE'],
    ITR_FULL: [
      'PART A-GEN', 'ACKNOWLEDGEMENT NUMBER', 'KEY PERSONS', 'DIRECTOR', 'AUDIT INFORMATION',
      'PART A-BS', 'PART A-P&L', 'SCHEDULE BP', 'TOTAL INCOME', 'TAXES PAID'
    ],
    GSTR_1: ['FINANCIAL YEAR', 'TAX PERIOD', 'TOTAL LIABILITY', 'NIL RATED', 'CREDIT/DEBIT', 'AMENDMENT'],
    GSTR_1A: ['FINANCIAL YEAR', 'TAX PERIOD', 'GSTR-1A', 'TOTAL LIABILITY', 'CREDIT/DEBIT', 'AMENDMENT'],
    GSTR_3B: ['FINANCIAL YEAR', 'PERIOD', '3.1 DETAILS', 'ELIGIBLE ITC', 'INTEREST', 'TAX PAYMENT'],
    AUDITED_FINANCIAL_STATEMENTS: ['BALANCE SHEET', 'PROFIT AND LOSS', 'NOTES', 'UDIN', 'AMOUNT IN']
  };

  const ranges: Array<[number, number]> = [[0, 18_000]];
  const upper = text.toUpperCase();
  for (const keyword of keywords[type]) {
    let index = upper.indexOf(keyword);
    let matches = 0;
    while (index >= 0 && matches < 4) {
      ranges.push([Math.max(0, index - 2500), Math.min(text.length, index + 6500)]);
      index = upper.indexOf(keyword, index + keyword.length);
      matches += 1;
    }
  }

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }

  return merged.map(([start, end]) => text.slice(start, end)).join('\n\n--- SOURCE WINDOW ---\n\n').slice(0, 120_000);
}

function promptFor(type: SupportedDocumentType) {
  if (type === 'ITR_ACKNOWLEDGEMENT' || type === 'ITR_FULL') {
    return `${COMMON_RULES}\n${ITR_RULES}\nReturn every required field for ${type}. Use empty arrays for relationships, auditRecords, statementValues and provenance when absent.`;
  }
  if (type === 'GSTR_1' || type === 'GSTR_1A' || type === 'GSTR_3B') {
    return `${COMMON_RULES}\n${GST_RULES}\nReturn every required field for ${type}. Tax vectors contain igst, cgst, sgst and cess.`;
  }
  return `${COMMON_RULES}\n${FINANCIAL_RULES}\nReturn every required field for AUDITED_FINANCIAL_STATEMENTS.`;
}

function schemaFor(type: SupportedDocumentType) {
  switch (type) {
    case 'ITR_ACKNOWLEDGEMENT': return itrExtractionSchema;
    case 'ITR_FULL': return fullItrExtractionSchema;
    case 'GSTR_1': return gstr1ExtractionSchema;
    case 'GSTR_1A': return gstr1AExtractionSchema;
    case 'GSTR_3B': return gstr3BExtractionSchema;
    case 'AUDITED_FINANCIAL_STATEMENTS': return auditedFinancialStatementsExtractionSchema;
  }
}

export async function extractDocumentWithDeepSeek(text: string, originalName = ''): Promise<DocumentExtraction> {
  const detected = detectDocumentType(text, originalName);
  const documentType = detected === 'UNKNOWN'
    ? await classifyUnknownDocument(text, originalName)
    : detected;
  const excerpt = relevantExcerpt(text, documentType);
  const value = await requestJson(
    promptFor(documentType),
    JSON.stringify({ documentType, originalName, sourceText: excerpt })
  );
  return documentExtractionSchema.parse(schemaFor(documentType).parse(value));
}

export async function extractItrWithDeepSeek(text: string): Promise<ItrExtraction> {
  const value = await extractDocumentWithDeepSeek(text);
  if (value.documentType !== 'ITR_ACKNOWLEDGEMENT') {
    throw new Error(`Expected ITR acknowledgement but detected ${value.documentType}. Use consolidated bundle extraction.`);
  }
  return value;
}
