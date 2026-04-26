import { NextRequest } from 'next/server';
import { forwardToFunctionWithQuery } from '../_proxy';

export async function GET(req: NextRequest) {
  return forwardToFunctionWithQuery('booking_slots', req);
}
