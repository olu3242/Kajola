'use client';

import { useEffect, useMemo, useState } from 'react';

type Payment = { status: string; amount_cents: number; reference?: string; provider_reference?: string };
type Booking = {
  id: string;
  status: string;
  payment_mode?: 'instant' | 'escrow';
  created_at: string;
  notes?: string;
  services?: { name: string; price_cents: number; currency: string };
  service?: { name: string; price_cents: number; currency: string };
  artisans?: { business_name: string };
  artisan?: { business_name: string };
  payments?: Payment[];
  escrow_accounts?: Array<{ status: string; amount: number; currency: string; milestones?: Array<{ name: string; status: string }> }>;
  reviews?: Array<{ id: string }>;
};

const reviewTags = ['fast', 'professional', 'clean', 'great_value', 'on_time', 'late', 'rude', 'poor_quality'];

export default function BookingDetailPage({ params }: { params: { bookingId: string } }) {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const service = booking?.services ?? booking?.service;
  const artisan = booking?.artisans ?? booking?.artisan;
  const payment = booking?.payments?.[0];
  const escrow = booking?.escrow_accounts?.[0];
  const timeline = booking?.payment_mode === 'escrow'
    ? ['pending', 'awaiting_payment', 'in_progress', 'completed']
    : ['pending', 'awaiting_payment', 'confirmed', 'completed'];
  const canCancel = booking && ['pending', 'awaiting_payment', 'confirmed', 'in_progress'].includes(booking.status);
  const canRetry = booking && ['pending', 'awaiting_payment'].includes(booking.status) && payment?.status !== 'successful';
  const appointmentText = useMemo(() => booking ? new Date(booking.created_at).toLocaleString() : '', [booking]);

  async function loadBooking(silent = false) {
    if (!silent) setLoading(true);
    const token = window.localStorage.getItem('kajola_access_token');
    if (!token) {
      setError('Sign in to view this booking');
      setLoading(false);
      return;
    }
    const res = await fetch(`/api/bookings/${params.bookingId}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Unable to load booking');
    else {
      setBooking(data.booking);
      setError('');
    }
    setLoading(false);
  }

  useEffect(() => {
    loadBooking();
  }, [params.bookingId]);

  useEffect(() => {
    if (!booking || booking.status !== 'awaiting_payment') return;
    const id = window.setInterval(() => loadBooking(true), 4000);
    return () => window.clearInterval(id);
  }, [booking?.status, params.bookingId]);

  async function cancelBooking() {
    setSubmitting(true);
    setError('');
    const token = window.localStorage.getItem('kajola_access_token');
    const res = await fetch(`/api/bookings/${params.bookingId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'cancelled' })
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Unable to cancel booking');
    else setBooking(data.booking);
    setSubmitting(false);
  }

  async function retryPayment() {
    setSubmitting(true);
    setError('');
    const token = window.localStorage.getItem('kajola_access_token');
    const res = await fetch('/api/payments/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bookingId: params.bookingId })
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error ?? 'Unable to retry payment');
      return;
    }
    window.location.href = data.payment_url;
  }

  async function submitReview() {
    setSubmitting(true);
    setError('');
    const token = window.localStorage.getItem('kajola_access_token');
    const res = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ booking_id: params.bookingId, rating, comment, tags: selectedTags })
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Unable to submit review');
    else await loadBooking(true);
    setSubmitting(false);
  }

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 860, margin: '0 auto' }}>
      <a href="/dashboard" style={{ color: '#2563eb' }}>Back</a>
      <h1>Booking detail</h1>
      {loading ? <p>Loading...</p> : null}
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
      {booking ? (
        <section style={{ padding: 20, borderRadius: 8, background: '#f8fafc', border: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <h2 style={{ margin: 0 }}>{service?.name ?? 'Service'}</h2>
            <span style={{ padding: '6px 10px', borderRadius: 999, background: booking.status === 'confirmed' ? '#dcfce7' : '#fef3c7' }}>{booking.status}</span>
          </div>
          <p>Artisan: {artisan?.business_name ?? 'Assigned artisan'}</p>
          <p>Amount: {(service?.currency ?? 'NGN')} {((service?.price_cents ?? payment?.amount_cents ?? 0) / 100).toLocaleString()}</p>
          <p>Scheduled time: {appointmentText}</p>
          <p>Payment status: {payment?.status ?? 'pending'}</p>
          <p>Payment mode: {booking.payment_mode === 'escrow' ? 'Kajola Secure Escrow' : 'Instant direct payment'}</p>
          <div style={{ marginTop: 18, display: 'grid', gap: 8 }}>
            {timeline.map((step) => (
              <div key={step} style={{ color: timeline.indexOf(step) <= Math.max(timeline.indexOf(booking.status), 0) ? '#166534' : '#6b7280' }}>
                {step === booking.status ? '●' : '○'} {step}
              </div>
            ))}
          </div>
          {booking.payment_mode !== 'escrow' && booking.status === 'confirmed' ? (
            <div style={{ marginTop: 18 }}>
              <strong>Your artisan is confirmed</strong>
              <p>Payment sent to artisan. Contact them before arrival and keep your booking reference handy.</p>
            </div>
          ) : null}
          {booking.payment_mode === 'escrow' ? (
            <div style={{ marginTop: 18, padding: 16, border: '1px solid #d1d5db', borderRadius: 8, background: '#fff' }}>
              <strong>Kajola Secure Escrow</strong>
              <p>Funds held securely until work is completed.</p>
              <p>Status: {escrow?.status ?? (booking.status === 'in_progress' ? 'held' : 'pending')}</p>
              {(escrow?.milestones ?? [
                { name: 'Payment secured', status: booking.status === 'in_progress' ? 'completed' : 'pending' },
                { name: 'Work in progress', status: booking.status === 'in_progress' ? 'active' : 'pending' },
                { name: 'Release payout', status: 'pending' }
              ]).map((milestone) => (
                <div key={milestone.name}>{milestone.status === 'completed' ? '●' : '○'} {milestone.name}</div>
              ))}
            </div>
          ) : null}
          <div style={{ marginTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {canRetry ? <button onClick={retryPayment} disabled={submitting} style={{ padding: '12px 16px' }}>Retry payment</button> : null}
            {canCancel ? <button onClick={cancelBooking} disabled={submitting} style={{ padding: '12px 16px', background: '#ef4444', color: '#fff', border: 0 }}>Cancel booking</button> : null}
            <a href="/dashboard" style={{ padding: '12px 16px', background: '#111827', color: '#fff', textDecoration: 'none' }}>Contact artisan</a>
          </div>
          {booking.status === 'completed' && !booking.reviews?.length ? (
            <section style={{ marginTop: 24, padding: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <h3>Rate your experience</h3>
              <label>
                Rating
                <select value={rating} onChange={(event) => setRating(Number(event.target.value))} style={{ marginLeft: 8 }}>
                  {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} stars</option>)}
                </select>
              </label>
              <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Share what went well or what could improve" style={{ display: 'block', width: '100%', minHeight: 80, marginTop: 12 }} />
              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {reviewTags.map((tag) => (
                  <button key={tag} type="button" onClick={() => setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])} style={{ padding: '8px 10px', borderRadius: 999, border: '1px solid #d1d5db', background: selectedTags.includes(tag) ? '#dcfce7' : '#fff' }}>
                    {tag}
                  </button>
                ))}
              </div>
              <button onClick={submitReview} disabled={submitting} style={{ marginTop: 14, padding: '12px 16px' }}>Submit review</button>
            </section>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
