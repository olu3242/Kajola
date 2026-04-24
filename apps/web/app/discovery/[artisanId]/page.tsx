import { notFound } from 'next/navigation';

async function fetchArtisan(artisanId: string) {
  const response = await fetch(`/api/artisans?id=${artisanId}`);
  const result = await response.json();
  if (!response.ok || !result.artisan) {
    return null;
  }
  return result.artisan;
}

export default async function ArtisanDetailPage({ params }: { params: { artisanId: string } }) {
  const artisan = await fetchArtisan(params.artisanId);
  if (!artisan) {
    notFound();
  }

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 800, margin: '0 auto' }}>
      <h1>{artisan.business_name}</h1>
      <p style={{ marginTop: 12, color: '#4B5563' }}>{artisan.headline || artisan.category}</p>
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
    </main>
  );
}
