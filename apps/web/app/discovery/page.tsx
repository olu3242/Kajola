'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Provider = {
  id: string;
  business_name: string;
  category: string;
  city: string;
  avg_rating: number;
  total_reviews: number;
  completed_jobs: number;
  is_verified: boolean;
};

function ProviderCard({ p }: { p: Provider }) {
  return (
    <Link
      href={`/discovery/${p.id}`}
      style={{
        display: 'block', padding: 20, borderRadius: 12,
        background: '#F8FAFC', border: '1px solid #E5E7EB',
        textDecoration: 'none', color: '#111827',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ margin: 0 }}>{p.business_name}</h3>
          <p style={{ margin: '4px 0 0', color: '#6B7280', fontSize: 14 }}>{p.category} · {p.city}</p>
        </div>
        {p.is_verified && (
          <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: '#dcfce7', color: '#166534', fontWeight: 600 }}>
            Verified
          </span>
        )}
      </div>
      <p style={{ margin: '10px 0 0', color: '#374151' }}>
        ⭐ {p.avg_rating.toFixed(1)} ({p.total_reviews} reviews) · {p.completed_jobs} jobs
      </p>
    </Link>
  );
}

export default function DiscoveryPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading]     = useState(true);
  const [city, setCity]           = useState('');
  const [category, setCategory]   = useState('');

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (city)     params.set('city', city);
    if (category) params.set('category', category);
    const res  = await fetch(`/api/artisans?${params}`);
    const data = await res.json();
    setProviders(data.artisans ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [city, category]);

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Discover Providers</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <a href="/dashboard" style={{ color: '#2563eb' }}>My bookings</a>
          <a href="/logout"    style={{ color: '#ef4444' }}>Log out</a>
        </div>
      </div>
      <p style={{ marginTop: 8, color: '#6B7280' }}>Beauty, barbershop, and nail services in Lagos</p>

      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <select value={city} onChange={(e) => setCity(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }}>
          <option value="">All areas</option>
          <option value="lekki">Lekki</option>
          <option value="victoria-island">Victoria Island</option>
          <option value="surulere">Surulere</option>
          <option value="ikeja">Ikeja</option>
          <option value="yaba">Yaba</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }}>
          <option value="">All categories</option>
          <option value="Beauty">Beauty</option>
          <option value="Barbershop">Barbershop</option>
          <option value="Nails">Nails</option>
        </select>
      </div>

      {loading ? (
        <p style={{ marginTop: 24, color: '#6B7280' }}>Loading providers…</p>
      ) : providers.length === 0 ? (
        <p style={{ marginTop: 24 }}>No providers found. Try a different area or category.</p>
      ) : (
        <div style={{ display: 'grid', gap: 14, marginTop: 20 }}>
          {providers.map((p) => <ProviderCard key={p.id} p={p} />)}
        </div>
      )}
    </main>
  );
}
