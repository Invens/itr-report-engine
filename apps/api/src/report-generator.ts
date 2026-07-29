import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx';
import {
  consolidatedReportSchema,
  individualReportSchema,
  type ConsolidatedReport,
  type IndividualReport
} from '@itr/contracts';
import { env } from './config.js';
import {
  compareAmounts,
  convertFromRupees,
  displayFilingType,
  formatIndianAmount,
  selectLatestItrRows,
  sortTaxPeriods
} from './report-rules.js';

type ParagraphAlignment = typeof AlignmentType[keyof typeof AlignmentType];

const inr = (value: number) => `${formatIndianAmount(value, 0)}/-`;
const decimalAmount = (value: number) => formatIndianAmount(value, 2);

function cell(text: string, bold = false, alignment: ParagraphAlignment = AlignmentType.CENTER) {
  return new TableCell({
    children: [new Paragraph({
      alignment,
      children: [new TextRun({ text, bold, size: 17 })]
    })],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1 },
      bottom: { style: BorderStyle.SINGLE, size: 1 },
      left: { style: BorderStyle.SINGLE, size: 1 },
      right: { style: BorderStyle.SINGLE, size: 1 }
    }
  });
}

function heading(text: string) {
  return new Paragraph({
    spacing: { before: 260, after: 100 },
    children: [new TextRun({ text, bold: true, size: 22 })]
  });
}

function spacer() {
  return new Paragraph('');
}

function monthName(period: string) {
  const [year, month] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { month: 'long' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

function templateHeader(data: Pick<ConsolidatedReport, 'udin' | 'reference' | 'reportDate' | 'bankName' | 'branchName' | 'address'>) {
  return [
    new Paragraph({ children: [new TextRun({ text: 'CONFIDENTIAL', bold: true, size: 22 })] }),
    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun(`UDIN No.: ${data.udin}`)] }),
    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun(`Ref: ${data.reference}`)] }),
    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun(`Dated: ${data.reportDate}`)] }),
    spacer(),
    new Paragraph('The Chief Manager,'),
    new Paragraph(`${data.bankName},`),
    new Paragraph(data.branchName),
    new Paragraph(data.address),
    spacer()
  ];
}

function itrTable(rows: ConsolidatedReport['itrSections'][number]['rows']) {
  const selectedRows = selectLatestItrRows(rows);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          'S. No.',
          'Acknowledgement No.',
          'Date of Filing',
          'Whether Original or Revised',
          'A.Y.',
          'Total Income as per ITR',
          'Total Tax, Interest and Fee Payable as per ITR',
          'Total Taxes Paid as per ITR'
        ].map((value) => cell(value, true))
      }),
      ...selectedRows.map((row, index) => new TableRow({
        children: [
          String(index + 1),
          row.acknowledgementNumber,
          row.filingDate,
          displayFilingType(row.filingType),
          row.assessmentYear,
          inr(row.totalIncome),
          inr(row.totalTaxInterestFeePayable),
          inr(row.totalTaxesPaid)
        ].map((value) => cell(value))
      }))
    ]
  });
}

function gstTable(section: ConsolidatedReport['gstSections'][number]) {
  const rows = sortTaxPeriods(section.rows);
  const totals = rows.reduce((value, row) => ({
    gstr1: value.gstr1 + row.gstr1TotalOutwardValue,
    gstr3b: value.gstr3b + row.gstr3bTotalOutwardValue
  }), { gstr1: 0, gstr3b: 0 });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          'S. No.',
          'Period',
          'Total Taxable Value as per GSTR-1',
          'Total Taxable Value as per GSTR-3B',
          'Remarks (Difference)'
        ].map((value) => cell(value, true))
      }),
      ...rows.map((row, index) => {
        const comparison = compareAmounts(
          row.gstr1TotalOutwardValue,
          row.gstr3bTotalOutwardValue,
          0.01
        );
        const remark = comparison.status === 'MISMATCH'
          ? decimalAmount(comparison.difference ?? 0)
          : '-';
        return new TableRow({
          children: [
            String(index + 1),
            monthName(row.period),
            decimalAmount(row.gstr1TotalOutwardValue),
            decimalAmount(row.gstr3bTotalOutwardValue),
            remark
          ].map((value) => cell(value))
        });
      }),
      new TableRow({
        children: [
          '',
          'TOTAL',
          decimalAmount(totals.gstr1),
          decimalAmount(totals.gstr3b),
          compareAmounts(totals.gstr1, totals.gstr3b, 0.01).status === 'MISMATCH'
            ? decimalAmount(totals.gstr1 - totals.gstr3b)
            : '-'
        ].map((value) => cell(value, true))
      })
    ]
  });
}

