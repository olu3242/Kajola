'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { SERVICE_CATEGORIES } from '../../lib/service-taxonomy';
import { EmptyState, Input, NigeriaLocationOptions, PageHeader, Select, Skeleton } from '../components/ui';
import { PublicShell } from '../components/shells';

type Provider = {
  id: string; business_name: string; category: string; city: string; state?: string;
  avg_rating: number; total_reviews: number; completed_jobs: number; is_verified: boolean;
  image_url?: string; starting_price_kobo?: number | null; earliest_availability?: string | null;
  available_services?: string[];
};

function formatLocation(value: string) {
  return value.split('-').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');
}

function ProviderCard({ provider }: { provider: Provider }) {
  return <Link className="kj-card kj-card--interactive kj-provider-card" href={`/discovery/${provider.id}`} data-testid={`provider-card-${provider.id}`}>
    <span className="kj-provider-card__image"><Image src={provider.image_url ?? '/landing/neighborhood-services.jpg'} alt={`${provider.business_name} profile`} fill sizes="112px" /></span>
    <span><span className="kj-row"><h2>{provider.business_name}</h2>{provider.is_verified ? <span className="kj-badge kj-badge--success">✓ Verified</span> : null}</span><p>{provider.category} · {formatLocation(provider.city)}, {provider.state ?? 'Nigeria'}</p><span className="kj-provider-card__meta"><span>★ {provider.avg_rating.toFixed(1)} ({provider.total_reviews})</span><span>{provider.completed_jobs} completed</span><span>{provider.earliest_availability ? `Next ${new Date(provider.earliest_availability).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' })}` : 'Contact for availability'}</span></span>{provider.available_services?.length ? <span className="kj-provider-card__services">{provider.available_services.map((service) => <span key={service}>{service}</span>)}</span> : null}</span>
    <span className="kj-price">{provider.starting_price_kobo ? <>From ₦{(provider.starting_price_kobo / 100).toLocaleString()}</> : 'View services'}<b>Book →</b></span>
  </Link>;
}

function DiscoveryResults() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [related, setRelated] = useState(false);
  const [city, setCity] = useState(searchParams.get('city') ?? '');
  const [category, setCategory] = useState(searchParams.get('category') ?? '');
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [rating, setRating] = useState(searchParams.get('rating') ?? '');
  const [maxPrice, setMaxPrice] = useState(searchParams.get('maxPrice') ?? '');
  const [available, setAvailable] = useState(searchParams.get('available') ?? '');

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (city) params.set('city', city);
    if (category) params.set('category', category);
    if (query.trim()) params.set('q', query.trim());
    if (rating) params.set('rating', rating);
    if (maxPrice) params.set('maxPrice', maxPrice);
    if (available) params.set('available', available);
    const nextQuery = params.toString();
    if (searchParams.toString() !== nextQuery) router.replace(`/discovery${nextQuery ? `?${nextQuery}` : ''}`, { scroll: false });
    setLoading(true); setError('');
    fetch(`/api/artisans?${nextQuery}`, { signal: controller.signal }).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Could not load providers.'); setProviders((data.artisans ?? []).filter((provider: Provider) => !available || provider.earliest_availability)); setRelated(Boolean(data.related)); }).catch((reason) => { if (reason.name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Could not load providers.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [available, category, city, maxPrice, query, rating, router, searchParams]);

  const heading = useMemo(() => {
    const service = query || category;
    const place = city ? formatLocation(city) : 'Nigeria';
    return service ? `${service} in ${place}` : `Discover trusted services in ${place}`;
  }, [category, city, query]);

  return <PublicShell wide>
    <PageHeader eyebrow="Kajola marketplace" title={heading} description="Compare verified businesses, services, prices, reputation, and real booking availability." />
    <div className="kj-filter-bar kj-filter-bar--marketplace" aria-label="Filter providers">
      <label className="kj-field">Search<Input aria-label="Search services or businesses" placeholder="Service, business, or provider" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="kj-field">Location<Select aria-label="Location" value={city} onChange={(event) => setCity(event.target.value)}><NigeriaLocationOptions /></Select></label>
      <label className="kj-field">Category<Select aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{SERVICE_CATEGORIES.map((item) => <option value={item.label} key={item.id}>{item.label}</option>)}</Select></label>
      <label className="kj-field">Minimum rating<Select aria-label="Minimum rating" value={rating} onChange={(event) => setRating(event.target.value)}><option value="">Any rating</option><option value="4">4.0+</option><option value="4.5">4.5+</option><option value="4.8">4.8+</option></Select></label>
      <label className="kj-field">Maximum price<Select aria-label="Maximum price" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)}><option value="">Any price</option><option value="5000">Up to ₦5,000</option><option value="10000">Up to ₦10,000</option><option value="20000">Up to ₦20,000</option></Select></label>
      <label className="kj-field">Availability<Select aria-label="Availability" value={available} onChange={(event) => setAvailable(event.target.value)}><option value="">Any availability</option><option value="1">Bookable now</option></Select></label>
    </div>
    {category === 'Other' ? <label className="kj-field kj-other-search">Describe the service you need<Input aria-label="Describe the service you need" placeholder="Tell us what you need and we’ll find related professionals" value={query} onChange={(event) => setQuery(event.target.value)} /></label> : null}
    {related ? <div className="kj-alert kj-alert--info" role="status">No exact match yet. Showing related professionals whose services may help.</div> : null}
    {loading ? <Skeleton /> : error ? <div className="kj-alert kj-alert--error" role="alert">{error} <button className="kj-button kj-button--ghost" onClick={() => window.location.reload()}>Try again</button></div> : providers.length === 0 ? <EmptyState title="No providers in this location yet">Try a nearby location or broaden your filters. Kajola only shows registered businesses.</EmptyState> : <div className="kj-stack" aria-live="polite">{providers.map((provider) => <ProviderCard key={provider.id} provider={provider} />)}</div>}
  </PublicShell>;
}

export default function DiscoveryPage() { return <Suspense fallback={<PublicShell wide><Skeleton /></PublicShell>}><DiscoveryResults /></Suspense>; }
