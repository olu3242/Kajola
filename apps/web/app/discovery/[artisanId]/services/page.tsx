'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type Service = { id: string; name: string; duration_minutes: number; price_kobo: number; };

export default function ServicesPage() {
  const params     = useParams<{ artisanId: string }>();
  const artisanId  = params?.artisanId ?? '';
  const [services, setServices] = useState<Service[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!artisanId) return;
    fetch(`/api/artisans/${artisanId}/services`)
      .then((r) => r.json())
      .then((d) => { setServices(d.services ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [artisanId]);

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 700, margin: '0 auto' }}>
      <a href={`/discovery/${artisanId}`} style={{ color: '#2563eb', fontSize: 14 }}>← Provider profile</a>
      <h1 style={{ marginTop: 16 }}>Choose a service</h1>

      {loading ? <p>Loading…</p> : services.length === 0 ? <p>No services listed yet.</p> : (
        <div style={{ display: 'grid', gap: 14, marginTop: 20 }}>
          {services.map((s) => (
            <a
              key={s.id}
              href={`/discovery/${artisanId}/services/${s.id}/slots`}
              data-testid={`service-card-${s.id}`}
              style={{
                display: 'block', padding: 20, borderRadius: 12,
                background: '#F8FAFC', border: '1px solid #E5E7EB',
                textDecoration: 'none', color: '#111827',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }}>{s.name}</h3>
                <span style={{ fontWeight: 700 }}>₦{(s.price_kobo / 100).toLocaleString()}</span>
              </div>
              <p style={{ margin: '6px 0 0', color: '#6B7280', fontSize: 14 }}>{s.duration_minutes} min</p>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
