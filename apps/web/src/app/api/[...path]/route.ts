import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

const FORWARDED_REQUEST_HEADERS = [
  'cookie',
  'content-type',
  'accept',
  'authorization',
  'x-demo-role',
  'x-demo-sub-id',
  'x-request-id',
  'x-forwarded-for',
  'x-forwarded-proto',
  'user-agent',
] as const;

const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-encoding',
  'content-length',
  'set-cookie',
]);

function getApiOrigin(): string {
  const raw =
    process.env.API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:4000';
  return raw.replace(/\/+$/, '');
}

async function proxyRequest(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { path } = await context.params;
  const encodedPath = path.map((segment) => encodeURIComponent(segment)).join('/');
  const upstreamUrl = new URL(`/api/${encodedPath}${request.nextUrl.search}`, getApiOrigin());

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }

  const requestId =
    request.headers.get('x-request-id')?.trim() || crypto.randomUUID();
  headers.set('x-request-id', requestId);

  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const rawBody = await request.arrayBuffer();
    if (rawBody.byteLength > 0) {
      body = rawBody;
    } else {
      headers.delete('content-type');
    }
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch (err) {
    console.error('[api-proxy] Upstream request failed:', upstreamUrl.toString(), err);
    return NextResponse.json(
      { error: 'UpstreamUnavailable', message: 'Unable to reach Interstate Homes API service.' },
      { status: 502, headers: { 'x-request-id': requestId } }
    );
  }

  const responseHeaders = new Headers();
  upstreamRes.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_RESPONSE_HEADERS.has(key.toLowerCase())) {
      responseHeaders.append(key, value);
    }
  });
  if (!responseHeaders.has('x-request-id')) {
    responseHeaders.set('x-request-id', requestId);
  }

  const getSetCookie = (upstreamRes.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === 'function') {
    for (const cookie of getSetCookie.call(upstreamRes.headers)) {
      responseHeaders.append('set-cookie', cookie);
    }
  } else {
    const setCookie = upstreamRes.headers.get('set-cookie');
    if (setCookie) {
      responseHeaders.append('set-cookie', setCookie);
    }
  }

  if (upstreamRes.status === 204 || upstreamRes.status === 304) {
    return new NextResponse(null, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });
  }

  const responseBody = await upstreamRes.arrayBuffer();
  return new NextResponse(responseBody, {
    status: upstreamRes.status,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyRequest(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxyRequest(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxyRequest(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxyRequest(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxyRequest(request, context);
}
