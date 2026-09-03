'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

type Booking = {
  id: string; status: string;
  total_amount_kobo: number; deposit_amount_kobo: number;
  starts_at: string; held_until: string | null;
};

export default function PayPage() {
  const params    = useParams<{ bookingId: string }>();
  const bookingId = params?.bookingId ?? '';
  const router    = useRouter();

  const [booking,  setBooking]  = useState<Booking | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [paying,   setPaying]   = useState(false);
  const [error,    setError]    = useState('');
  const [expired,  setExpired]  = useState(false);

  useEffect(() => {
    if (!bookingId) return;
    fetch(`/api/bookings/${bookingId}`)
      .then((r) => r.json())
      .then((d) => { setBooking(d.booking ?? null); setLoading(false); })
      .catch(() => setLoading(false));
  }, [bookingId]);

  // Count down to hold expiry
  useEffect(() => {
    if (!booking?.held_until) return;
    const check = () => setExpired(new Date(booking.held_until!) <= new Date());
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, [booking?.held_until]);

  async function handlePay() {
    setPaying(true);
    setError('');
    const res  = await fetch('/api/payments', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ bookingId }),
    });
    const data = await res.json();
    setPaying(false);
    if (!res.ok) { setError(data.error ?? 'Payment initiation failed.'); return; }
    // Redirect to Paystack (or local mock callback)
    window.location.href = data.authorization_url;
  }

  if (loading) return <main style={{ padding: 32 }}><p>Loading…</p></main>;

  if (!booking) return (
    <main style={{ padding: 32 }}>
      <p style={{ color: '#b91c1c' }}>Booking not found.</p>
      <a href="/discovery">Back to discovery</a>
    </main>
  );

  const deposit     = booking.deposit_amount_kobo / 100;
  const total       = booking.total_amount_kobo / 100;
  const heldUntil   = booking.held_until ? new Date(booking.held_until) : null;

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 500, margin: '0 auto' }}>
      <h1>Pay deposit</h1>

      {expired ? (
        <div style={{ padding: 16, background: '#fef2f2', borderRadius: 8, color: '#b91c1c' }}>
          <strong>Hold expired.</strong> Your slot was released.
          <br /><a href="/discovery" style={{ color: '#2563eb' }}>Pick a new slot</a>
        </div>
      ) : (
        <>
          <div style={{ padding: 20, background: '#f8fafc', borderRadius: 10, border: '1px solid #E5E7EB', marginTop: 16 }}>
            <p style={{ margin: 0, color: '#6B7280', fontSize: 13 }}>Appointment</p>
            <p style={{ margin: '4px 0 0', fontWeight: 600 }}>
              {new Date(booking.starts_at).toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' })}
            </p>
            {heldUntil && (
              <p style={{ marginTop: 8, fontSize: 13, color: '#D97706' }}>
                Slot held until {heldUntil.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
            <hr style={{ margin: '16px 0', borderColor: '#E5E7EB' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Service total</span><span>₦{total.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontWeight: 700, fontSize: 17 }}>
              <span>Deposit due now (30%)</span><span>₦{deposit.toLocaleString()}</span>
            </div>
          </div>

          {error && <p style={{ color: '#b91c1c', marginTop: 12 }}>{error}</p>}

          <button
            onClick={handlePay}
            disabled={paying}
            data-testid="pay-deposit-btn"
            style={{
              marginTop: 20, width: '100%', padding: '15px 0',
              borderRadius: 10, border: 'none', background: '#D9922A',
              color: '#fff', fontWeight: 700, fontSize: 16, cursor: 'pointer',
            }}
          >
            {paying ? 'Redirecting…' : `Pay ₦${deposit.toLocaleString()} deposit`}
          </button>

          <p style={{ marginTop: 12, fontSize: 12, color: '#9CA3AF', textAlign: 'center' }}>
            Secured by Paystack · Remaining balance paid after service
          </p>
        </>
      )}
    </main>
  );
}
