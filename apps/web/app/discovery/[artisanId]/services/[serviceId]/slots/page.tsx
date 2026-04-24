import { notFound } from 'next/navigation';

async function fetchSlots(artisanId: string, serviceId: string) {
  const response = await fetch(`/api/booking-slots?artisan_id=${artisanId}&service_id=${serviceId}&status=available`);
  const result = await response.json();
  return result.booking_slots ?? [];
}

export default async function SlotSelectionPage({ params }: { params: { artisanId: string; serviceId: string } }) {
  const slots = await fetchSlots(params.artisanId, params.serviceId);

  if (!slots) {
    notFound();
  }

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 960, margin: '0 auto' }}>
      <h1>Select a Time Slot</h1>
      <div style={{ display: 'grid', gap: 16, marginTop: 24 }}>
        {slots.length === 0 ? (
          <p>No available slots for this service yet.</p>
        ) : (
          slots.map((slot: any) => (
            <a
              key={slot.id}
              href={`/discovery/${params.artisanId}/services/${params.serviceId}/slots/${slot.id}/confirm`}
              style={{ display: 'block', padding: 20, borderRadius: 16, background: '#F8FAFC', border: '1px solid #E5E7EB', textDecoration: 'none', color: '#111827' }}
            >
              <h2 style={{ margin: 0 }}>{new Date(slot.start_at).toLocaleString()}</h2>
              <p style={{ marginTop: 8, color: '#6B7280' }}>Available until {new Date(slot.end_at).toLocaleString()}</p>
            </a>
          ))
        )}
      </div>
    </main>
  );
}
