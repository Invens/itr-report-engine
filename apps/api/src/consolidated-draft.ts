import {
  consolidatedReportSchema,
  type ConsolidatedReport,
  type DocumentExtraction,
  type ReportRow,
  type ReportTemplateConfig,
  type TaxVector
} from '@itr/contracts';
import {
  addTaxVectors,
  compareAmounts,
  normalizeLegalName,
  normalizeToRupees,
  selectLatestItrRows,
  sortTaxPeriods
} from './report-rules.js';

export type DraftSourceDocument = {
  documentId: string;
  extraction: DocumentExtraction;
};

export type DraftIssue = {
  code: string;
  severity: 'WARNING' | 'REVIEW_REQUIRED';
  message: string;
  documentIds: string[];
};

function isItr(value: DocumentExtraction): value is Extract<DocumentExtraction, { documentType: 'ITR_ACKNOWLEDGEMENT' | 'ITR_FULL' }> {
  return value.documentType === 'ITR_ACKNOWLEDGEMENT' || value.documentType === 'ITR_FULL';
}

function isGst(value: DocumentExtraction): value is Extract<DocumentExtraction, { documentType: 'GSTR_1' | 'GSTR_1A' | 'GSTR_3B' }> {
  return value.documentType === 'GSTR_1' || value.documentType === 'GSTR_1A' || value.documentType === 'GSTR_3B';
}

function toReportRow(value: Extract<DocumentExtraction, { documentType: 'ITR_ACKNOWLEDGEMENT' | 'ITR_FULL' }>): ReportRow {
  return {
    acknowledgementNumber: value.acknowledgementNumber,
    filingDate: value.filingDate,
    filingSection: value.filingSection,
    filingType: value.filingType,
    assessmentYear: value.assessmentYear,
    totalIncome: value.totalIncome,
    currentYearBusinessLoss: value.currentYearBusinessLoss,
    totalTaxInterestFeePayable: value.totalTaxInterestFeePayable,
    totalTaxesPaid: value.totalTaxesPaid,
    refundOrDemand: value.refundOrDemand,
    originalAcknowledgementNumber: value.originalAcknowledgementNumber,
    originalFilingDate: value.originalFilingDate
  };
}

function latestByDate<T extends { arnDate: string }>(values: T[]) {
  return [...values].sort((a, b) => b.arnDate.localeCompare(a.arnDate))[0];
}

function taxVectorOrZero(value?: TaxVector): TaxVector {
  return value ?? { igst: 0, cgst: 0, sgst: 0, cess: 0 };
}

const FINANCIAL_ORDER = [
  'SHARE_CAPITAL', 'RESERVES_SURPLUS', 'SHARE_APPLICATION_MONEY', 'LONG_TERM_BORROWINGS',
  'DEFERRED_TAX_LIABILITIES', 'OTHER_LONG_TERM_LIABILITIES', 'LONG_TERM_PROVISIONS',
  'SHORT_TERM_BORROWINGS', 'TRADE_PAYABLES', 'OTHER_CURRENT_LIABILITIES', 'SHORT_TERM_PROVISIONS',
  'TOTAL_LIABILITIES', 'PROPERTY_PLANT_EQUIPMENT', 'INTANGIBLE_ASSETS', 'CAPITAL_WORK_IN_PROGRESS',
  'INVESTMENTS', 'DEFERRED_TAX_ASSETS', 'LONG_TERM_LOANS_ADVANCES', 'OTHER_NON_CURRENT_ASSETS',
  'CURRENT_INVESTMENTS', 'INVENTORIES', 'TRADE_RECEIVABLES', 'CASH_CASH_EQUIVALENTS',
  'SHORT_TERM_LOANS_ADVANCES', 'OTHER_CURRENT_ASSETS', 'TOTAL_ASSETS', 'REVENUE_FROM_OPERATIONS',
  'PROFIT_BEFORE_TAX', 'CURRENT_TAX_PROVISION', 'PROFIT_AFTER_TAX'
];

