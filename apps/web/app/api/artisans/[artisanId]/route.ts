import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunctionWithQuery } from '../../_proxy';
import { isLocalMode } from '@/lib/local-mode';
import { getProvider } from '@/lib/local-handlers';

export async function GET(
  req: NextRequest,
  { params }: { params: { artisanId: string } }
) {
  if (isLocalMode) {
    const artisan = getProvider(params.artisanId);
    if (!artisan) {
      return NextResponse.json({ error: 'Artisan not found' }, { status: 404 });
    }
    return NextResponse.json({ artisan });
  }
  return forwardToFunctionWithQuery(`artisans/${params.artisanId}`, req);
}
