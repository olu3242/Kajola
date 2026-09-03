'use client';

import { useEffect, useState } from 'react';

type Booking = {
  id: string; status: string; starts_at: string; ends_at: string;
  service_name?: string; client_name?: string;
  total_amount_kobo: number; deposit_paid_at: string | null;
};

const TRANSITIONS: Record<string, { label: string; next: string }[]> = {
  confirmed:   [{ label: 'Check in customer', next: 'checked_in' }],
  checked_in:  [{ label: 'Start service',     next: 'in_progress' }],
  in_progress: [{ label: 'Mark complete',     next: 'completed' }, { label: 'Mark no-show', next: 'no_show' }],
};

const STATUS_BG: Record<string, string> = {
  confirmed: '#dcfce7', checked_in: '#dbeafe', in_progress: '#ede9fe',
  completed: '#f0fdf4', no_show: '#fef2f2', cancelled: '#f3f4f6',
};

export default function ArtisanWorkspacePage() {
  const [bookings,  setBookings]  = useState<Booking[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [acting,    setActing]    = useState<string | null>(null);

  async function loadBookings() {
    const res  = await fetch('/api/bookings?role=artisan');
    const data = await res.json();
    if (res.status === 401) { setError('Sign in as a provider to view your workspace.'); setLoading(false); return; }
    if (!res.ok)            { setError(data.error ?? 'Failed to load'); setLoading(false); return; }
    const all = data.bookings ?? [];
    // Sort: active first, then by starts_at
    const order = ['in_progress', 'checked_in', 'confirmed', 'completed', 'no_show', 'cancelled'];
    all.sort((a: Booking, b: Booking) => order.indexOf(a.status) - order.indexOf(b.status) || new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    setBookings(all);
    setLoading(false);
  }

  useEffect(() => { loadBookings(); }, []);

  async function transition(bookingId: string, newStatus: string) {
    setActing(bookingId);
    const res  = await fetch(`/api/bookings/${bookingId}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    const data = await res.json();
    setActing(null);
    if (!res.ok) { setError(data.error ?? 'Action failed'); return; }
    setBookings((prev) => prev.map((b) => b.id === bookingId ? { ...b, ...data.booking } : b));
  }

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 860, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>My Workspace</h1>
        <div style={{ display: 'flex', gap: 16 }}>
          <a href="/artisan/dashboard" style={{ color: '#2563eb' }}>Dashboard</a>
          <a href="/logout"           style={{ color: '#ef4444' }}>Log out</a>
        </div>
      </div>
      <p style={{ color: '#6B7280', marginTop: 4 }}>Today's bookings and actions</p>

      {error && <p style={{ color: '#b91c1c', background: '#fef2f2', padding: 12, borderRadius: 8 }}>{error}</p>}

      {loading ? <p>Loading…</p> : bookings.length === 0 ? (
        <p style={{ marginTop: 32, color: '#6B7280' }}>No bookings yet. Share your profile to start getting bookings.</p>
      ) : (
        <div style={{ display: 'grid', gap: 14, marginTop: 20 }}>
          {bookings.map((b) => {
            const actions = TRANSITIONS[b.status] ?? [];
            return (
              <div key={b.id}
                data-testid={`workspace-booking-${b.id}`}
                style={{ padding: 20, borderRadius: 12, background: STATUS_BG[b.status] ?? '#f8fafc', border: '1px solid #E5E7EB' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ margin: 0 }}>{b.service_name ?? 'Service'}</h3>
                    <p style={{ margin: '4px 0 0', color: '#6B7280', fontSize: 14 }}>
                      {b.client_name ?? 'Customer'} · {new Date(b.starts_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}–{new Date(b.ends_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: '#374151' }}>
                      ₦{(b.total_amount_kobo / 100).toLocaleString()} · Deposit {b.deposit_paid_at ? '✓ paid' : '⏳ pending'}
                    </p>
                  </div>
                  <span style={{ fontWeight: 600, textTransform: 'capitalize', fontSize: 13 }}>{b.status.replace('_', ' ')}</span>
                </div>
                {actions.length > 0 && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
                    {actions.map(({ label, next }) => (
                      <button
                        key={next}
                        onClick={() => transition(b.id, next)}
                        disabled={acting === b.id}
                        data-testid={`action-${b.id}-${next}`}
                        style={{
                          padding: '10px 16px', borderRadius: 8, border: 'none',
                          background: next === 'no_show' ? '#ef4444' : '#111827',
                          color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14,
                        }}
                      >
                        {acting === b.id ? '…' : label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
