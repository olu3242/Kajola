import Link from 'next/link';

async function fetchServices(artisanId: string) {
  const response = await fetch(`/api/services?artisan_id=${artisanId}`);
  return response.json();
}

export default async function ServicesPage({ params }: { params: { artisanId: string } }) {
  const data = await fetchServices(params.artisanId);
  const services = data.services ?? [];

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 960, margin: '0 auto' }}>
      <h1>Services</h1>
      <p style={{ marginTop: 12, color: '#4B5563' }}>
        Select a service to view available appointment slots.
      </p>
      <div style={{ display: 'grid', gap: 16, marginTop: 24 }}>
        {services.length === 0 ? (
          <p>No services available yet.</p>
        ) : (
          services.map((service: any) => (
            <Link
              key={service.id}
              href={`/discovery/${params.artisanId}/services/${service.id}/slots`}
              style={{ padding: 20, borderRadius: 16, background: '#F8FAFC', border: '1px solid #E5E7EB', textDecoration: 'none', color: '#111827' }}
            >
              <h2 style={{ margin: 0 }}>{service.name}</h2>
              <p style={{ margin: '8px 0 0', color: '#6B7280' }}>{service.description || service.category}</p>
              <p style={{ marginTop: 8, color: '#4B5563' }}>NGN {Number(service.price_cents) / 100} • {service.duration_minutes} mins</p>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
