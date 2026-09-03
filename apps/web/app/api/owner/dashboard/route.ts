import { NextRequest, NextResponse } from 'next/server';
import { isLocalMode } from '@/lib/local-mode';
import { ownerDashboard } from '@/lib/local-handlers';
import { getSessionUser } from '@/lib/session';

export async function GET(req: NextRequest) {
  if (isLocalMode) {
    const user = getSessionUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden: owner role required' }, { status: 403 });
    }
    return NextResponse.json(ownerDashboard(user));
  }
  // No upstream equivalent yet — owner dashboard is local-only for now
  return NextResponse.json({ error: 'Owner dashboard not available in remote mode' }, { status: 501 });
}
