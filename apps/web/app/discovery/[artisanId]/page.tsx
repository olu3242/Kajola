'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Badge, ButtonLink, Card, EmptyState, Skeleton } from '../../components/ui';
import { PublicShell } from '../../components/shells';

type Provider = { id: string; business_name: string; category: string; city: string; state?: string; avg_rating: number; total_reviews: number; completed_jobs: number; is_verified: boolean; full_name: string; image_url?: string; about?: string; address?: string; specialties?: string[]; gallery_urls?: string[]; };
type Review = { id: string; rating: number; comment: string; created_at: string; };
type Service = { id: string; name: string; duration_minutes: number; price_kobo: number; category_id?: string; service_type?: string; };

function formatCity(value: string) { return value.split('-').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' '); }

export default function ProviderDetailPage() {
  const params = useParams<{ artisanId: string }>();
  const id = params?.artisanId ?? '';
  const [provider, setProvider] = useState<Provider | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetch(`/api/artisans/${id}`).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; }),
      fetch(`/api/artisans/${id}/reviews`).then((response) => response.json()),
      fetch(`/api/artisans/${id}/services`).then((response) => response.json()),
    ]).then(([providerData, reviewData, serviceData]) => {
      setProvider(providerData.artisan);
      setReviews(reviewData.reviews ?? []);
      setServices(serviceData.services ?? []);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Failed to load this provider.')).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PublicShell><Skeleton count={4} /></PublicShell>;
  if (error || !provider) return <PublicShell><Alert tone="error">{error || 'Provider not found.'}</Alert><p><Link href="/discovery">← Back to discovery</Link></p></PublicShell>;

  return (
    <PublicShell>
      <nav className="kj-breadcrumb" aria-label="Breadcrumb"><Link href="/discovery">Discovery</Link><span>/</span><span aria-current="page">{provider.business_name}</span></nav>
      <section className="kj-profile-hero">
        <div className="kj-profile-hero__image"><Image src={provider.image_url ?? '/landing/neighborhood-services.jpg'} alt={`${provider.business_name} profile`} fill priority sizes="180px" /></div>
        <div><div className="kj-row"><p className="kj-page-header__eyebrow">{provider.category}</p>{provider.is_verified ? <Badge tone="success">✓ Verified</Badge> : null}</div><h1>{provider.business_name}</h1><p className="kj-muted">{formatCity(provider.city)}, {provider.state ?? 'Nigeria'} · ★ {provider.avg_rating.toFixed(1)} ({provider.total_reviews} reviews)</p><ButtonLink href={`/discovery/${id}/services`} data-testid="book-now-btn">Choose a service →</ButtonLink></div>
      </section>

      {provider.gallery_urls?.length ? <div className="kj-profile-gallery" aria-label={`${provider.business_name} gallery`}>{provider.gallery_urls.map((url, index) => <span key={`${url}-${index}`}><Image src={url} alt={`${provider.business_name} work sample ${index + 1}`} fill sizes="(max-width: 720px) 50vw, 360px" /></span>)}</div> : null}

      <div className="kj-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))' }}>
        <Card><p className="kj-page-header__eyebrow">About</p><h2 className="kj-heading-3">{provider.full_name}</h2><p className="kj-muted kj-small">{provider.about ?? `Primary professional · ${provider.completed_jobs} completed services`}</p>{provider.specialties?.length ? <p className="kj-small"><strong>Specialties:</strong> {provider.specialties.join(' · ')}</p> : null}</Card>
        <Card><p className="kj-page-header__eyebrow">Location</p><h2 className="kj-heading-3">{formatCity(provider.city)} branch</h2><p className="kj-muted kj-small">{provider.address ?? `${provider.state ?? 'Nigeria'}, Nigeria`}</p></Card>
        <Card><p className="kj-page-header__eyebrow">Booking policy</p><h2 className="kj-heading-3">Clear before confirmation</h2><p className="kj-muted kj-small">Your selected time, price, and applicable terms are shown before payment.</p></Card>
      </div>

      <section style={{ marginTop: 'var(--space-12)' }}><div className="kj-page-header"><div><p className="kj-page-header__eyebrow">Services</p><h2 className="kj-heading-2">Bookable services</h2></div><ButtonLink href={`/discovery/${id}/services`} variant="outline">View availability</ButtonLink></div>
        {services.length ? <div className="kj-grid kj-grid--cards">{services.map((service) => <Card key={service.id}><p className="kj-page-header__eyebrow">{service.service_type ?? provider.category}</p><div className="kj-row kj-row--between"><h3 className="kj-heading-3">{service.name}</h3><span className="kj-price">₦{(service.price_kobo / 100).toLocaleString()}</span></div><p className="kj-muted kj-small">{service.duration_minutes} minutes · {provider.full_name}</p><ButtonLink href={`/discovery/${id}/services/${service.id}/slots`} variant="outline">See availability</ButtonLink></Card>)}</div> : <EmptyState title="No services yet">This provider has not published bookable services.</EmptyState>}
      </section>

      <section style={{ marginTop: 'var(--space-12)' }}><p className="kj-page-header__eyebrow">Customer feedback</p><h2 className="kj-heading-2">Reviews</h2>
        <div className="kj-stack" style={{ marginTop: 'var(--space-5)' }}>{reviews.length ? reviews.map((review) => <Card key={review.id}><p aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(review.rating)}</p><p>{review.comment}</p><p className="kj-caption kj-muted">{new Date(review.created_at).toLocaleDateString('en-NG')}</p></Card>) : <EmptyState title="No written reviews yet">The verified aggregate rating is shown above.</EmptyState>}</div>
      </section>
    </PublicShell>
  );
}
