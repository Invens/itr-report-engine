import {
  consolidatedReportSchema,
  type ConsolidatedReport,
  type DocumentExtraction,
  type ReportRow,
  type ReportTemplateConfig,
  type StatementValue,
  type TaxCreditSummary,
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
  entityPan?: string;
  assessmentYear?: string;
  amount?: number;
  section?: string;
};

type ItrAcknowledgementExtraction = Extract<DocumentExtraction, { documentType: 'ITR_ACKNOWLEDGEMENT' }>;
type FullItrExtraction = Extract<DocumentExtraction, { documentType: 'ITR_FULL' }>;
type ItrDocumentExtraction = ItrAcknowledgementExtraction | FullItrExtraction;
type GstDocumentExtraction =
  | Extract<DocumentExtraction, { documentType: 'GSTR_1' }>
  | Extract<DocumentExtraction, { documentType: 'GSTR_1A' }>
  | Extract<DocumentExtraction, { documentType: 'GSTR_3B' }>;
type AuditedExtraction = Extract<DocumentExtraction, { documentType: 'AUDITED_FINANCIAL_STATEMENTS' }>;
type TdsExtraction = Extract<DocumentExtraction, { documentType: 'TDS_STATEMENT' }>;

type ItrSourceDocument = DraftSourceDocument & { extraction: ItrDocumentExtraction };
type FullItrSourceDocument = DraftSourceDocument & { extraction: FullItrExtraction };
type GstSourceDocument = DraftSourceDocument & { extraction: GstDocumentExtraction };
type AuditedSourceDocument = DraftSourceDocument & { extraction: AuditedExtraction };
type TdsSourceDocument = DraftSourceDocument & { extraction: TdsExtraction };

type FinancialSection = StatementValue['section'];
type FinancialComparisonRow = NonNullable<ConsolidatedReport['balanceSheet']>['rows'][number];
type RelationshipStatus = ConsolidatedReport['itrSections'][number]['relationshipStatus'];
type TaxCreditKey = Exclude<keyof TaxCreditSummary, 'total'>;

function isItrDocument(item: DraftSourceDocument): item is ItrSourceDocument {
  return item.extraction.documentType === 'ITR_ACKNOWLEDGEMENT'
    || item.extraction.documentType === 'ITR_FULL';
}

function isFullItrDocument(item: DraftSourceDocument): item is FullItrSourceDocument {
  return item.extraction.documentType === 'ITR_FULL';
}

function isGstDocument(item: DraftSourceDocument): item is GstSourceDocument {
  return item.extraction.documentType === 'GSTR_1'
    || item.extraction.documentType === 'GSTR_1A'
    || item.extraction.documentType === 'GSTR_3B';
}

function isAuditedDocument(item: DraftSourceDocument): item is AuditedSourceDocument {
  return item.extraction.documentType === 'AUDITED_FINANCIAL_STATEMENTS';
}

function isTdsDocument(item: DraftSourceDocument): item is TdsSourceDocument {
  return item.extraction.documentType === 'TDS_STATEMENT';
}

function isGstr1(item: GstSourceDocument): item is GstSourceDocument & {
  extraction: Extract<DocumentExtraction, { documentType: 'GSTR_1' }>;
} {
  return item.extraction.documentType === 'GSTR_1';
}

function isGstr1A(item: GstSourceDocument): item is GstSourceDocument & {
  extraction: Extract<DocumentExtraction, { documentType: 'GSTR_1A' }>;
} {
  return item.extraction.documentType === 'GSTR_1A';
}

function isGstr3B(item: GstSourceDocument): item is GstSourceDocument & {
  extraction: Extract<DocumentExtraction, { documentType: 'GSTR_3B' }>;
} {
  return item.extraction.documentType === 'GSTR_3B';
}

