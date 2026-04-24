'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Artisan = {
  id: string;
  business_name: string;
  headline?: string;
  category?: string;
  city?: string;
  reason?: string;
  stats?: { avg_rating?: number; total_reviews?: number; completed_jobs?: number };
  badges?: string[];
};

async function loadSection(path: string, token: string | null) {
  const res = await fetch(path, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  const data = await res.json();
  return data.artisans ?? [];
}

function ArtisanCard({ artisan, label }: { artisan: Artisan; label: string }) {
  async function track(event_type: 'view' | 'click') {
    const token = window.localStorage.getItem('kajola_access_token');
    if (!token) return;
    await fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ artisan_id: artisan.id, event_type })
    }).catch(() => {});
  }

  useEffect(() => {
    track('view');
  }, [artisan.id]);

  return (
    <Link
      href={`/discovery/${artisan.id}`}
      onClick={() => track('click')}
      style={{ padding: 16, borderRadius: 8, background: '#F8FAFC', border: '1px solid #E5E7EB', textDecoration: 'none', color: '#111827' }}
    >
      <p style={{ margin: 0, color: '#6B7280', fontSize: 13 }}>{artisan.reason ?? label}</p>
      <h3 style={{ margin: '8px 0 0' }}>{artisan.business_name}</h3>
      <p style={{ margin: '6px 0 0', color: '#6B7280' }}>{artisan.headline || artisan.category}</p>
      <p style={{ margin: '10px 0 0', color: '#374151' }}>
        ⭐ {Number(artisan.stats?.avg_rating ?? 0).toFixed(1)} ({artisan.stats?.total_reviews ?? 0}) · {artisan.stats?.completed_jobs ?? 0} jobs
      </p>
      {artisan.badges?.length ? <p style={{ margin: '8px 0 0', fontWeight: 700, color: '#166534' }}>{artisan.badges.join(' · ')}</p> : null}
    </Link>
  );
}

function Section({ title, label, artisans }: { title: string; label: string; artisans: Artisan[] }) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2>{title}</h2>
      <div style={{ display: 'grid', gap: 14, marginTop: 12 }}>
        {artisans.length === 0 ? <p>No artisans available yet.</p> : artisans.map((artisan) => <ArtisanCard key={`${title}-${artisan.id}`} artisan={artisan} label={label} />)}
      </div>
    </section>
  );
}

export default function DiscoveryPage() {
  const [recommended, setRecommended] = useState<Artisan[]>([]);
  const [topRated, setTopRated] = useState<Artisan[]>([]);
  const [popular, setPopular] = useState<Artisan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const token = window.localStorage.getItem('kajola_access_token');
      const [recommendedData, topRatedData, popularData] = await Promise.all([
        loadSection('/api/discovery/recommended', token),
        loadSection('/api/artisans?limit=6', null),
        loadSection('/api/discovery/popular', null)
      ]);
      setRecommended(recommendedData);
      setTopRated(topRatedData);
      setPopular(popularData);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 960, margin: '0 auto' }}>
      <h1>Discover Artisans</h1>
      <p style={{ marginTop: 12, color: '#4B5563' }}>Personalized picks ranked by trust, availability, behavior, and booking momentum.</p>
      {loading ? <p>Loading recommendations...</p> : (
        <>
          <Section title="Recommended for You" label="Because of your recent activity" artisans={recommended} />
          <Section title="Top Rated Near You" label="Highly rated near you" artisans={topRated} />
          <Section title="Popular Right Now" label="Popular right now" artisans={popular} />
        </>
      )}
    </main>
  );
}
