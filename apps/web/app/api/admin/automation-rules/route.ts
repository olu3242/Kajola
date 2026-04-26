import { NextRequest } from 'next/server';
import { forwardToFunction, forwardToFunctionWithQuery } from '../../_proxy';

export async function GET(req: NextRequest) {
  return forwardToFunctionWithQuery('automation/rules', req);
}

export async function PATCH(req: NextRequest) {
  return forwardToFunction('automation/rules', req);
}
