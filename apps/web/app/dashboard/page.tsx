'use client';

import { useEffect, useState } from 'react';

type Booking = {
  id: string; status: string; starts_at: string;
  service_name?: string; provider_name?: string;
  total_amount_kobo: number; deposit_amount_kobo: number;
};

const STATUS_COLOR: Record<string, string> = {
  held: '#fef3c7', awaiting_payment: '#fef3c7', confirmed: '#dcfce7',
  checked_in: '#dbeafe', in_progress: '#dbeafe', completed: '#f0fdf4',
  cancelled: '#f3f4f6', no_show: '#fef2f2', disputed: '#fef2f2',
};

export default function DashboardPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [message,  setMessage]  = useState('');

  useEffect(() => {
    fetch('/api/bookings')
      .then((r) => r.json())
      .then((d) => {
        if (d.error === 'Unauthorized') setMessage('Sign in to view your bookings.');
        else setBookings(d.bookings ?? []);
        setLoading(false);
      })
      .catch(() => { setMessage('Network error.'); setLoading(false); });
  }, []);

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 860, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>My Bookings</h1>
        <div style={{ display: 'flex', gap: 16 }}>
          <a href="/discovery" style={{ color: '#2563eb' }}>Book a service</a>
          <a href="/logout"    style={{ color: '#ef4444' }}>Log out</a>
        </div>
      </div>

      {message && (
        <div style={{ padding: 16, background: '#fef2f2', borderRadius: 8, color: '#b91c1c', marginBottom: 16 }}>
          {message} <a href="/auth/login?redirect=/dashboard" style={{ color: '#2563eb', marginLeft: 8 }}>Sign in</a>
        </div>
      )}

      {loading ? <p style={{ color: '#6B7280' }}>Loading…</p> :
        bookings.length === 0 && !message ? (
          <div style={{ textAlign: 'center', marginTop: 48, color: '#6B7280' }}>
            <p style={{ fontSize: 18 }}>No bookings yet.</p>
            <a href="/discovery" style={{ color: '#D9922A', fontWeight: 600 }}>Find a provider →</a>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>
            {bookings.map((b) => (
              <a
                key={b.id}
                href={`/dashboard/bookings/${b.id}`}
                data-testid={`booking-${b.id}`}
                style={{
                  display: 'block', padding: 20, borderRadius: 12,
                  background: STATUS_COLOR[b.status] ?? '#f8fafc',
                  border: '1px solid #E5E7EB', textDecoration: 'none', color: '#111827',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0 }}>{b.service_name ?? 'Service'}</h3>
                  <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{b.status.replace('_', ' ')}</span>
                </div>
                <p style={{ margin: '6px 0 0', color: '#6B7280', fontSize: 14 }}>
                  {b.provider_name} · {new Date(b.starts_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
                <p style={{ margin: '4px 0 0', fontSize: 14 }}>
                  Total ₦{(b.total_amount_kobo / 100).toLocaleString()} · Deposit ₦{(b.deposit_amount_kobo / 100).toLocaleString()}
                </p>
              </a>
            ))}
          </div>
        )
      }
    </main>
  );
}
