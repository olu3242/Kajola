import { NextRequest, NextResponse } from 'next/server';
import { isLocalMode } from '@/lib/local-mode';
import { reconcileLocalPayment } from '@/lib/local-handlers';
import { getSessionUser } from '@/lib/session';
import { forwardToFunction } from '../../_proxy';

export async function POST(req: NextRequest) {
  if (!isLocalMode) return forwardToFunction('marketplace-operations/reconcile', req);
  const user = getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const result = reconcileLocalPayment(user, String(body.booking_id ?? ''), body);
  return NextResponse.json(result, { status: result.error ? 403 : 200 });
}
