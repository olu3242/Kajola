import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunction } from '../../../_proxy';
import { isLocalMode } from '@/lib/local-mode';
import { updateBookingStatus } from '@/lib/local-handlers';
import { getSessionUser } from '@/lib/session';

async function handleStatusUpdate(
  req: NextRequest,
  params: { bookingId: string }
) {
  if (isLocalMode) {
    const user = getSessionUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    const newStatus: string = body.status ?? body.newStatus ?? '';
    if (!newStatus) {
      return NextResponse.json({ error: 'Missing status field in body' }, { status: 400 });
    }
    const result = await updateBookingStatus(user, params.bookingId, newStatus);
    if (result.error) {
      const status = result.error.startsWith('Forbidden') ? 403
        : result.error.startsWith('Cannot') ? 409
        : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ booking: result.booking });
  }
  return forwardToFunction(`bookings/${params.bookingId}/status`, req);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { bookingId: string } }
) {
  return handleStatusUpdate(req, params);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { bookingId: string } }
) {
  return handleStatusUpdate(req, params);
}
