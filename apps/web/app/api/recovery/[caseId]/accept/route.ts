import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunction } from '../../../_proxy';
import { isLocalMode } from '@/lib/local-mode';
import { getSessionUser } from '@/lib/session';
import { acceptRecoveryRecommendation } from '@/lib/local-handlers';

export async function POST(req: NextRequest, { params }: { params: { caseId: string } }) {
  if (!isLocalMode) return forwardToFunction(`recovery/${params.caseId}/accept`, req);
  const user = getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const result = await acceptRecoveryRecommendation(user, params.caseId, String(body.recommendation_id ?? ''));
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.error === 'Forbidden' ? 403 : 409 });
  return NextResponse.json(result);
}
