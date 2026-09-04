import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunction } from '../../_proxy';
import { isLocalMode } from '@/lib/local-mode';
import { getSessionUser } from '@/lib/session';
import { saveProviderOnboarding } from '@/lib/local-handlers';

export async function POST(req: NextRequest) {
  if (isLocalMode) {
    const user = getSessionUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const result = saveProviderOnboarding(user, await req.json());
    return NextResponse.json(result.error ? { error: result.error } : { profile: result.provider }, { status: result.error ? 400 : 200 });
  }
  return forwardToFunction('artisan_onboarding/onboarding', req);
}
