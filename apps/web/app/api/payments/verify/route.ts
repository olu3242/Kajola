import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunction } from '../../_proxy';
import { isLocalMode } from '@/lib/local-mode';
import { verifyPayment } from '@/lib/local-handlers';
import { getSessionUser } from '@/lib/session';

export async function POST(req: NextRequest) {
  if (isLocalMode) {
    const user = getSessionUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'A JSON request body is required' }, { status: 400 });
    }
    const reference: string = body.reference ?? '';
    const bookingId: string = body.bookingId ?? body.booking_id ?? '';
    if (!reference || !bookingId) {
      return NextResponse.json({ error: 'reference and bookingId are required' }, { status: 400 });
    }
    const result = await verifyPayment(user, reference, bookingId);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ success: true, booking: result.booking });
  }
  return forwardToFunction('payments/verify', req);
}
