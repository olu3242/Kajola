import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunctionWithQuery } from '../../_proxy';
import { isLocalMode } from '@/lib/local-mode';
import { getSessionUser } from '@/lib/session';
import { store } from '@/lib/store';

export async function GET(req: NextRequest, { params }: { params: { caseId: string } }) {
  if (!isLocalMode) return forwardToFunctionWithQuery(`recovery/${params.caseId}`, req);
  const user = getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const recovery = store.recoveryCases.find((item) => item.id === params.caseId);
  const booking = recovery && store.bookings.find((item) => item.id === recovery.booking_id);
  if (!recovery || !booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (user.role === 'client' && booking.client_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (user.role !== 'client' && user.role !== 'admin' && booking.tenant_id !== user.tenant_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ recovery_case: recovery });
}
