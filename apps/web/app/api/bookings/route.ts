import { NextRequest } from 'next/server';
import { forwardToFunction, forwardToFunctionWithQuery } from '../_proxy';

export async function POST(req: NextRequest) {
  return forwardToFunction('bookings', req);
}

export async function GET(req: NextRequest) {
  return forwardToFunctionWithQuery('bookings', req);
}