function financialDisplay(value: number | null, unit: 'RUPEES' | 'HUNDREDS' | 'LAKHS') {
  if (value === null || value === 0) return '-';
  return decimalAmount(convertFromRupees(value, unit));
}

function balanceSheetTable(section: NonNullable<ConsolidatedReport['balanceSheet']>) {
  const rows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        'S. No.',
        'Particulars',
        `As per financial statements as on ${section.asOfDate}`,
        `As per ITR-6 for A.Y. ${section.assessmentYear}`,
        'Remarks'
      ].map((value) => cell(value, true))
    })
  ];

  let serial = 1;
  for (const group of ['LIABILITIES', 'ASSETS', 'PROFIT_AND_LOSS'] as const) {
    const groupRows = section.rows.filter((row) => row.section === group);
    if (groupRows.length === 0) continue;
    rows.push(new TableRow({
      children: [
        '',
        group === 'PROFIT_AND_LOSS' ? 'PROFIT AND LOSS' : group,
        '',
        '',
        ''
      ].map((value) => cell(value, true, AlignmentType.LEFT))
    }));

    for (const row of groupRows) {
      const comparison = compareAmounts(
        row.statementValueRupees,
        row.itrValueRupees,
        section.toleranceRupees
      );
      let remark = '-';
      if (comparison.status === 'MISSING_SOURCE') remark = 'Review source';
      if (comparison.status === 'MISMATCH') {
        remark = financialDisplay(comparison.difference, section.displayUnit);
        if (row.sourceRemark) remark = `${remark} · ${row.sourceRemark}`;
      }

      rows.push(new TableRow({
        children: [
          `${serial}.`,
          row.particulars,
          financialDisplay(row.statementValueRupees, section.displayUnit),
          financialDisplay(row.itrValueRupees, section.displayUnit),
          remark
        ].map((value, index) => cell(
          value,
          false,
          index === 1 ? AlignmentType.LEFT : AlignmentType.CENTER
        ))
      }));
      serial += 1;
    }
  }

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

function signature(data: Pick<ConsolidatedReport, 'firmName' | 'firmDescription' | 'firmRegistration' | 'signerName' | 'signerDesignation' | 'membershipNumber'>) {
  return [
    spacer(),
    new Paragraph('Submitted for information and necessary action.'),
    spacer(),
    new Paragraph('Thanking you,'),
    new Paragraph('Yours faithfully,'),
    spacer(),
    new Paragraph(`For: ${data.firmName}`),
    new Paragraph(data.firmDescription),
    new Paragraph(data.firmRegistration),
    spacer(),
    new Paragraph(data.signerName),
    new Paragraph(data.signerDesignation),
    new Paragraph(data.membershipNumber)
  ];
}

async function persistDocument(doc: Document, safeName: string, suffix: string) {
  const buffer = await Packer.toBuffer(doc);
  const directory = join(env.STORAGE_DIR, 'reports');
  await mkdir(directory, { recursive: true });
  const outputKey = join('reports', `${safeName}_${Date.now()}_${suffix}.docx`);
  await writeFile(join(env.STORAGE_DIR, outputKey), buffer);
  return outputKey;
}

