'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EmptyState, PageHeader, Skeleton } from '../../../../../components/ui';
import { PublicShell } from '../../../../../components/shells';

type Slot = { id: string; starts_at: string; ends_at: string; available: boolean; };

export default function SlotSelectionPage() {
  const params = useParams<{ artisanId: string; serviceId: string }>();
  const artisanId = params?.artisanId ?? '';
  const serviceId = params?.serviceId ?? '';
  const router = useRouter();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!artisanId || !serviceId) return;
    fetch(`/api/booking-slots?artisan_id=${artisanId}&service_id=${serviceId}`).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Could not load availability.'); setSlots((data.slots ?? []).filter((slot: Slot) => slot.available)); }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load availability.')).finally(() => setLoading(false));
  }, [artisanId, serviceId]);

  async function handleBook(slot: Slot) {
    setBooking(true); setError('');
    try {
      const response = await fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider_id: artisanId, service_id: serviceId, starts_at: slot.starts_at, ends_at: slot.ends_at }) });
      const data = await response.json();
      if (response.status === 401) { router.push(`/auth/login?redirect=/discovery/${artisanId}/services/${serviceId}/slots`); return; }
      if (!response.ok) throw new Error(data.error ?? 'Could not hold this time.');
      router.push(`/booking/${data.booking.id}/pay`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not hold this time.'); setBooking(false); }
  }

  return <PublicShell><nav className="kj-breadcrumb" aria-label="Breadcrumb"><Link href="/discovery">Discovery</Link><span>/</span><Link href={`/discovery/${artisanId}`}>Provider</Link><span>/</span><Link href={`/discovery/${artisanId}/services`}>Services</Link><span>/</span><span aria-current="page">Availability</span></nav><PageHeader eyebrow="Step 2 of 2" title="Pick a date and time" description="Times below come from this professional’s current availability. Selecting one begins the real booking hold." />
    {error ? <div className="kj-alert kj-alert--error" role="alert" style={{ marginBottom: 'var(--space-5)' }}>{error}</div> : null}
    {loading ? <Skeleton count={4} /> : slots.length === 0 ? <EmptyState title="No times available">Check back later or choose another service.</EmptyState> : <div className="kj-slot-grid">{slots.map((slot) => <button className="kj-slot" key={slot.id} onClick={() => handleBook(slot)} disabled={booking} data-testid={`slot-${slot.id}`}><strong>{new Date(slot.starts_at).toLocaleDateString('en-NG', { weekday: 'short', month: 'short', day: 'numeric' })}</strong><span>{new Date(slot.starts_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })} – {new Date(slot.ends_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</span></button>)}</div>}
  </PublicShell>;
}
