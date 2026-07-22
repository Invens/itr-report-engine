import { itrExtractionSchema, type ItrExtraction } from '@itr/contracts';
import { env } from './config.js';

const SYSTEM_PROMPT = `You extract data from Indian Income Tax Return acknowledgement text.
Return JSON only. Never calculate or infer missing financial values.
Use exact source values. filingType must be ORIGINAL, REVISED, UPDATED, or UNKNOWN.
Dates should be ISO YYYY-MM-DD when possible.
Include short source evidence for every extracted field.
Output this shape:
{
  "documentType":"ITR_ACKNOWLEDGEMENT",
  "entityType":"INDIVIDUAL|COMPANY",
  "name":"...",
  "pan":"...",
  "assessmentYear":"YYYY-YY",
  "acknowledgementNumber":"...",
  "filingDate":"YYYY-MM-DD",
  "filingType":"ORIGINAL|REVISED|UPDATED|UNKNOWN",
  "totalIncome":0,
  "totalTaxInterestFeePayable":0,
  "totalTaxesPaid":0,
  "confidence":{"name":0,"pan":0,"assessmentYear":0,"acknowledgementNumber":0,"filingDate":0,"filingType":0,"totalIncome":0,"totalTaxInterestFeePayable":0,"totalTaxesPaid":0},
  "evidence":{}
}`;

export async function extractItrWithDeepSeek(text: string): Promise<ItrExtraction> {
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
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text.slice(0, 120000) }
      ]
    }),
    signal: AbortSignal.timeout(90_000)
  });

  if (!response.ok) {
    throw new Error(`DeepSeek request failed (${response.status}): ${await response.text()}`);
  }

  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned no content');
  return itrExtractionSchema.parse(JSON.parse(content));
}
