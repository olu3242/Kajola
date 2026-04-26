import { NextRequest } from 'next/server';
import { forwardToFunction } from '../../_proxy';

export async function POST(req: NextRequest) {
  return forwardToFunction('payments/retry', req);
}