function toReportRow(value: ItrDocumentExtraction): ReportRow {
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

function latestByArnDate<T extends GstSourceDocument>(values: T[]): T | undefined {
  return [...values]
    .sort((a, b) => b.extraction.arnDate.localeCompare(a.extraction.arnDate))[0];
}

function latestItrDocument(values: ItrSourceDocument[]) {
  return [...values].sort((a, b) => {
    const dateDifference = b.extraction.filingDate.localeCompare(a.extraction.filingDate);
    if (dateDifference !== 0) return dateDifference;
    const rank = { UNKNOWN: 0, ORIGINAL: 1, BELATED: 2, REVISED: 3, UPDATED: 4 } as const;
    return rank[b.extraction.filingType] - rank[a.extraction.filingType];
  })[0];
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

const SECTION_ORDER: Record<FinancialSection, number> = {
  LIABILITIES: 0,
  ASSETS: 1,
  PROFIT_AND_LOSS: 2
};

const TAX_CREDIT_LABELS: Record<TaxCreditKey, string> = {
  tds: 'TDS',
  tcs: 'TCS',
  advanceTax: 'advance tax',
  selfAssessmentTax: 'self-assessment tax'
};

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
  const itrDocuments = documents.filter(isItrDocument);
  const companyCandidates = itrDocuments.filter((item) => item.extraction.entityType === 'COMPANY');

  if (companyCandidates.length === 0) {
    const individualNames = [...new Set(
      itrDocuments
        .filter((item) => item.extraction.entityType === 'INDIVIDUAL')
        .map((item) => `${item.extraction.name} (${item.extraction.pan})`)
    )];
    const detected = individualNames.length > 0
      ? ` Detected individual return(s): ${individualNames.join(', ')}.`
      : '';
    throw Object.assign(
      new Error(`This upload does not contain a company ITR. Company consolidated reports require at least one company ITR acknowledgement or full ITR.${detected} Use the Individual ITR workflow for personal returns.`),
      {
        statusCode: 422,
        code: 'COMPANY_ITR_REQUIRED',
        details: {
          detectedIndividualTaxpayers: individualNames,
          uploadedDocumentTypes: documents.map((item) => item.extraction.documentType)
        }
      }
    );
  }

  const companyCounts = new Map<string, number>();
  for (const item of companyCandidates) {
    const pan = item.extraction.pan;
    companyCounts.set(pan, (companyCounts.get(pan) ?? 0) + 1);
  }

  const companyPanEntry = [...companyCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!companyPanEntry) throw new Error('Unable to determine the primary company PAN');
  const companyPan = companyPanEntry[0];

  const primaryCompanyDocuments = companyCandidates.filter((item) => item.extraction.pan === companyPan);
  const companyDocument = [...primaryCompanyDocuments]
    .sort((a, b) => b.extraction.filingDate.localeCompare(a.extraction.filingDate))[0];
  if (!companyDocument) throw new Error('Unable to determine the primary company return');
  const companyExtraction = companyDocument.extraction;
  const companyName = companyExtraction.name;

  const verifiedRelationships = new Map<string, { name: string; din?: string }>();
  for (const item of primaryCompanyDocuments) {
    if (item.extraction.documentType !== 'ITR_FULL') continue;
    for (const relationship of item.extraction.relationships) {
      if (relationship.pan) {
        verifiedRelationships.set(relationship.pan, {
          name: relationship.name,
          din: relationship.din
        });
      }
    }
  }

  const itrGroups = new Map<string, ItrSourceDocument[]>();
  for (const item of itrDocuments) {
    const pan = item.extraction.pan;
    const current = itrGroups.get(pan) ?? [];
    current.push(item);
    itrGroups.set(pan, current);
  }

  const itrSections: ConsolidatedReport['itrSections'] = [...itrGroups.entries()].map(([pan, items]) => {
    const latestDocument = latestItrDocument(items);
    if (!latestDocument) throw new Error(`No ITR return found for PAN ${pan}`);
    const latest = latestDocument.extraction;
    const relation = verifiedRelationships.get(pan);
    const rows = selectLatestItrRows(items.map((item) => toReportRow(item.extraction)));
    const isCompany = pan === companyPan;
    const relationshipStatus: RelationshipStatus = isCompany || relation
      ? 'DOCUMENT_VERIFIED'
      : 'UNVERIFIED';

    if (!isCompany && !relation) {
      issues.push({
        code: 'DIRECTOR_RELATIONSHIP_UNVERIFIED',
        severity: 'WARNING',
        message: `${latest.name} is included in the company bundle but no PAN-matched director relationship was found in the supplied company ITR.`,
        documentIds: items.map((item) => item.documentId),
        entityPan: pan
      });
    }

    return {
      sectionLabel: isCompany ? 'Company' : 'Director',
      clientName: latest.name,
      pan,
      entityType: latest.entityType,
      din: relation?.din ?? latest.din,
      relationshipStatus,
      rows
    };
  }).sort((a, b) => {
    if (a.pan === companyPan) return -1;
    if (b.pan === companyPan) return 1;
    return normalizeLegalName(a.clientName).localeCompare(normalizeLegalName(b.clientName));
  });

  const gstDocuments = documents
    .filter(isGstDocument)
    .filter((item) => item.extraction.pan === companyPan);
  const gstGroups = new Map<string, GstSourceDocument[]>();
  for (const item of gstDocuments) {
    const gstin = item.extraction.gstin;
    const current = gstGroups.get(gstin) ?? [];
    current.push(item);
    gstGroups.set(gstin, current);
  }

  const gstSections: ConsolidatedReport['gstSections'] = [];
  for (const [gstin, items] of gstGroups.entries()) {
    const first = items[0];
    if (!first) continue;
    const periods = new Map<string, GstSourceDocument[]>();
    for (const item of items) {
      const period = item.extraction.taxPeriod;
      const current = periods.get(period) ?? [];
      current.push(item);
      periods.set(period, current);
    }

    const rows: ConsolidatedReport['gstSections'][number]['rows'] = [];
    for (const [period, periodItems] of periods.entries()) {
      const gstr1Source = latestByArnDate(periodItems.filter(isGstr1));
      const gstr1aSource = latestByArnDate(periodItems.filter(isGstr1A));
      const gstr3bSource = latestByArnDate(periodItems.filter(isGstr3B));

      if (!gstr1Source || !gstr3bSource) {
        issues.push({
          code: 'GST_RETURN_PAIR_MISSING',
          severity: 'REVIEW_REQUIRED',
          message: `${gstin} ${period} does not contain both GSTR-1 and GSTR-3B.`,
          documentIds: periodItems.map((item) => item.documentId),
          entityPan: companyPan,
          section: 'GST_RECONCILIATION'
        });
        continue;
      }

      const gstr1 = gstr1Source.extraction;
      const gstr1a = gstr1aSource?.extraction;
      const gstr3b = gstr3bSource.extraction;
      const gstr1Value = gstr1.totalOutwardValue + (gstr1a?.totalOutwardValue ?? 0);
      const gstr1Tax = addTaxVectors(gstr1.outputTax, gstr1a?.outputTax);
      const comparison = compareAmounts(gstr1Value, gstr3b.totalOutwardValue, 0.01);

      if (comparison.status === 'MISMATCH') {
        issues.push({
          code: 'GST_RECONCILIATION_MISMATCH',
          severity: 'REVIEW_REQUIRED',
          message: `${gstin} ${period} GSTR-1 and GSTR-3B outward values differ by ₹${Math.abs(comparison.difference ?? 0).toLocaleString('en-IN')}.`,
          documentIds: periodItems.map((item) => item.documentId),
          entityPan: companyPan,
          amount: Math.abs(comparison.difference ?? 0),
          section: 'GST_RECONCILIATION'
        });
      }

      rows.push({
        period,
        gstr1TotalOutwardValue: gstr1Value,
        gstr3bTotalOutwardValue: gstr3b.totalOutwardValue,
        gstr1OutputTax: gstr1Tax,
        gstr3bOutputTax: taxVectorOrZero(gstr3b.outputTax),
        sourceDocumentIds: periodItems.map((item) => item.documentId)
      });
    }

    if (rows.length > 0) {
      gstSections.push({
        gstin,
        stateCode: first.extraction.stateCode,
        stateName: first.extraction.stateName,
        financialYear: first.extraction.financialYear,
        rows: sortTaxPeriods(rows)
      });
    }
  }
  gstSections.sort((a, b) => a.stateCode.localeCompare(b.stateCode));

  const audited = documents
    .filter(isAuditedDocument)
    .find((item) => !item.extraction.pan || item.extraction.pan === companyPan);
  const fullItr = primaryCompanyDocuments.find(isFullItrDocument);

  let balanceSheet: ConsolidatedReport['balanceSheet'];
  if (audited && fullItr) {
    const auditedValues = new Map<string, StatementValue>(
      audited.extraction.statementValues.map((value) => [value.key.toUpperCase(), value])
    );
    const itrValues = new Map<string, StatementValue>(
      fullItr.extraction.statementValues.map((value) => [value.key.toUpperCase(), value])
    );
    const keys = new Set<string>([...auditedValues.keys(), ...itrValues.keys()]);

    const rows: FinancialComparisonRow[] = [...keys].map((key): FinancialComparisonRow => {
      const statement = auditedValues.get(key);
      const itr = itrValues.get(key);
      const statementValueRupees = statement
        ? normalizeToRupees(statement.sourceAmount, statement.sourceUnit)
        : null;
      const itrValueRupees = itr
        ? normalizeToRupees(itr.sourceAmount, itr.sourceUnit)
        : null;
      const comparison = compareAmounts(statementValueRupees, itrValueRupees, 1);

      if (comparison.status === 'MISMATCH') {
        issues.push({
          code: 'ITR_FINANCIAL_STATEMENT_MISMATCH',
          severity: 'REVIEW_REQUIRED',
          message: `${statement?.label ?? itr?.label ?? key} differs between audited financial statements and ITR-6 by ₹${Math.abs(comparison.difference ?? 0).toLocaleString('en-IN')}.`,
          documentIds: [audited.documentId, fullItr.documentId],
          entityPan: companyPan,
          assessmentYear: fullItr.extraction.assessmentYear,
          amount: Math.abs(comparison.difference ?? 0),
          section: statement?.section ?? itr?.section ?? 'FINANCIAL_STATEMENTS'
        });
      }

      return {
        key,
        particulars: statement?.label ?? itr?.label ?? key,
        section: statement?.section ?? itr?.section ?? 'ASSETS',
        statementValueRupees,
        itrValueRupees,
        mappingTarget: itr?.label
      };
    }).sort((a, b) => {
      const sectionDifference = SECTION_ORDER[a.section] - SECTION_ORDER[b.section];
      if (sectionDifference !== 0) return sectionDifference;
      return financialSortKey(a.key) - financialSortKey(b.key)
        || a.particulars.localeCompare(b.particulars);
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
      documentIds: [audited?.documentId, fullItr?.documentId]
        .filter((value): value is string => Boolean(value)),
      entityPan: companyPan,
      section: 'FINANCIAL_STATEMENTS'
    });
  }

  const taxStatements = documents.filter(isTdsDocument);
  for (const statement of taxStatements) {
    const matchingItrs = itrDocuments.filter((item) => (
      item.extraction.pan === statement.extraction.pan
      && item.extraction.assessmentYear === statement.extraction.assessmentYear
    ));
    const matchedItr = latestItrDocument(matchingItrs);

    if (!matchedItr) {
      issues.push({
        code: 'TAX_STATEMENT_ITR_MISSING',
        severity: 'WARNING',
        message: `Form 26AS for ${statement.extraction.name}, PAN ${statement.extraction.pan}, A.Y. ${statement.extraction.assessmentYear} has no matching ITR in this bundle.`,
        documentIds: [statement.documentId],
        entityPan: statement.extraction.pan,
        assessmentYear: statement.extraction.assessmentYear,
        section: 'TAX_CREDITS'
      });
      continue;
    }

    for (const key of ['tds', 'tcs', 'advanceTax', 'selfAssessmentTax'] as TaxCreditKey[]) {
      const statementAmount = statement.extraction.taxCredits[key];
      const itrAmount = matchedItr.extraction.taxCredits[key];
      const comparison = compareAmounts(statementAmount, itrAmount, 1);
      if (comparison.status !== 'MISMATCH') continue;

      const difference = statementAmount - itrAmount;
      const isMissingSelfAssessment = key === 'selfAssessmentTax'
        && itrAmount > statementAmount;
      const code = isMissingSelfAssessment
        ? 'SELF_ASSESSMENT_CHALLAN_NOT_FOUND'
        : key === 'tds'
          ? 'TDS_RECONCILIATION_MISMATCH'
          : 'TAX_CREDIT_RECONCILIATION_MISMATCH';
      const description = isMissingSelfAssessment
        ? `Self-assessment tax of ₹${itrAmount.toLocaleString('en-IN')} is claimed in the ITR but only ₹${statementAmount.toLocaleString('en-IN')} is visible in Form 26AS.`
        : `${TAX_CREDIT_LABELS[key]} differs for ${statement.extraction.name}, A.Y. ${statement.extraction.assessmentYear}: Form 26AS ₹${statementAmount.toLocaleString('en-IN')} versus ITR ₹${itrAmount.toLocaleString('en-IN')}.`;

      issues.push({
        code,
        severity: 'REVIEW_REQUIRED',
        message: description,
        documentIds: [statement.documentId, matchedItr.documentId],
        entityPan: statement.extraction.pan,
        assessmentYear: statement.extraction.assessmentYear,
        amount: Math.abs(difference),
        section: 'TAX_CREDITS'
      });
    }
  }

  const subjectEntities = itrSections.map((section) => ({
    name: section.clientName,
    pan: section.pan
  }));
  const remarks = issues
    .filter((issue) => issue.severity === 'REVIEW_REQUIRED')
    .map((issue) => ({
      entityPan: issue.entityPan ?? companyPan,
      assessmentYear: issue.assessmentYear,
      type: issue.code,
      section: issue.section,
      amount: issue.amount,
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
