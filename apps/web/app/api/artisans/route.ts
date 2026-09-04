import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunctionWithQuery } from '../_proxy';
import { isLocalMode } from '@/lib/local-mode';
import { getAvailableSlots, getProviderServices, searchProviders } from '@/lib/local-handlers';

export async function GET(req: NextRequest) {
  if (isLocalMode) {
    const url = new URL(req.url);
    const city     = url.searchParams.get('city') ?? undefined;
    const category = url.searchParams.get('category') ?? undefined;
    const q        = url.searchParams.get('q') ?? undefined;
    const minRating = Number(url.searchParams.get('rating') ?? 0) || undefined;
    const maxPriceKobo = (Number(url.searchParams.get('maxPrice') ?? 0) || 0) * 100 || undefined;
    const limitRaw = url.searchParams.get('limit');
    const limit    = limitRaw ? parseInt(limitRaw, 10) : undefined;
    const search = searchProviders({ city, category, q, minRating, maxPriceKobo, limit });
    const artisans = search.providers.map((provider) => {
      const services = getProviderServices(provider.id);
      const available = services.flatMap((service) => getAvailableSlots(provider.id, service.id)).find((slot) => slot.available);
      return {
        ...provider,
        starting_price_kobo: services.length ? Math.min(...services.map((service) => service.price_kobo)) : null,
        earliest_availability: available?.starts_at ?? null,
        available_services: services.slice(0, 3).map((service) => service.name),
      };
    });
    return NextResponse.json({ artisans, related: search.related });
  }
  return forwardToFunctionWithQuery('artisans', req);
}