function financialSortKey(key: string) {
  const index = FINANCIAL_ORDER.indexOf(key.toUpperCase());
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

export function buildConsolidatedDraft(
  documents: DraftSourceDocument[],
  template: ReportTemplateConfig,
  reportDate: string
): { draft: ConsolidatedReport; issues: DraftIssue[] } {
  const issues: DraftIssue[] = [];
  const itrDocuments = documents.filter((item) => isItr(item.extraction));
  const companyCandidates = itrDocuments.filter((item) => item.extraction.entityType === 'COMPANY');

  if (companyCandidates.length === 0) {
    throw new Error('A company ITR acknowledgement or full ITR is required for a consolidated company report');
  }

  const companyCounts = new Map<string, number>();
  for (const item of companyCandidates) {
    companyCounts.set(item.extraction.pan, (companyCounts.get(item.extraction.pan) ?? 0) + 1);
  }
  const companyPan = [...companyCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const primaryCompanyDocuments = companyCandidates.filter((item) => item.extraction.pan === companyPan);
  const companyExtraction = [...primaryCompanyDocuments]
    .sort((a, b) => b.extraction.filingDate.localeCompare(a.extraction.filingDate))[0].extraction;
  const companyName = companyExtraction.name;

  const verifiedRelationships = new Map<string, { name: string; din?: string }>();
  for (const item of primaryCompanyDocuments) {
    if (item.extraction.documentType !== 'ITR_FULL') continue;
    for (const relationship of item.extraction.relationships) {
      if (relationship.pan) {
        verifiedRelationships.set(relationship.pan, { name: relationship.name, din: relationship.din });
      }
    }
  }

  const itrGroups = new Map<string, typeof itrDocuments>();
  for (const item of itrDocuments) {
    const current = itrGroups.get(item.extraction.pan) ?? [];
    current.push(item);
    itrGroups.set(item.extraction.pan, current);
  }

  const itrSections = [...itrGroups.entries()].map(([pan, items]) => {
    const latest = [...items].sort((a, b) => b.extraction.filingDate.localeCompare(a.extraction.filingDate))[0].extraction;
    const relation = verifiedRelationships.get(pan);
    const rows = selectLatestItrRows(items.map((item) => toReportRow(item.extraction)));
    const isCompany = pan === companyPan;

    if (!isCompany && !relation) {
      issues.push({
        code: 'DIRECTOR_RELATIONSHIP_UNVERIFIED',
        severity: 'WARNING',
        message: `${latest.name} is included in the company bundle but no PAN-matched director relationship was found in the supplied company ITR.`,
        documentIds: items.map((item) => item.documentId)
      });
    }

    return {
      sectionLabel: isCompany ? 'Company' : 'Director',
      clientName: latest.name,
      pan,
      entityType: latest.entityType,
      din: relation?.din ?? latest.din,
      relationshipStatus: isCompany ? 'DOCUMENT_VERIFIED' as const : relation ? 'DOCUMENT_VERIFIED' as const : 'UNVERIFIED' as const,
      rows
    };
  }).sort((a, b) => {
    if (a.pan === companyPan) return -1;
    if (b.pan === companyPan) return 1;
    return normalizeLegalName(a.clientName).localeCompare(normalizeLegalName(b.clientName));
  });

  const gstDocuments = documents.filter((item) => isGst(item.extraction) && item.extraction.pan === companyPan);
  const gstGroups = new Map<string, typeof gstDocuments>();
  for (const item of gstDocuments) {
    const current = gstGroups.get(item.extraction.gstin) ?? [];
    current.push(item);
    gstGroups.set(item.extraction.gstin, current);
  }

  const gstSections = [...gstGroups.entries()].map(([gstin, items]) => {
    const first = items[0].extraction;
    const periods = new Map<string, typeof items>();
    for (const item of items) {
      const current = periods.get(item.extraction.taxPeriod) ?? [];
      current.push(item);
      periods.set(item.extraction.taxPeriod, current);
    }

    const rows = [...periods.entries()].flatMap(([period, periodItems]) => {
      const gstr1 = latestByDate(periodItems.filter((item) => item.extraction.documentType === 'GSTR_1').map((item) => item.extraction));
      const gstr1a = latestByDate(periodItems.filter((item) => item.extraction.documentType === 'GSTR_1A').map((item) => item.extraction));
      const gstr3b = latestByDate(periodItems.filter((item) => item.extraction.documentType === 'GSTR_3B').map((item) => item.extraction));

      if (!gstr1 || !gstr3b) {
        issues.push({
          code: 'GST_RETURN_PAIR_MISSING',
          severity: 'REVIEW_REQUIRED',
          message: `${gstin} ${period} does not contain both GSTR-1 and GSTR-3B.`,
          documentIds: periodItems.map((item) => item.documentId)
        });
        return [];
      }

      const gstr1Value = gstr1.totalOutwardValue + (gstr1a?.totalOutwardValue ?? 0);
      const gstr1Tax = addTaxVectors(gstr1.outputTax, gstr1a?.outputTax);
      const comparison = compareAmounts(gstr1Value, gstr3b.totalOutwardValue, 0.01);
      if (comparison.status === 'MISMATCH') {
        issues.push({
          code: 'GST_RECONCILIATION_MISMATCH',
          severity: 'REVIEW_REQUIRED',
          message: `${gstin} ${period} GSTR-1 and GSTR-3B outward values differ by ${comparison.difference?.toFixed(2)}.`,
          documentIds: periodItems.map((item) => item.documentId)
        });
      }

      return [{
        period,
        gstr1TotalOutwardValue: gstr1Value,
        gstr3bTotalOutwardValue: gstr3b.totalOutwardValue,
        gstr1OutputTax: gstr1Tax,
        gstr3bOutputTax: taxVectorOrZero(gstr3b.outputTax),
        sourceDocumentIds: periodItems.map((item) => item.documentId)
      }];
    });

    return {
      gstin,
      stateCode: first.stateCode,
      stateName: first.stateName,
      financialYear: first.financialYear,
      rows: sortTaxPeriods(rows)
    };
  }).filter((section) => section.rows.length > 0)
    .sort((a, b) => a.stateCode.localeCompare(b.stateCode));

  const audited = documents.find((item) => item.extraction.documentType === 'AUDITED_FINANCIAL_STATEMENTS'
    && (!item.extraction.pan || item.extraction.pan === companyPan));
  const fullItr = primaryCompanyDocuments.find((item) => item.extraction.documentType === 'ITR_FULL');

  let balanceSheet: ConsolidatedReport['balanceSheet'];
  if (audited && fullItr?.extraction.documentType === 'ITR_FULL') {
    const auditedValues = new Map(audited.extraction.statementValues.map((value) => [value.key.toUpperCase(), value]));
    const itrValues = new Map(fullItr.extraction.statementValues.map((value) => [value.key.toUpperCase(), value]));
    const keys = new Set([...auditedValues.keys(), ...itrValues.keys()]);

    const rows = [...keys].map((key) => {
      const statement = auditedValues.get(key);
      const itr = itrValues.get(key);
      const statementValueRupees = statement ? normalizeToRupees(statement.sourceAmount, statement.sourceUnit) : null;
      const itrValueRupees = itr ? normalizeToRupees(itr.sourceAmount, itr.sourceUnit) : null;
      const comparison = compareAmounts(statementValueRupees, itrValueRupees, 1);

      if (comparison.status === 'MISMATCH') {
        issues.push({
          code: 'ITR_FINANCIAL_STATEMENT_MISMATCH',
          severity: 'REVIEW_REQUIRED',
          message: `${statement?.label ?? itr?.label ?? key} differs between audited financial statements and ITR-6 by ₹${Math.abs(comparison.difference ?? 0).toLocaleString('en-IN')}.`,
          documentIds: [audited.documentId, fullItr.documentId]
        });
      }

      return {
        key,
        particulars: statement?.label ?? itr?.label ?? key,
        section: statement?.section ?? itr?.section ?? 'ASSETS' as const,
        statementValueRupees,
        itrValueRupees,
        mappingTarget: itr?.label
      };
    }).sort((a, b) => {
      const sectionOrder = { LIABILITIES: 0, ASSETS: 1, PROFIT_AND_LOSS: 2 } as const;
      const sectionDifference = sectionOrder[a.section] - sectionOrder[b.section];
      if (sectionDifference !== 0) return sectionDifference;
      return financialSortKey(a.key) - financialSortKey(b.key) || a.particulars.localeCompare(b.particulars);
    });

    balanceSheet = {
      asOfDate: audited.extraction.asOfDate,
      assessmentYear: fullItr.extraction.assessmentYear,
      displayUnit: audited.extraction.detectedUnit,
      toleranceRupees: 1,
      rows
    };
  } else if (audited || fullItr) {
    issues.push({
      code: 'FINANCIAL_COMPARISON_SOURCE_MISSING',
      severity: 'WARNING',
      message: 'Both audited financial statements and the company full ITR are required for Balance Sheet/P&L comparison.',
      documentIds: [audited?.documentId, fullItr?.documentId].filter((value): value is string => Boolean(value))
    });
  }

  const subjectEntities = itrSections.map((section) => ({ name: section.clientName, pan: section.pan }));
  const remarks = issues
    .filter((issue) => issue.severity === 'REVIEW_REQUIRED')
    .map((issue) => ({
      entityPan: companyPan,
      type: issue.code,
      severity: 'REVIEW_REQUIRED' as const,
      text: issue.message
    }));

  const draft = consolidatedReportSchema.parse({
    ...template,
    companyName,
    companyPan,
    cin: companyExtraction.cin,
    reportDate,
    subjectEntities,
    itrSections,
    gstSections,
    balanceSheet,
    remarks
  });

  return { draft, issues };
}
