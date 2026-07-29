import { fullItrExtractionSchema, itrExtractionSchema } from '@itr/contracts';
import { normalizeItrModelOutput } from './itr-model-normalization.js';

const ACK_MARKER = Symbol.for('itr-report-engine.itr-ack-schema-normalizer');
const FULL_MARKER = Symbol.for('itr-report-engine.itr-full-schema-normalizer');

function installNormalizer(
  schema: typeof itrExtractionSchema | typeof fullItrExtractionSchema,
  marker: symbol,
  documentType: 'ITR_ACKNOWLEDGEMENT' | 'ITR_FULL'
) {
  const schemaObject = schema as unknown as Record<PropertyKey, unknown>;
  if (schemaObject[marker]) return;

  const originalParse = schema.parse.bind(schema);
  Object.defineProperty(schema, 'parse', {
    configurable: true,
    value: ((input: unknown, params?: unknown) => originalParse(
      normalizeItrModelOutput(input, documentType),
      params as Parameters<typeof originalParse>[1]
    )) as typeof schema.parse
  });

  Object.defineProperty(schemaObject, marker, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  });
}

installNormalizer(itrExtractionSchema, ACK_MARKER, 'ITR_ACKNOWLEDGEMENT');
installNormalizer(fullItrExtractionSchema, FULL_MARKER, 'ITR_FULL');
