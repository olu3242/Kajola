import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunction } from '../../../_proxy';
import { isLocalMode } from '@/lib/local-mode';
import { getSessionUser } from '@/lib/session';
import { requestRecoveryRefund } from '@/lib/local-handlers';

export async function POST(req: NextRequest, { params }: { params: { caseId: string } }) {
  if (!isLocalMode) return forwardToFunction(`recovery/${params.caseId}/refund`, req);
  const user = getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = requestRecoveryRefund(user, params.caseId);
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.error === 'Forbidden' ? 403 : 404 });
  return NextResponse.json(result);
}
