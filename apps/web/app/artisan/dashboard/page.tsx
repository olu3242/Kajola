'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '../../components/shells';
import { Alert, ButtonLink, PageHeader, Skeleton, StatCard } from '../../components/ui';

type Metrics = { total_completed: number; revenue_kobo: number; avg_rating: number; bookings_today: number; bookings_upcoming: number; };

export default function ArtisanDashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  useEffect(() => { fetch('/api/artisan/dashboard').then((response) => response.json()).then((data) => { if (data.error) setError(data.error); else setMetrics(data.metrics ?? data); }).catch(() => setError('Failed to load provider metrics.')).finally(() => setLoading(false)); }, []);
  return <AppShell persona="provider"><PageHeader eyebrow="Provider" title="Provider dashboard" description="Your service activity and performance at a glance." action={<ButtonLink href="/artisan/workspace">Today’s workspace →</ButtonLink>} />{error ? <Alert tone="error">{error}</Alert> : loading ? <Skeleton /> : metrics ? <div className="kj-grid kj-grid--cards"><StatCard label="Completed jobs" value={metrics.total_completed.toString()} /><StatCard label="Revenue" value={`₦${(metrics.revenue_kobo / 100).toLocaleString()}`} sub="NGN" /><StatCard label="Average rating" value={metrics.avg_rating.toFixed(1)} sub="out of 5" /><StatCard label="Bookings today" value={metrics.bookings_today.toString()} /><StatCard label="Upcoming" value={metrics.bookings_upcoming.toString()} /></div> : null}</AppShell>;
}
