'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EmptyState, PageHeader, Skeleton } from '../../../components/ui';
import { PublicShell } from '../../../components/shells';

type Service = { id: string; name: string; duration_minutes: number; price_kobo: number; };

export default function ServicesPage() {
  const params = useParams<{ artisanId: string }>();
  const artisanId = params?.artisanId ?? '';
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!artisanId) return;
    fetch(`/api/artisans/${artisanId}/services`).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Could not load services.'); setServices(data.services ?? []); }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load services.')).finally(() => setLoading(false));
  }, [artisanId]);

  return <PublicShell><nav className="kj-breadcrumb" aria-label="Breadcrumb"><Link href="/discovery">Discovery</Link><span>/</span><Link href={`/discovery/${artisanId}`}>Provider</Link><span>/</span><span aria-current="page">Services</span></nav><PageHeader eyebrow="Step 1 of 2" title="Choose a service" description="Select the service you want, then choose a real available time." />
    {loading ? <Skeleton /> : error ? <div className="kj-alert kj-alert--error" role="alert">{error}</div> : services.length === 0 ? <EmptyState title="No services listed">This provider has not published any services yet.</EmptyState> : <div className="kj-stack">{services.map((service) => <Link className="kj-card kj-card--interactive" key={service.id} href={`/discovery/${artisanId}/services/${service.id}/slots`} data-testid={`service-card-${service.id}`} style={{ textDecoration: 'none', color: 'inherit' }}><div className="kj-row kj-row--between"><div><h2 className="kj-heading-3">{service.name}</h2><p className="kj-muted kj-small">{service.duration_minutes} minutes · Select availability</p></div><span className="kj-price">₦{(service.price_kobo / 100).toLocaleString()} →</span></div></Link>)}</div>}
  </PublicShell>;
}
