'use client';

import { useEffect, useState } from 'react';

type Metrics = {
  total_completed: number; revenue_kobo: number; avg_rating: number;
  bookings_today: number; bookings_upcoming: number;
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 20, borderRadius: 12, background: '#f8fafc', border: '1px solid #E5E7EB' }}>
      <p style={{ margin: 0, color: '#6B7280', fontSize: 13 }}>{label}</p>
      <p style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 700 }}>{value}</p>
    </div>
  );
}

export default function ArtisanDashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/artisan/dashboard')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setMetrics(d.metrics ?? d);
        setLoading(false);
      })
      .catch(() => { setError('Failed to load'); setLoading(false); });
  }, []);

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 860, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Provider Dashboard</h1>
        <div style={{ display: 'flex', gap: 16 }}>
          <a href="/artisan/workspace" style={{ color: '#2563eb', fontWeight: 600 }}>Today's workspace →</a>
          <a href="/logout" style={{ color: '#ef4444' }}>Log out</a>
        </div>
      </div>

      {error && <p style={{ color: '#b91c1c', background: '#fef2f2', padding: 12, borderRadius: 8, marginTop: 16 }}>{error}</p>}

      {loading ? <p style={{ marginTop: 24 }}>Loading…</p> : metrics ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginTop: 24 }}>
          <Stat label="Completed jobs"     value={metrics.total_completed.toString()} />
          <Stat label="Revenue (NGN)"      value={`₦${(metrics.revenue_kobo / 100).toLocaleString()}`} />
          <Stat label="Avg rating"         value={metrics.avg_rating.toFixed(1)} />
          <Stat label="Bookings today"     value={metrics.bookings_today.toString()} />
          <Stat label="Upcoming bookings"  value={metrics.bookings_upcoming.toString()} />
        </div>
      ) : null}
    </main>
  );
}
