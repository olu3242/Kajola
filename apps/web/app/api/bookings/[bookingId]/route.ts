import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunctionWithQuery } from '../../_proxy';
import { isLocalMode } from '@/lib/local-mode';
import { store } from '@/lib/store';
import { getSessionUser } from '@/lib/session';
import { DEFAULT_COMMERCE_POLICY, quoteCheckout } from '@/lib/commerce';

export async function GET(req: NextRequest, { params }: { params: { bookingId: string } }) {
  if (isLocalMode) {
    const user = getSessionUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const booking = store.bookings.find((b) => b.id === params.bookingId);
    if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // RBAC
    if (user.role === 'client'  && booking.client_id   !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (user.role === 'artisan' && booking.provider_id  !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const provider = store.providers.find((p) => p.id === booking.provider_id);
    const service  = store.services.find((s) => s.id === booking.service_id);
    const policy = provider?.payment_policy ?? DEFAULT_COMMERCE_POLICY;
    const quote = quoteCheckout({ totalKobo: booking.total_amount_kobo, paidKobo: booking.amount_paid_kobo, policy });
    const recoveryCase = store.recoveryCases.find((item) => item.booking_id === booking.id) ?? null;
    return NextResponse.json({ booking: { ...booking, provider_name: provider?.business_name, service_name: service?.name, recovery_cases: recoveryCase ? [recoveryCase] : [] }, quote });
  }
  return forwardToFunctionWithQuery(`bookings/${params.bookingId}`, req);
}
