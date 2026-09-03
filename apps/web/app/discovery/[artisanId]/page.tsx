'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type Provider = {
  id: string; business_name: string; category: string; city: string;
  avg_rating: number; total_reviews: number; completed_jobs: number; is_verified: boolean;
  full_name: string;
};
type Review = { id: string; rating: number; comment: string; created_at: string; };

export default function ProviderDetailPage() {
  const params = useParams<{ artisanId: string }>();
  const id     = params?.artisanId ?? '';

  const [provider, setProvider] = useState<Provider | null>(null);
  const [reviews,  setReviews]  = useState<Review[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetch(`/api/artisans/${id}`).then((r) => r.json()),
      fetch(`/api/artisans/${id}/reviews`).then((r) => r.json()),
    ]).then(([pd, rd]) => {
      if (pd.artisan) setProvider(pd.artisan);
      else setError('Provider not found.');
      setReviews(rd.reviews ?? []);
      setLoading(false);
    }).catch(() => { setError('Failed to load.'); setLoading(false); });
  }, [id]);

  if (loading) return <main style={{ padding: 32 }}><p>Loading…</p></main>;
  if (error || !provider) return <main style={{ padding: 32 }}><p style={{ color: '#b91c1c' }}>{error || 'Provider not found.'}</p><a href="/discovery">Back</a></main>;

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 800, margin: '0 auto' }}>
      <a href="/discovery" style={{ color: '#2563eb', fontSize: 14 }}>← All providers</a>

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ margin: 0 }}>{provider.business_name}</h1>
          <p style={{ margin: '4px 0 0', color: '#6B7280' }}>{provider.category} · {provider.city}, Lagos</p>
        </div>
        {provider.is_verified && (
          <span style={{ padding: '4px 12px', borderRadius: 999, background: '#dcfce7', color: '#166534', fontWeight: 600 }}>
            ✓ Verified
          </span>
        )}
      </div>

      <p style={{ marginTop: 12 }}>
        ⭐ {provider.avg_rating.toFixed(1)} ({provider.total_reviews} reviews) · {provider.completed_jobs} completed
      </p>

      <a
        href={`/discovery/${id}/services`}
        style={{
          display: 'inline-block', marginTop: 24, padding: '14px 28px',
          borderRadius: 10, background: '#D9922A', color: '#fff',
          textDecoration: 'none', fontWeight: 700, fontSize: 15,
        }}
        data-testid="book-now-btn"
      >
        Book now
      </a>

      <section style={{ marginTop: 36 }}>
        <h2>Reviews ({provider.total_reviews})</h2>
        {reviews.length === 0 ? (
          <p style={{ color: '#6B7280' }}>No reviews yet.</p>
        ) : (
          reviews.map((r) => (
            <article key={r.id} style={{ padding: 16, border: '1px solid #E5E7EB', borderRadius: 8, marginBottom: 12 }}>
              <p style={{ margin: 0, fontWeight: 600 }}>{'⭐'.repeat(r.rating)}</p>
              {r.comment && <p style={{ margin: '6px 0 0', color: '#374151' }}>{r.comment}</p>}
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#9CA3AF' }}>{new Date(r.created_at).toLocaleDateString()}</p>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
