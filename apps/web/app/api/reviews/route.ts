import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunction } from '../_proxy';
import { isLocalMode } from '@/lib/local-mode';
import { submitReview } from '@/lib/local-handlers';
import { getSessionUser } from '@/lib/session';

export async function POST(req: NextRequest) {
  if (isLocalMode) {
    const user = getSessionUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    const result = await submitReview(user, body);
    if (result.error) {
      const status = result.error.startsWith('Forbidden') ? 403 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ review: result.review }, { status: 201 });
  }
  return forwardToFunction('reviews', req);
}
