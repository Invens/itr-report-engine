const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:4000';
const UPSTREAM_TIMEOUT_MS = 15 * 60 * 1000;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 900;

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

function copyRequestHeaders(request: Request) {
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('connection');
  headers.delete('content-length');
  return headers;
}

function copyResponseHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.delete('connection');
  headers.delete('content-length');
  headers.delete('transfer-encoding');
  return headers;
}

async function proxyRequest(request: Request, context: RouteContext) {
  const { path } = await context.params;
  const incomingUrl = new URL(request.url);
  const target = new URL(`/${path.join('/')}`, INTERNAL_API_URL);
  target.search = incomingUrl.search;

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null;
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers: copyRequestHeaders(request),
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
  };

  if (hasBody) init.duplex = 'half';

  try {
    const upstream = await fetch(target, init);
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: copyResponseHeaders(upstream)
    });
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
    const message = error instanceof Error ? error.message : 'Unknown upstream error';

    return Response.json({
      error: isTimeout
        ? 'The extraction service timed out while processing the documents.'
        : 'The extraction service connection was interrupted.',
      detail: process.env.NODE_ENV === 'production' ? undefined : message
    }, { status: isTimeout ? 504 : 502 });
  }
}

export function GET(request: Request, context: RouteContext) {
  return proxyRequest(request, context);
}

export function POST(request: Request, context: RouteContext) {
  return proxyRequest(request, context);
}

export function PUT(request: Request, context: RouteContext) {
  return proxyRequest(request, context);
}

export function PATCH(request: Request, context: RouteContext) {
  return proxyRequest(request, context);
}

export function DELETE(request: Request, context: RouteContext) {
  return proxyRequest(request, context);
}
