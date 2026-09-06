'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PaymentCallbackPage() {
  const router = useRouter();
  const [state,   setState]   = useState<'verifying' | 'success' | 'recovery' | 'failed'>('verifying');
  const [message, setMessage] = useState('Verifying payment…');

  useEffect(() => {
    async function verify() {
      const params    = new URLSearchParams(window.location.search);
      const reference = params.get('reference') ?? params.get('trxref') ?? '';
      const bookingId = params.get('bookingId') ?? params.get('booking_id') ?? '';

      if (!reference || !bookingId) {
        setState('failed');
        setMessage('Missing payment reference. Please contact support.');
        return;
      }

      const res  = await fetch('/api/payments/verify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reference, bookingId }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setState('failed');
        setMessage(data.error ?? 'Payment verification failed.');
        return;
      }

      const needsRecovery = data.booking?.booking_state === 'REQUIRES_RECOVERY'
        || data.booking?.recovery_state === 'REQUIRED' || data.booking?.recovery_state === 'AWAITING_CUSTOMER';
      setState(needsRecovery ? 'recovery' : 'success');
      setMessage(needsRecovery
        ? 'Payment received. Your original slot is no longer available, but your money is protected. Choose an alternative or request a refund.'
        : 'Payment confirmed! Your booking is confirmed.');
      setTimeout(() => router.replace(`/dashboard/bookings/${bookingId}`), 2000);
    }
    verify();
  }, [router]);

  const bg = state === 'success' ? '#dcfce7' : state === 'recovery' ? '#fffbeb' : state === 'failed' ? '#fef2f2' : '#f8fafc';
  const color = state === 'success' ? '#166534' : state === 'recovery' ? '#92400e' : state === 'failed' ? '#b91c1c' : '#374151';

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB' }}>
      <div style={{ padding: 32, borderRadius: 16, background: bg, maxWidth: 400, textAlign: 'center' }}>
        {state === 'verifying' && <div style={{ fontSize: 32 }}>⏳</div>}
        {state === 'success'   && <div style={{ fontSize: 32 }}>✅</div>}
        {state === 'recovery'  && <div style={{ fontSize: 32 }}>🛡️</div>}
        {state === 'failed'    && <div style={{ fontSize: 32 }}>❌</div>}
        <p style={{ color, marginTop: 12, fontWeight: 600, fontSize: 16 }} data-testid="payment-status">{message}</p>
        {state === 'failed' && (
          <a href="/discovery" style={{ display: 'inline-block', marginTop: 16, color: '#2563eb' }}>Back to discovery</a>
        )}
      </div>
    </main>
  );
}
