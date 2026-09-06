import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunction, forwardToFunctionWithQuery } from '../../_proxy';
import { isLocalMode } from '@/lib/local-mode';

export async function GET(req: NextRequest) {
  if (isLocalMode) return NextResponse.json({ code: 'DURABLE_RUNTIME_REQUIRED' }, { status: 503 });
  return forwardToFunctionWithQuery('business-onboarding', req);
}

export async function PATCH(req: NextRequest) {
  if (isLocalMode) return NextResponse.json({ code: 'DURABLE_RUNTIME_REQUIRED' }, { status: 503 });
  return forwardToFunction('business-onboarding', req);
}

export async function PUT(req: NextRequest) {
  if (isLocalMode) return NextResponse.json({ code: 'DURABLE_RUNTIME_REQUIRED' }, { status: 503 });
  return forwardToFunction('business-onboarding', req);
}

export async function POST(req: NextRequest) {
  if (isLocalMode) return NextResponse.json({ code: 'DURABLE_RUNTIME_REQUIRED' }, { status: 503 });
  const action = new URL(req.url).searchParams.get('action');
  if (action !== 'publish') return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  return forwardToFunction('business-onboarding/publish', req);
}
