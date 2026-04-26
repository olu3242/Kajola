'use client';

import { useEffect, useState } from 'react';

export default function ArtisanDashboardPage() {
  const [metrics, setMetrics] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const token = window.localStorage.getItem('kajola_access_token');
        const res = await fetch('/api/artisan/dashboard', token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Unable to load dashboard');
        setMetrics(data.metrics);
      } catch (err) {
        setError((err as Error).message);
      }
    }
    load();
  }, []);

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 960, margin: '0 auto' }}>
      <h1>Artisan Dashboard</h1>
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
      {!metrics ? <p>Loading...</p> : (
        <div style={{ display: 'grid', gap: 16, marginTop: 24 }}>
          <div style={{ padding: 24, borderRadius: 18, background: '#f8fafc' }}>
            <h2>Total jobs</h2>
            <p>{metrics.total_jobs}</p>
          </div>
          <div style={{ padding: 24, borderRadius: 18, background: '#f8fafc' }}>
            <h2>Earnings</h2>
            <p>NGN {(metrics.earnings / 100).toFixed(2)}</p>
          </div>
          <div style={{ padding: 24, borderRadius: 18, background: '#f8fafc' }}>
            <h2>Trust score</h2>
            <p>{metrics.trust_score}</p>
          </div>
          <div style={{ padding: 24, borderRadius: 18, background: '#f8fafc' }}>
            <h2>Profile completion</h2>
            <p>{metrics.profile_score}%</p>
          </div>
          <div style={{ padding: 24, borderRadius: 18, background: '#f8fafc' }}>
            <h2>Verification</h2>
            <p>{metrics.onboarding_status}</p>
          </div>
          <div style={{ padding: 24, borderRadius: 18, background: '#f8fafc' }}>
            <h2>Referrals</h2>
            <p>{metrics.referrals}</p>
          </div>
          <div style={{ padding: 24, borderRadius: 18, background: '#f8fafc' }}>
            <h2>Views</h2>
            <p>{metrics.views}</p>
          </div>
          <div style={{ padding: 24, borderRadius: 18, background: '#f8fafc' }}>
            <h2>Clicks</h2>
            <p>{metrics.clicks}</p>
          </div>
          <div style={{ padding: 24, borderRadius: 18, background: '#f8fafc' }}>
            <h2>Conversion</h2>
            <p>{metrics.conversion_rate}%</p>
          </div>
        </div>
      )}
    </main>
  );
}
