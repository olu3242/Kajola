import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunctionWithQuery } from '../_proxy';
import { isLocalMode } from '@/lib/local-mode';
import { listProviders } from '@/lib/local-handlers';

export async function GET(req: NextRequest) {
  if (isLocalMode) {
    const url = new URL(req.url);
    const city     = url.searchParams.get('city') ?? undefined;
    const category = url.searchParams.get('category') ?? undefined;
    const limitRaw = url.searchParams.get('limit');
    const limit    = limitRaw ? parseInt(limitRaw, 10) : undefined;
    const artisans = listProviders({ city, category, limit });
    return NextResponse.json({ artisans });
  }
  return forwardToFunctionWithQuery('artisans', req);
}