export async function generateIndividualReport(input: IndividualReport) {
  const data = individualReportSchema.parse(input);
  const assessmentYears = selectLatestItrRows(data.rows)
    .map((row) => `A.Y. ${row.assessmentYear}`)
    .join(' & ');
  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 720, right: 500, bottom: 720, left: 500 } } },
      children: [
        ...templateHeader(data),
        new Paragraph({
          children: [new TextRun({
            text: `Sub: - Report on Verification of ITR (Acknowledgement No.) of ${data.clientName.toUpperCase()}`,
            bold: true
          })]
        }),
        spacer(),
        new Paragraph(`As per your instructions we have verified acknowledgement number of Income Tax Return filed with the Income Tax Department www.incometax.gov.in for the ${assessmentYears} of ${data.clientName.toUpperCase()} having PAN No. ${data.pan}. We have found the same as correct.`),
        spacer(),
        new Paragraph('The Details of ITR Provided to us are as under:'),
        spacer(),
        itrTable(data.rows),
        ...signature(data)
      ]
    }]
  });

  const safeName = data.clientName.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
  return persistDocument(doc, safeName, 'ITR_Verification');
}

export async function generateConsolidatedReport(input: ConsolidatedReport) {
  const data = consolidatedReportSchema.parse(input);
  const subject = data.subjectEntities
    .map((entity, index) => `${index + 1}. ${entity.name}`)
    .join('\n');
  const children: Array<Paragraph | Table> = [
    ...templateHeader(data),
    new Paragraph({
      children: [new TextRun({
        text: `Sub: - Report on Verification of ITR, GST and Balance Sheet of\n${subject}`,
        bold: true
      })]
    })
  ];

  for (const section of data.itrSections) {
    const years = selectLatestItrRows(section.rows)
      .map((row) => `A.Y. ${row.assessmentYear}`)
      .join(' & ');
    children.push(
      heading(`${section.sectionLabel}: ${section.clientName.toUpperCase()} — PAN ${section.pan}`),
      new Paragraph(`As per your instructions we have verified acknowledgement number of Income Tax Return filed with the Income Tax Department www.incometax.gov.in for ${years} of ${section.clientName.toUpperCase()} having PAN No. ${section.pan}.`),
      spacer(),
      itrTable(section.rows)
    );
  }

  for (const section of data.gstSections) {
    children.push(
      heading(`GST Verification — ${section.stateName} (${section.gstin})`),
      new Paragraph(`We have verified the GSTR-1 and GSTR-3B returns for F.Y. ${section.financialYear}, April to March, for GSTIN ${section.gstin}. Values are extracted independently from each source return.`),
      spacer(),
      gstTable(section)
    );
  }

  if (data.balanceSheet) {
    const unitLabel = data.balanceSheet.displayUnit === 'LAKHS'
      ? 'Amount in Lakhs'
      : data.balanceSheet.displayUnit === 'HUNDREDS'
        ? 'Amount in Hundreds'
        : 'Amount in Rupees';
    children.push(
      heading('Balance Sheet and Profit and Loss Account Verification'),
      new Paragraph(`We have compared the audited financial statements of ${data.companyName.toUpperCase()} with the ITR-6 for the period ended ${data.balanceSheet.asOfDate}. ${unitLabel}.`),
      spacer(),
      balanceSheetTable(data.balanceSheet)
    );
  }

  if (data.remarks.length > 0) {
    children.push(heading('Observations Requiring Review'));
    for (const remark of data.remarks) {
      children.push(new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun({ text: `[${remark.severity}] ${remark.text}` })]
      }));
    }
  }

  children.push(...signature(data));

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 650, right: 420, bottom: 650, left: 420 } } },
      children
    }]
  });
  const safeName = data.companyName.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
  return persistDocument(doc, safeName, 'Consolidated_Verification');
}
