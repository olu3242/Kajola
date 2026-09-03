'use client';

import { useEffect, useState } from 'react';

type KPIs = {
  completed_count: number; revenue_kobo: number; cancellation_rate: number;
  no_show_rate: number; avg_rating: number;
  bookings_by_day: Array<{ date: string; count: number; revenue_kobo: number }>;
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ padding: 20, borderRadius: 12, background: '#f8fafc', border: '1px solid #E5E7EB' }}>
      <p style={{ margin: 0, color: '#6B7280', fontSize: 13 }}>{label}</p>
      <p style={{ margin: '6px 0 0', fontSize: 26, fontWeight: 700 }}>{value}</p>
      {sub && <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9CA3AF' }}>{sub}</p>}
    </div>
  );
}

export default function OwnerDashboardPage() {
  const [kpis,    setKpis]    = useState<KPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    fetch('/api/owner/dashboard')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setKpis(d.kpis ?? d);
        setLoading(false);
      })
      .catch(() => { setError('Failed to load KPIs'); setLoading(false); });
  }, []);

  const maxCount = kpis ? Math.max(...kpis.bookings_by_day.map((d) => d.count), 1) : 1;

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Owner Dashboard</h1>
        <a href="/logout" style={{ color: '#ef4444' }}>Log out</a>
      </div>
      <p style={{ color: '#6B7280', marginTop: 4 }}>Last 30 days · Lagos operations</p>

      {error && <p style={{ color: '#b91c1c', background: '#fef2f2', padding: 12, borderRadius: 8, marginTop: 16 }}>{error}</p>}

      {loading ? <p style={{ marginTop: 24 }}>Loading KPIs…</p> : kpis ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginTop: 24 }}>
            <Stat label="Completed bookings" value={kpis.completed_count.toString()} data-testid="kpi-completed" />
            <Stat label="Revenue (NGN)"      value={`₦${(kpis.revenue_kobo / 100).toLocaleString()}`} />
            <Stat label="Avg rating"         value={kpis.avg_rating.toFixed(1)} sub="out of 5.0" />
            <Stat label="Cancellation rate"  value={`${(kpis.cancellation_rate * 100).toFixed(1)}%`} />
            <Stat label="No-show rate"       value={`${(kpis.no_show_rate * 100).toFixed(1)}%`} />
          </div>

          <section style={{ marginTop: 36 }}>
            <h2 style={{ marginBottom: 16 }}>Bookings — last 7 days</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 120 }}>
              {kpis.bookings_by_day.map((d) => (
                <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div
                    data-testid={`bar-${d.date}`}
                    style={{
                      width: '100%', background: '#D9922A', borderRadius: '4px 4px 0 0',
                      height: `${Math.max((d.count / maxCount) * 100, 2)}px`,
                      minHeight: 2,
                    }}
                    title={`${d.count} bookings · ₦${(d.revenue_kobo / 100).toLocaleString()}`}
                  />
                  <span style={{ fontSize: 11, color: '#6B7280', whiteSpace: 'nowrap' }}>
                    {new Date(d.date).toLocaleDateString('en-NG', { weekday: 'short' })}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
