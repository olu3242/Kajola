'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

type Booking = {
  id: string; status: string; starts_at: string; ends_at: string;
  total_amount_kobo: number; deposit_amount_kobo: number;
  deposit_paid_at: string | null; service_name?: string; provider_name?: string;
  payment_ref?: string | null;
};

export default function BookingDetailPage() {
  const params    = useParams<{ bookingId: string }>();
  const bookingId = params?.bookingId ?? '';
  const router    = useRouter();

  const [booking,   setBooking]   = useState<Booking | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Review state
  const [rating,   setRating]   = useState(5);
  const [comment,  setComment]  = useState('');
  const [reviewed, setReviewed] = useState(false);

  // Gratuity state
  const [tipKobo,  setTipKobo]  = useState(50000); // ₦500
  const [tipped,   setTipped]   = useState(false);

  async function loadBooking() {
    const res  = await fetch(`/api/bookings/${bookingId}`);
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Unable to load');
    else setBooking(data.booking ?? null);
    setLoading(false);
  }

  useEffect(() => { if (bookingId) loadBooking(); }, [bookingId]);

  async function cancelBooking() {
    setSubmitting(true);
    const res  = await fetch(`/api/bookings/${bookingId}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) setError(data.error ?? 'Could not cancel');
    else setBooking(data.booking);
  }

  async function submitReview() {
    setSubmitting(true);
    const res  = await fetch('/api/reviews', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: bookingId, rating, comment }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) setError(data.error ?? 'Review failed');
    else setReviewed(true);
  }

  async function submitTip() {
    setSubmitting(true);
    const res  = await fetch('/api/gratuities', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: bookingId, amount_kobo: tipKobo }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) setError(data.error ?? 'Tip failed');
    else setTipped(true);
  }

  async function rebook() {
    if (!booking) return;
    router.push(`/discovery/${booking.provider_name?.replace(/\s+/g, '-').toLowerCase()}`);
  }

  if (loading) return <main style={{ padding: 32 }}><p>Loading…</p></main>;
  if (!booking) return <main style={{ padding: 32 }}><p style={{ color: '#b91c1c' }}>{error || 'Not found.'}</p><a href="/dashboard">Back</a></main>;

  const canCancel    = ['held', 'awaiting_payment', 'confirmed'].includes(booking.status);
  const isCompleted  = booking.status === 'completed';
  const depositPaid  = !!booking.deposit_paid_at;

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 700, margin: '0 auto' }}>
      <a href="/dashboard" style={{ color: '#2563eb', fontSize: 14 }}>← My bookings</a>

      <h1 style={{ marginTop: 16 }}>{booking.service_name ?? 'Booking'}</h1>

      <div style={{ padding: 20, background: '#f8fafc', borderRadius: 10, border: '1px solid #E5E7EB', marginTop: 16 }}>
        <p><strong>Provider:</strong> {booking.provider_name}</p>
        <p><strong>When:</strong> {new Date(booking.starts_at).toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' })}</p>
        <p><strong>Status:</strong> <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{booking.status.replace('_', ' ')}</span></p>
        <p><strong>Total:</strong> ₦{(booking.total_amount_kobo / 100).toLocaleString()}</p>
        <p><strong>Deposit:</strong> ₦{(booking.deposit_amount_kobo / 100).toLocaleString()} {depositPaid ? '✓ Paid' : '(not yet paid)'}</p>
        {booking.payment_ref && <p style={{ fontSize: 12, color: '#9CA3AF' }}>Ref: {booking.payment_ref}</p>}
      </div>

      {error && <p style={{ color: '#b91c1c', marginTop: 12 }}>{error}</p>}

      <div style={{ marginTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {canCancel && (
          <button onClick={cancelBooking} disabled={submitting} data-testid="cancel-booking-btn"
            style={{ padding: '12px 18px', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            Cancel booking
          </button>
        )}
        {isCompleted && (
          <button onClick={rebook}
            style={{ padding: '12px 18px', borderRadius: 8, border: '1px solid #D9922A', background: '#fff', color: '#D9922A', cursor: 'pointer', fontWeight: 600 }}>
            Book again
          </button>
        )}
      </div>

      {/* Gratuity */}
      {isCompleted && !tipped && (
        <section style={{ marginTop: 28, padding: 20, background: '#fffbeb', border: '1px solid #FCD34D', borderRadius: 10 }}>
          <h3 style={{ margin: 0 }}>Send a tip 💛</h3>
          <p style={{ color: '#78350F', fontSize: 14 }}>100% goes directly to your provider.</p>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            {[20000, 50000, 100000, 200000].map((amt) => (
              <button key={amt} onClick={() => setTipKobo(amt)}
                style={{ padding: '8px 16px', borderRadius: 999, border: `2px solid ${tipKobo === amt ? '#D9922A' : '#D1D5DB'}`, background: tipKobo === amt ? '#D9922A' : '#fff', color: tipKobo === amt ? '#fff' : '#111', cursor: 'pointer' }}>
                ₦{(amt / 100).toLocaleString()}
              </button>
            ))}
          </div>
          <button onClick={submitTip} disabled={submitting} data-testid="submit-tip-btn"
            style={{ marginTop: 14, padding: '12px 20px', borderRadius: 8, border: 'none', background: '#D9922A', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            Send ₦{(tipKobo / 100).toLocaleString()} tip
          </button>
        </section>
      )}
      {tipped && <p style={{ color: '#166534', marginTop: 12, fontWeight: 600 }}>✓ Tip sent! Thank you.</p>}

      {/* Review */}
      {isCompleted && !reviewed && (
        <section style={{ marginTop: 24, padding: 20, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10 }}>
          <h3 style={{ margin: 0 }}>Rate your experience</h3>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setRating(n)}
                style={{ fontSize: 24, background: 'none', border: 'none', cursor: 'pointer', opacity: n <= rating ? 1 : 0.3 }}>
                ⭐
              </button>
            ))}
          </div>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder="How was your experience?" data-testid="review-comment"
            style={{ display: 'block', width: '100%', minHeight: 80, marginTop: 12, padding: 10, borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, boxSizing: 'border-box' }} />
          <button onClick={submitReview} disabled={submitting} data-testid="submit-review-btn"
            style={{ marginTop: 12, padding: '12px 20px', borderRadius: 8, border: 'none', background: '#111827', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            Submit review
          </button>
        </section>
      )}
      {reviewed && <p style={{ color: '#166534', marginTop: 12, fontWeight: 600 }}>✓ Review submitted. Thank you!</p>}
    </main>
  );
}
