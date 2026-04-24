import { notFound } from 'next/navigation';

async function fetchArtisan(artisanId: string) {
  const response = await fetch(`/api/artisans?id=${artisanId}`);
  const result = await response.json();
  if (!response.ok || !result.artisan) {
    return null;
  }
  return result.artisan;
}

async function fetchReviews(artisanId: string) {
  const response = await fetch(`/api/artisans/${artisanId}/reviews`, { cache: 'no-store' });
  if (!response.ok) return [];
  const result = await response.json();
  return result.reviews ?? [];
}

export default async function ArtisanDetailPage({ params }: { params: { artisanId: string } }) {
  const [artisan, reviews] = await Promise.all([fetchArtisan(params.artisanId), fetchReviews(params.artisanId)]);
  if (!artisan) {
    notFound();
  }

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 800, margin: '0 auto' }}>
      <h1>{artisan.business_name}</h1>
      <p style={{ marginTop: 12, color: '#4B5563' }}>{artisan.headline || artisan.category}</p>
      <p style={{ marginTop: 12 }}>
        ⭐ {Number(artisan.stats?.avg_rating ?? 0).toFixed(1)} ({artisan.stats?.total_reviews ?? 0} reviews) · {artisan.stats?.completed_jobs ?? 0} jobs completed
      </p>
      {artisan.badges?.length ? <p style={{ color: '#166534', fontWeight: 700 }}>{artisan.badges.join(' · ')}</p> : null}
      <div style={{ marginTop: 24 }}>
        <p><strong>Location:</strong> {artisan.city}, {artisan.state}</p>
        <p><strong>Verified:</strong> {artisan.verified ? 'Yes' : 'No'}</p>
        <p><strong>Description:</strong></p>
        <p>{artisan.description || 'No description added yet.'}</p>
      </div>
      <div style={{ marginTop: 32 }}>
        <a
          href={`/discovery/${params.artisanId}/services`}
          style={{ display: 'inline-block', padding: '14px 22px', borderRadius: 12, background: '#D9922A', color: '#0B0705', textDecoration: 'none', fontWeight: 700 }}
        >
          View services
        </a>
      </div>
      <section style={{ marginTop: 36 }}>
        <h2>Reviews</h2>
        {reviews.length === 0 ? <p>No reviews yet.</p> : reviews.map((review: any) => (
          <article key={review.id} style={{ padding: 16, border: '1px solid #E5E7EB', borderRadius: 8, marginBottom: 12 }}>
            <p style={{ margin: 0 }}>⭐ {review.rating}/5</p>
            {review.comment ? <p>{review.comment}</p> : null}
            {review.review_tags?.length ? (
              <p>{review.review_tags.map((tag: any) => <span key={tag.tag} style={{ marginRight: 8, color: '#374151' }}>#{tag.tag}</span>)}</p>
            ) : null}
          </article>
        ))}
      </section>
    </main>
  );
}
