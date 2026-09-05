import { NextRequest, NextResponse } from 'next/server';
import { isLocalMode } from '@/lib/local-mode';
import { requestLocalAgentAction } from '@/lib/local-handlers';
import { getSessionUser } from '@/lib/session';
import { forwardToFunction } from '../../_proxy';

export async function POST(req: NextRequest) {
  if (!isLocalMode) return forwardToFunction('marketplace-operations/agent-action', req);
  const user = getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const result = requestLocalAgentAction(user, String(body.action_type ?? ''), Boolean(body.policy_passed), Boolean(body.human_approved));
  return NextResponse.json(result, { status: 'error' in result ? 403 : result.allowed ? 202 : 403 });
}
