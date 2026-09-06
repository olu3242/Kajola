import { NextRequest, NextResponse } from 'next/server';
import { isLocalMode } from '@/lib/local-mode';
import { forwardToFunction } from '../../_proxy';
import { attestLocalOfflinePayment } from '@/lib/local-handlers';
import { getSessionUser } from '@/lib/session';

export async function POST(req: NextRequest) {
  if (isLocalMode) {
    const user = getSessionUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    const result = attestLocalOfflinePayment(user, String(body.payment_id ?? ''), Number(body.declared_amount));
    return NextResponse.json(result, { status: result.error ? result.error === 'Forbidden' ? 403 : 404 : 200 });
  }
  return forwardToFunction('marketplace-operations/offline-attestation', req);
}
