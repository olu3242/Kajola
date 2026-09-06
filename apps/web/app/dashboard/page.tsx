'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '../components/shells';
import { Alert, ButtonLink, EmptyState, PageHeader, Skeleton } from '../components/ui';

type Booking = { id: string; status: string; starts_at: string; service_name?: string; provider_name?: string; total_amount_kobo: number; deposit_amount_kobo: number; };

function statusTone(status: string) { return ['confirmed', 'completed'].includes(status) ? 'success' : ['held', 'awaiting_payment'].includes(status) ? 'warning' : ['cancelled', 'no_show', 'disputed'].includes(status) ? 'error' : 'info'; }

export default function DashboardPage() {
  const [bookings, setBookings] = useState<Booking[]>([]); const [loading, setLoading] = useState(true); const [message, setMessage] = useState('');
  useEffect(() => { fetch('/api/bookings').then((response) => response.json()).then((data) => { if (data.error === 'Unauthorized') setMessage('Sign in to view your bookings.'); else setBookings(data.bookings ?? []); }).catch(() => setMessage('Could not load your bookings.')).finally(() => setLoading(false)); }, []);
  return <AppShell persona="customer"><PageHeader eyebrow="Customer" title="My bookings" description="Your upcoming and completed Kajola services." action={<ButtonLink href="/discovery">Book a service</ButtonLink>} />
    {message ? <Alert tone="error">{message} <Link href="/auth/login?redirect=/dashboard">Sign in</Link></Alert> : loading ? <Skeleton /> : bookings.length === 0 ? <EmptyState title="No bookings yet">When you book a professional, the details will appear here.<br /><ButtonLink href="/discovery" variant="outline">Find a provider</ButtonLink></EmptyState> : <div className="kj-stack">{bookings.map((booking) => <Link className="kj-card kj-card--interactive" href={`/dashboard/bookings/${booking.id}`} key={booking.id} data-testid={`booking-${booking.id}`} style={{ textDecoration: 'none' }}><div className="kj-row kj-row--between"><h2 className="kj-heading-3">{booking.service_name ?? 'Service'}</h2><span className={`kj-badge kj-badge--${statusTone(booking.status)}`}>{booking.status.replace('_', ' ')}</span></div><p className="kj-muted kj-small">{booking.provider_name} · {new Date(booking.starts_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</p><p className="kj-small">Total ₦{(booking.total_amount_kobo / 100).toLocaleString()} · Deposit ₦{(booking.deposit_amount_kobo / 100).toLocaleString()}</p></Link>)}</div>}
  </AppShell>;
}
