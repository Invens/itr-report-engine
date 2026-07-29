import { ZodError } from 'zod';

export type ExtractionStage =
  | 'UPLOAD_VALIDATION'
  | 'UPLOAD_READ'
  | 'UPLOAD_PERSISTENCE'
  | 'PDF_TEXT_EXTRACTION'
  | 'OCR_RENDER'
  | 'OCR_RECOGNITION'
  | 'DOCUMENT_CLASSIFICATION'
  | 'DEEPSEEK_REQUEST'
  | 'DEEPSEEK_RESPONSE'
  | 'MODEL_JSON_PARSE'
  | 'SCHEMA_VALIDATION'
  | 'DOCUMENT_PERSISTENCE'
  | 'UNKNOWN';

export type ExtractionErrorLog = {
  requestId: string;
  file: string;
  stage: ExtractionStage;
  code: string;
  message: string;
  errorName: string;
  timestamp: string;
  details?: unknown;
  stack?: string;
};

export class ExtractionPipelineError extends Error {
  readonly code: string;
  readonly stage: ExtractionStage;
  readonly details?: unknown;

  constructor(input: {
    code: string;
    stage: ExtractionStage;
    message: string;
    details?: unknown;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = 'ExtractionPipelineError';
    this.code = input.code;
    this.stage = input.stage;
    this.details = input.details;
  }
}

function errorCode(error: unknown) {
  if (error instanceof ExtractionPipelineError) return error.code;
  if (error instanceof ZodError) return 'MODEL_SCHEMA_VALIDATION_FAILED';
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const value = (error as { code?: unknown }).code;
    if (typeof value === 'string' && value.trim()) return value;
  }
  if (error instanceof SyntaxError) return 'INVALID_JSON';
  if (error instanceof Error && error.name === 'TimeoutError') return 'REQUEST_TIMEOUT';
  return 'EXTRACTION_FAILED';
}

function errorDetails(error: unknown) {
  if (error instanceof ExtractionPipelineError && error.details !== undefined) {
    return error.details;
  }
  if (error instanceof ZodError) {
    return {
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
        expected: 'expected' in issue ? issue.expected : undefined,
        received: 'received' in issue ? issue.received : undefined
      }))
    };
  }
  if (typeof error === 'object' && error !== null) {
    const candidate = error as Record<string, unknown>;
    const details: Record<string, unknown> = {};
    for (const key of ['errno', 'syscall', 'path', 'statusCode', 'signal', 'stderr']) {
      if (candidate[key] !== undefined) details[key] = candidate[key];
    }
    return Object.keys(details).length ? details : undefined;
  }
  return undefined;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown extraction failure';
  }
}

export function toExtractionErrorLog(input: {
  error: unknown;
  requestId: string;
  file: string;
  fallbackStage: ExtractionStage;
  includeStack?: boolean;
}): ExtractionErrorLog {
  const stage = input.error instanceof ExtractionPipelineError
    ? input.error.stage
    : input.error instanceof ZodError
      ? 'SCHEMA_VALIDATION'
      : input.fallbackStage;
  const errorName = input.error instanceof Error ? input.error.name : typeof input.error;
  const stack = input.includeStack && input.error instanceof Error
    ? input.error.stack?.split('\n').slice(0, 18).join('\n')
    : undefined;

  return {
    requestId: input.requestId,
    file: input.file,
    stage,
    code: errorCode(input.error),
    message: errorMessage(input.error),
    errorName,
    timestamp: new Date().toISOString(),
    details: errorDetails(input.error),
    stack
  };
}

export function wrapExtractionError(input: {
  error: unknown;
  code: string;
  stage: ExtractionStage;
  message: string;
  details?: unknown;
}) {
  if (input.error instanceof ExtractionPipelineError) return input.error;
  return new ExtractionPipelineError({
    code: input.code,
    stage: input.stage,
    message: input.message,
    details: input.details,
    cause: input.error
  });
}
