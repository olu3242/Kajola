import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunctionWithQuery } from '../../_proxy';

export async function GET(req: NextRequest, { params }: { params: { bookingId: string } }) {
  return forwardToFunctionWithQuery(`bookings/${params.bookingId}`, req);
}
