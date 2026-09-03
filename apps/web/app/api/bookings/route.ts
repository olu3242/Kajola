import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunction, forwardToFunctionWithQuery } from '../_proxy';
import { isLocalMode } from '@/lib/local-mode';
import { holdSlot, listBookings } from '@/lib/local-handlers';
import { getSessionUser } from '@/lib/session';

export async function POST(req: NextRequest) {
  if (isLocalMode) {
    const user = getSessionUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    const result = await holdSlot(user, body);
    if (result.error) {
      const status = result.error === 'Slot already taken' ? 409 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ booking: result.booking }, { status: 201 });
  }
  return forwardToFunction('bookings', req);
}

export async function GET(req: NextRequest) {
  if (isLocalMode) {
    const user = getSessionUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const bookings = listBookings(user);
    return NextResponse.json({ bookings });
  }
  return forwardToFunctionWithQuery('bookings', req);
}
