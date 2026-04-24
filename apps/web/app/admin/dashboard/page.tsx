'use client';

import { useEffect, useState } from 'react';

type Dashboard = {
  generated_at: string;
  marketplace_health: Record<string, number>;
  conversion_funnel: { views: number; clicks: number; bookings: number; conversion_rate: number };
  supply_health: Record<string, number>;
  revenue: Record<string, number>;
  automation_health: Record<string, number>;
  migration_health: {
    applied_migrations: number;
    pending_migrations: number;
    failed_migrations: number;
    drift_status: string;
    last_migration_timestamp: string | null;
    recent: Array<{ id: string; environment: string; migration_name: string; status: string; drift_status: string; applied_at?: string }>;
  };
  liquidity: { requests_with_no_response: any[]; slow_response_artisans: any[]; unmatched_bookings: any[] };
  top_performers: { top_artisans: Array<{ label: string; count: number }>; top_categories: Array<{ label: string; count: number }>; top_zones: Array<{ label: string; count: number }> };
  alerts: Array<{ severity: string; message: string }>;
};

function money(cents: number) {
  return `NGN ${(Number(cents || 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function label(value: string) {
  return value.replace(/_/g, ' ');
}

function Card({ title, value }: { title: string; value: string | number }) {
  return (
    <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
      <p style={{ margin: 0, color: '#6b7280', textTransform: 'capitalize' }}>{title}</p>
      <strong style={{ display: 'block', marginTop: 8, fontSize: 24 }}>{value}</strong>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={{ marginTop: 28 }}><h2>{title}</h2>{children}</section>;
}

function Cards({ data, moneyKeys = [] }: { data: Record<string, number>; moneyKeys?: string[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
      {Object.entries(data).map(([key, value]) => <Card key={key} title={label(key)} value={moneyKeys.includes(key) ? money(value) : value} />)}
    </div>
  );
}

function RankingTable({ rows }: { rows: Array<{ label: string; count: number }> }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td style={{ padding: 10, borderBottom: '1px solid #e5e7eb' }}>{row.label}</td>
            <td style={{ padding: 10, borderBottom: '1px solid #e5e7eb', textAlign: 'right' }}>{row.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AdminDashboardPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [failedEvents, setFailedEvents] = useState<any[]>([]);
  const [error, setError] = useState('');

  async function load(refresh = false) {
    const token = window.localStorage.getItem('kajola_access_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    const [dashboardRes, eventsRes] = await Promise.all([
      fetch(`/api/admin/dashboard${refresh ? '?refresh=true' : ''}`, { headers }),
      fetch('/api/admin/events?status=failed', { headers })
    ]);
    const dashboardData = await dashboardRes.json();
    const eventsData = await eventsRes.json();
    if (!dashboardRes.ok) {
      setError(dashboardData.error ?? 'Unable to load dashboard');
      return;
    }
    setDashboard(dashboardData.dashboard);
    setFailedEvents(eventsData.events ?? []);
    setError('');
  }

  async function retryEvent(eventId: string) {
    const token = window.localStorage.getItem('kajola_access_token');
    await fetch('/api/admin/events/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ event_id: eventId })
    });
    await load(true);
  }

  useEffect(() => {
    load();
    const id = window.setInterval(() => load(), 30000);
    return () => window.clearInterval(id);
  }, []);

  if (error) return <main style={{ padding: 32 }}><p style={{ color: '#b91c1c' }}>{error}</p></main>;
  if (!dashboard) return <main style={{ padding: 32 }}>Loading operator dashboard...</main>;

  const maxFunnel = Math.max(dashboard.conversion_funnel.views, 1);

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', background: '#f9fafb', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0 }}>Operator Dashboard</h1>
          <p style={{ color: '#6b7280' }}>Updated {new Date(dashboard.generated_at).toLocaleString()}</p>
        </div>
        <button onClick={() => load(true)} style={{ padding: '10px 14px' }}>Refresh</button>
      </div>

      {dashboard.alerts.length ? (
        <Section title="Alerts">
          <div style={{ display: 'grid', gap: 10 }}>
            {dashboard.alerts.map((alert) => (
              <div key={alert.message} style={{ padding: 12, borderRadius: 8, background: alert.severity === 'critical' ? '#fee2e2' : '#fef3c7' }}>
                <strong>{alert.severity}</strong>: {alert.message}
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Marketplace Health"><Cards data={dashboard.marketplace_health} /></Section>
      <Section title="Supply Health"><Cards data={dashboard.supply_health} /></Section>
      <Section title="Revenue"><Cards data={dashboard.revenue} moneyKeys={['revenue_today', 'revenue_last_7_days', 'avg_booking_value']} /></Section>
      <Section title="Automation Health"><Cards data={dashboard.automation_health} /></Section>
      <Section title="Migration Health">
        <Cards data={{
          applied_migrations: dashboard.migration_health.applied_migrations,
          pending_migrations: dashboard.migration_health.pending_migrations,
          failed_migrations: dashboard.migration_health.failed_migrations
        }} />
        <div style={{ marginTop: 12, padding: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <p>Drift status: <strong>{dashboard.migration_health.drift_status}</strong></p>
          <p>Last migration: {dashboard.migration_health.last_migration_timestamp ? new Date(dashboard.migration_health.last_migration_timestamp).toLocaleString() : 'Not recorded'}</p>
        </div>
      </Section>

      <Section title="Conversion Funnel">
        <div style={{ display: 'grid', gap: 10, background: '#fff', padding: 16, border: '1px solid #e5e7eb', borderRadius: 8 }}>
          {(['views', 'clicks', 'bookings'] as const).map((key) => (
            <div key={key}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{key}</span><strong>{dashboard.conversion_funnel[key]}</strong></div>
              <div style={{ height: 10, background: '#e5e7eb', borderRadius: 999 }}><div style={{ width: `${(dashboard.conversion_funnel[key] / maxFunnel) * 100}%`, height: 10, background: '#2563eb', borderRadius: 999 }} /></div>
            </div>
          ))}
          <p>Conversion rate: {dashboard.conversion_funnel.conversion_rate}%</p>
        </div>
      </Section>

      <Section title="Liquidity Monitor">
        <Cards data={{
          requests_with_no_response: dashboard.liquidity.requests_with_no_response.length,
          slow_response_artisans: dashboard.liquidity.slow_response_artisans.length,
          unmatched_bookings: dashboard.liquidity.unmatched_bookings.length
        }} />
      </Section>

      <Section title="Top Performers">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          <div><h3>Artisans</h3><RankingTable rows={dashboard.top_performers.top_artisans} /></div>
          <div><h3>Categories</h3><RankingTable rows={dashboard.top_performers.top_categories} /></div>
          <div><h3>Zones</h3><RankingTable rows={dashboard.top_performers.top_zones} /></div>
        </div>
      </Section>

      <Section title="Failed Events">
        {failedEvents.length === 0 ? <p>No failed events.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <tbody>
              {failedEvents.map((event) => (
                <tr key={event.id}>
                  <td style={{ padding: 10, borderBottom: '1px solid #e5e7eb' }}>{event.event_type}</td>
                  <td style={{ padding: 10, borderBottom: '1px solid #e5e7eb' }}>{event.error_message ?? 'Failed'}</td>
                  <td style={{ padding: 10, borderBottom: '1px solid #e5e7eb', textAlign: 'right' }}><button onClick={() => retryEvent(event.id)}>Retry</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </main>
  );
}
