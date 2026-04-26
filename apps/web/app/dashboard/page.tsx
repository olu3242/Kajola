'use client';

import { useEffect, useState } from 'react';

type Booking = {
  id: string;
  status: string;
  created_at: string;
  service: { name: string; price_cents: number; currency: string } | null;
  artisan: { business_name: string } | null;
  payments: Array<{ status: string; amount_cents: number }>;
};

export default function DashboardPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function load() {
      const token = typeof window !== 'undefined' ? window.localStorage.getItem('kajola_access_token') : null;
      if (!token) {
        setMessage('Sign in to view your bookings.');
        setLoading(false);
        return;
      }

      try {
        const res = await fetch('/api/bookings', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) {
          setMessage(data.error ?? 'Unable to load bookings');
        } else {
          setBookings(data.bookings ?? []);
        }
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Network error');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 860, margin: '0 auto' }}>
      <h1>My Bookings</h1>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>My Bookings</h1>
          <a href="/dashboard/payments" style={{ color: '#2563eb' }}>Payment history</a>
        </div>
        <a href="/logout" style={{ color: '#ef4444' }}>Log out</a>
      </div>
      {loading ? (
        <p>Loading…</p>
      ) : message ? (
        <p style={{ color: '#b91c1c' }}>{message}</p>
      ) : bookings.length === 0 ? (
        <p>No bookings found.</p>
      ) : (
        <div style={{ display: 'grid', gap: 20, marginTop: 24 }}>
          {bookings.map((booking) => (
            <div key={booking.id} style={{ padding: 20, borderRadius: 18, background: '#f8fafc', border: '1px solid #e5e7eb' }}>
              <h2 style={{ margin: 0 }}>{booking.service?.name ?? 'Service'}</h2>
              <p style={{ margin: '8px 0' }}>{booking.artisan?.business_name ?? 'Artisan'}</p>
              <p style={{ margin: '8px 0' }}>Status: {booking.status}</p>
              <p style={{ margin: '8px 0' }}>Amount: NGN {(booking.service?.price_cents ?? 0) / 100}</p>
              <p style={{ margin: '8px 0', color: '#6b7280' }}>{new Date(booking.created_at).toLocaleString()}</p>
              <a href={`/dashboard/bookings/${booking.id}`} style={{ color: '#2563eb' }}>View details</a>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
