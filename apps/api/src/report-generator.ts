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
import { individualReportSchema, type IndividualReport } from '@itr/contracts';
import { env } from './config.js';

const inr = (value: number) => `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)}/-`;
const cell = (text: string, bold = false) => new TableCell({
  children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, bold, size: 18 })] })],
  borders: {
    top: { style: BorderStyle.SINGLE, size: 1 },
    bottom: { style: BorderStyle.SINGLE, size: 1 },
    left: { style: BorderStyle.SINGLE, size: 1 },
    right: { style: BorderStyle.SINGLE, size: 1 }
  }
});

export async function generateIndividualReport(input: IndividualReport) {
  const data = individualReportSchema.parse(input);
  const assessmentYears = data.rows.map((row) => `A.Y. ${row.assessmentYear}`).join(' & ');
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          'S. No.',
          'Acknowledgement No.',
          'Date of Filing',
          'Whether Original or Revised',
          'A.Y.',
          'Total Income as per ITR',
          'Total Tax Interest and fee payable as per ITR',
          'Total Taxes Paid as per ITR'
        ].map((value) => cell(value, true))
      }),
      ...data.rows.map((row, index) => new TableRow({
        children: [
          String(index + 1),
          row.acknowledgementNumber,
          row.filingDate,
          row.filingType,
          row.assessmentYear,
          inr(row.totalIncome),
          inr(row.totalTaxInterestFeePayable),
          inr(row.totalTaxesPaid)
        ].map((value) => cell(value))
      }))
    ]
  });

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 720, right: 500, bottom: 720, left: 500 } } },
      children: [
        new Paragraph({ children: [new TextRun({ text: 'CONFIDENTIAL', bold: true })] }),
        new Paragraph(`UDIN No.: ${data.udin}`),
        new Paragraph(`Ref: ${data.reference}`),
        new Paragraph(`Dated: ${data.reportDate}`),
        new Paragraph(''),
        new Paragraph('The Chief Manager,'),
        new Paragraph(`${data.bankName},`),
        new Paragraph(data.branchName),
        new Paragraph(data.address),
        new Paragraph(''),
        new Paragraph({
          children: [new TextRun({
            text: `Sub: - Report on Verification of ITR (Acknowledgement No.) of ${data.clientName.toUpperCase()}`,
            bold: true
          })]
        }),
        new Paragraph(''),
        new Paragraph('Dear Sir,'),
        new Paragraph(''),
        new Paragraph(`As per your instructions we have verified acknowledgement number of Income Tax Return filed with the Income Tax Department www.incometax.gov.in for the ${assessmentYears} of ${data.clientName.toUpperCase()} having PAN No ${data.pan}. We have found the same as correct.`),
        new Paragraph(''),
        new Paragraph('➢ The Details of ITR Provided to us is as under:'),
        new Paragraph(''),
        table,
        new Paragraph(''),
        new Paragraph('Submitted for information and necessary action.'),
        new Paragraph(''),
        new Paragraph('Thanking you,'),
        new Paragraph(''),
        new Paragraph('Yours faithfully,'),
        new Paragraph(`For: ${data.firmName}`),
        new Paragraph(data.firmDescription),
        new Paragraph(data.firmRegistration),
        new Paragraph(''),
        new Paragraph(data.signerName),
        new Paragraph(data.signerDesignation),
        new Paragraph(data.membershipNumber)
      ]
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  const directory = join(env.STORAGE_DIR, 'reports');
  await mkdir(directory, { recursive: true });
  const safeName = data.clientName.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
  const outputKey = join('reports', `${safeName}_${Date.now()}_ITR_Verification.docx`);
  await writeFile(join(env.STORAGE_DIR, outputKey), buffer);
  return outputKey;
}
