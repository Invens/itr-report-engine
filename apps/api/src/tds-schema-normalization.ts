import { tdsStatementExtractionSchema } from '@itr/contracts';
import { normalizeTdsStatementModelOutput } from './model-normalization.js';

const NORMALIZER_MARKER = Symbol.for('itr-report-engine.tds-schema-normalizer');
const schemaObject = tdsStatementExtractionSchema as unknown as Record<PropertyKey, unknown>;

if (!schemaObject[NORMALIZER_MARKER]) {
  const originalParse = tdsStatementExtractionSchema.parse.bind(tdsStatementExtractionSchema);

  Object.defineProperty(tdsStatementExtractionSchema, 'parse', {
    configurable: true,
    value: ((input: unknown, params?: unknown) => originalParse(
      normalizeTdsStatementModelOutput(input),
      params as Parameters<typeof originalParse>[1]
    )) as typeof tdsStatementExtractionSchema.parse
  });

  Object.defineProperty(schemaObject, NORMALIZER_MARKER, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  });
}
