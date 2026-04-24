import { NextRequest } from 'next/server';
import { forwardToFunction, forwardToFunctionWithQuery } from '../../_proxy';

export async function GET(req: NextRequest) {
  return forwardToFunctionWithQuery('revenue/subscriptions', req);
}

export async function POST(req: NextRequest) {
  return forwardToFunction('revenue/subscriptions', req);
}
