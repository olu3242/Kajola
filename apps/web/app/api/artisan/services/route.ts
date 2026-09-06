import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunction } from '../../_proxy';
import { isLocalMode } from '@/lib/local-mode';
import { getSessionUser } from '@/lib/session';
import { addProviderServices } from '@/lib/local-handlers';

export async function POST(req: NextRequest) {
  if (isLocalMode) {
    const user = getSessionUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    const result = addProviderServices(user, Array.isArray(body.services) ? body.services : []);
    return NextResponse.json(result.error ? { error: result.error } : { services: result.services }, { status: result.error ? 400 : 200 });
  }
  return forwardToFunction('artisan_onboarding/services', req);
}
