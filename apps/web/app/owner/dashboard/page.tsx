'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '../../components/shells';
import { Alert, Card, PageHeader, Skeleton, StatCard } from '../../components/ui';

type KPIs = { completed_count: number; revenue_kobo: number; cancellation_rate: number; no_show_rate: number; avg_rating: number; bookings_by_day: Array<{ date: string; count: number; revenue_kobo: number }>; };

export default function OwnerDashboardPage() {
  const [kpis, setKpis] = useState<KPIs | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  useEffect(() => { fetch('/api/owner/dashboard').then((response) => response.json()).then((data) => { if (data.error) setError(data.error); else setKpis(data.kpis ?? data); }).catch(() => setError('Failed to load business metrics.')).finally(() => setLoading(false)); }, []);
  const maxCount = kpis ? Math.max(...kpis.bookings_by_day.map((day) => day.count), 1) : 1;
  return <AppShell persona="owner"><PageHeader eyebrow="Business owner" title="Owner dashboard" description="Run bookings, payments, customers, staff, and growth from one place." />{error ? <Alert tone="error">{error}</Alert> : loading ? <Skeleton /> : kpis ? <><div className="kj-grid kj-grid--cards"><StatCard label="Completed bookings" value={kpis.completed_count.toString()} /><StatCard label="Revenue" value={`₦${(kpis.revenue_kobo / 100).toLocaleString()}`} sub="NGN" /><StatCard label="Average rating" value={kpis.avg_rating.toFixed(1)} sub="out of 5" /><StatCard label="Cancellation rate" value={`${(kpis.cancellation_rate * 100).toFixed(1)}%`} /><StatCard label="No-show rate" value={`${(kpis.no_show_rate * 100).toFixed(1)}%`} /></div><section style={{ marginTop: 'var(--space-10)' }}><h2 className="kj-heading-2" style={{ marginBottom: 'var(--space-5)' }}>Bookings · last 7 days</h2><Card><div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 150 }}>{kpis.bookings_by_day.map((day) => <div key={day.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}><div data-testid={`bar-${day.date}`} style={{ width: '100%', background: 'var(--color-primary)', borderRadius: '6px 6px 0 0', height: `${Math.max((day.count / maxCount) * 112, 3)}px`, minHeight: 3 }} title={`${day.count} bookings · ₦${(day.revenue_kobo / 100).toLocaleString()}`} /><span className="kj-caption kj-muted">{new Date(day.date).toLocaleDateString('en-NG', { weekday: 'short' })}</span></div>)}</div></Card></section></> : null}</AppShell>;
}
