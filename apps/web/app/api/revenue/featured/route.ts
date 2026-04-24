import { NextRequest } from 'next/server';
import { forwardToFunction, forwardToFunctionWithQuery } from '../../_proxy';

export async function GET(req: NextRequest) {
  return forwardToFunctionWithQuery('revenue/featured', req);
}

export async function POST(req: NextRequest) {
  return forwardToFunction('revenue/featured', req);
}
