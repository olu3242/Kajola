import Link from 'next/link';

async function fetchArtisans() {
  const response = await fetch('/api/artisans');
  return response.json();
}

export default async function DiscoveryPage() {
  const data = await fetchArtisans();
  const artisans = data.artisans ?? [];

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 960, margin: '0 auto' }}>
      <h1>Discover Artisans</h1>
      <p style={{ marginTop: 12, color: '#4B5563' }}>
        Browse available services and artisan profiles.
      </p>
      <div style={{ display: 'grid', gap: 16, marginTop: 24 }}>
        {artisans.length === 0 ? (
          <p>No artisans available yet.</p>
        ) : (
          artisans.map((artisan: any) => (
            <Link
              key={artisan.id}
              href={`/discovery/${artisan.id}`}
              style={{ padding: 20, borderRadius: 16, background: '#F8FAFC', border: '1px solid #E5E7EB', textDecoration: 'none', color: '#111827' }}
            >
              <h2 style={{ margin: 0 }}>{artisan.business_name}</h2>
              <p style={{ margin: '8px 0 0', color: '#6B7280' }}>{artisan.headline || artisan.category}</p>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
