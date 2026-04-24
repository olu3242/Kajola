import { NextRequest } from 'next/server';
import { forwardToFunctionWithQuery } from '../../../_proxy';

export async function GET(req: NextRequest, { params }: { params: { artisanId: string } }) {
  return forwardToFunctionWithQuery(`artisans/${params.artisanId}/reviews`, req);
}
