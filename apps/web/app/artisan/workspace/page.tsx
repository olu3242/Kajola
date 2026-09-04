'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '../../components/shells';
import { Alert, Button, EmptyState, PageHeader, Skeleton } from '../../components/ui';

type Booking = {
  id: string; status: string; booking_state?: string; hold_state?: string;
  starts_at: string; ends_at: string; service_name?: string; client_name?: string;
  total_amount_kobo: number; deposit_paid_at: string | null;
};
const transitions: Record<string, { label: string; next: string }[]> = {
  confirmed: [{ label: 'Check in customer', next: 'checked_in' }],
  checked_in: [{ label: 'Start service', next: 'in_progress' }],
  in_progress: [{ label: 'Mark complete', next: 'completed' }, { label: 'Mark no-show', next: 'no_show' }],
};
function statusTone(status: string) {
  return ['confirmed', 'completed'].includes(status) ? 'success' : ['no_show', 'cancelled', 'expired'].includes(status) ? 'error' : 'info';
}
function calendarLabel(booking: Booking) {
  if (booking.status === 'completed') return 'completed';
  if (booking.status === 'checked_in') return 'checked in';
  if (booking.status === 'in_progress') return 'in progress';
  if (booking.hold_state === 'ACTIVE' || ['held', 'awaiting_payment'].includes(booking.status)) return 'temporarily held';
  if (booking.hold_state === 'EXPIRED' || booking.status === 'expired') return 'expired';
  if (booking.status === 'cancelled') return 'cancelled';
  if (booking.booking_state === 'CONFIRMED' || booking.status === 'confirmed') return 'confirmed';
  return booking.status.replace('_', ' ');
}

export default function ArtisanWorkspacePage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acting, setActing] = useState<string | null>(null);
  async function loadBookings() {
    try {
      const response = await fetch('/api/bookings?role=artisan');
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 401 ? 'Sign in as a provider to view your workspace.' : data.error ?? 'Failed to load workspace.');
      const all = data.bookings ?? [];
      const order = ['in_progress', 'checked_in', 'confirmed', 'held', 'awaiting_payment', 'requires_recovery', 'completed', 'expired', 'no_show', 'cancelled'];
      all.sort((a: Booking, b: Booking) => order.indexOf(a.status) - order.indexOf(b.status) || new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
      setBookings(all);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to load workspace.');
    } finally { setLoading(false); }
  }
  useEffect(() => { loadBookings(); }, []);
  async function transition(bookingId: string, newStatus: string) {
    setActing(bookingId);
    const response = await fetch(`/api/bookings/${bookingId}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) });
    const data = await response.json(); setActing(null);
    if (!response.ok) { setError(data.error ?? 'Action failed.'); return; }
    setBookings((current) => current.map((booking) => booking.id === bookingId ? { ...booking, ...data.booking } : booking));
  }
  return <AppShell persona="provider">
    <PageHeader eyebrow="Provider operations" title="Today’s workspace" description="Held reservations are unavailable but remain distinct from confirmed appointments." />
    {error ? <Alert tone="error">{error}</Alert> : null}
    {loading ? <Skeleton /> : bookings.length === 0 ? <EmptyState title="No bookings yet">Share your profile to start receiving customer bookings.</EmptyState> : <div className="kj-stack">
      {bookings.map((booking) => <article className="kj-card" key={booking.id} data-testid={`workspace-booking-${booking.id}`}>
        <div className="kj-row kj-row--between"><div><h2 className="kj-heading-3">{booking.service_name ?? 'Service'}</h2>
          <p className="kj-muted kj-small">{booking.client_name ?? 'Customer'} · {new Date(booking.starts_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}–{new Date(booking.ends_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</p>
          <p className="kj-small">₦{(booking.total_amount_kobo / 100).toLocaleString()} · Deposit {booking.deposit_paid_at ? 'paid' : 'pending'}</p></div>
          <span className={`kj-badge kj-badge--${statusTone(booking.status)}`}>{calendarLabel(booking)}</span></div>
        {(transitions[booking.status] ?? []).length ? <div className="kj-row" style={{ marginTop: 'var(--space-4)', flexWrap: 'wrap' }}>
          {transitions[booking.status].map(({ label, next }) => <Button key={next} variant={next === 'no_show' ? 'destructive' : 'secondary'} onClick={() => transition(booking.id, next)} disabled={acting === booking.id} data-testid={`action-${booking.id}-${next}`}>{acting === booking.id ? 'Working…' : label}</Button>)}
        </div> : null}
      </article>)}
    </div>}
  </AppShell>;
}
