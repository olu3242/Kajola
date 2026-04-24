import { NextRequest } from 'next/server';
import { forwardToFunction } from '../../../_proxy';

export async function POST(req: NextRequest, { params }: { params: { bookingId: string } }) {
  return forwardToFunction(`bookings/${params.bookingId}/status`, req);
}

export async function PATCH(req: NextRequest, { params }: { params: { bookingId: string } }) {
  return forwardToFunction(`bookings/${params.bookingId}/status`, req);
}
