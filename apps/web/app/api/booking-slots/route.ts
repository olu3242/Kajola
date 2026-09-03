import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunctionWithQuery } from '../_proxy';
import { isLocalMode } from '@/lib/local-mode';
import { getAvailableSlots } from '@/lib/local-handlers';

export async function GET(req: NextRequest) {
  if (isLocalMode) {
    const url        = new URL(req.url);
    const providerId = url.searchParams.get('provider_id') ?? url.searchParams.get('artisan_id') ?? '';
    const serviceId  = url.searchParams.get('service_id') ?? '';
    if (!providerId || !serviceId) {
      return NextResponse.json({ error: 'provider_id and service_id are required' }, { status: 400 });
    }
    const slots = getAvailableSlots(providerId, serviceId);
    return NextResponse.json({ slots });
  }
  return forwardToFunctionWithQuery('booking_slots', req);
}
