import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunctionWithQuery } from '../../../_proxy';
import { isLocalMode } from '@/lib/local-mode';
import { getProviderServices } from '@/lib/local-handlers';

export async function GET(
  req: NextRequest,
  { params }: { params: { artisanId: string } }
) {
  if (isLocalMode) {
    const services = getProviderServices(params.artisanId);
    return NextResponse.json({ services });
  }
  return forwardToFunctionWithQuery(`artisans/${params.artisanId}/services`, req);
}
