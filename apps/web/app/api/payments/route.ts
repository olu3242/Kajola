import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunction } from '../_proxy';
import { isLocalMode } from '@/lib/local-mode';
import { initPayment } from '@/lib/local-handlers';
import { getSessionUser } from '@/lib/session';

export async function POST(req: NextRequest) {
  if (isLocalMode) {
    const user = getSessionUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    const bookingId: string = body.bookingId ?? body.booking_id ?? '';
    if (!bookingId) {
      return NextResponse.json({ error: 'bookingId is required' }, { status: 400 });
    }
    const result = await initPayment(user, bookingId, body.method ?? 'bank_transfer', body.purpose);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ reference: result.reference, authorization_url: result.authorization_url });
  }
  return forwardToFunction('payments', req);
}
