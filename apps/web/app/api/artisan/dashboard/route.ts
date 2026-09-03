import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunctionWithQuery } from '../../_proxy';
import { isLocalMode } from '@/lib/local-mode';
import { artisanDashboard } from '@/lib/local-handlers';
import { getSessionUser } from '@/lib/session';

export async function GET(req: NextRequest) {
  if (isLocalMode) {
    const user = getSessionUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'artisan') {
      return NextResponse.json({ error: 'Forbidden: artisan role required' }, { status: 403 });
    }
    return NextResponse.json(artisanDashboard(user));
  }
  return forwardToFunctionWithQuery('artisan_onboarding/dashboard', req);
}
