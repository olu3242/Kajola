'use client';

import { useState } from 'react';

const steps = ['Profile', 'Services', 'Portfolio', 'Availability', 'Verification'];

export default function ArtisanOnboardingPage() {
  const [step, setStep] = useState(0);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState({ business_name: '', category: '', headline: '', description: '', city: '', profile_photo_url: '' });
  const [service, setService] = useState({ name: '', duration_minutes: 60, price_cents: 2000 });
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [availability, setAvailability] = useState({ starts_at: '', ends_at: '', slot_interval_minutes: 60 });

  async function submitStep() {
    setMessage('');
    setSaving(true);
    const token = window.localStorage.getItem('kajola_access_token');
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
    try {
      if (step === 0) {
        await fetch('/api/artisan/onboarding', {
          method: 'POST', headers,
          body: JSON.stringify(profile)
        });
      }
      if (step === 1) {
        await fetch('/api/artisan/services', {
          method: 'POST', headers,
          body: JSON.stringify({ services: [service] })
        });
      }
      if (step === 2) {
        await fetch('/api/artisan/portfolio', {
          method: 'POST', headers,
          body: JSON.stringify({ portfolio: [{ url: portfolioUrl, caption: 'Completed job sample' }] })
        });
      }
      if (step === 3) {
        await fetch('/api/artisan/availability', {
          method: 'POST', headers,
          body: JSON.stringify({ windows: [availability] })
        });
      }
      if (step === 4) {
        await fetch('/api/artisan/verification', {
          method: 'POST', headers,
          body: JSON.stringify({ type: 'phone' })
        });
      }
      setStep((current) => Math.min(steps.length - 1, current + 1));
      setMessage('Saved. Continue to the next step.');
    } catch (err) {
      setMessage((err as Error).message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 760, margin: '0 auto' }}>
      <h1>Artisan Onboarding</h1>
      <p style={{ color: '#4B5563' }}>Complete your profile in structured steps to start receiving bookings.</p>
      <div style={{ margin: '24px 0', height: 12, background: '#e5e7eb', borderRadius: 999 }}>
        <div style={{ width: `${((step + 1) / steps.length) * 100}%`, height: '100%', background: '#2563eb', borderRadius: 999 }} />
      </div>
      <h2>{steps[step]}</h2>
      {step === 0 ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <input value={profile.business_name} onChange={(e) => setProfile({ ...profile, business_name: e.target.value })} placeholder="Business name" />
          <input value={profile.category} onChange={(e) => setProfile({ ...profile, category: e.target.value })} placeholder="Category" />
          <input value={profile.headline} onChange={(e) => setProfile({ ...profile, headline: e.target.value })} placeholder="Headline" />
          <textarea value={profile.description} onChange={(e) => setProfile({ ...profile, description: e.target.value })} placeholder="Description" />
          <input value={profile.city} onChange={(e) => setProfile({ ...profile, city: e.target.value })} placeholder="City" />
          <input value={profile.profile_photo_url} onChange={(e) => setProfile({ ...profile, profile_photo_url: e.target.value })} placeholder="Profile photo URL" />
        </div>
      ) : step === 1 ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <input value={service.name} onChange={(e) => setService({ ...service, name: e.target.value })} placeholder="Service name" />
          <input type="number" value={service.duration_minutes} onChange={(e) => setService({ ...service, duration_minutes: Number(e.target.value) })} placeholder="Duration minutes" />
          <input type="number" value={service.price_cents} onChange={(e) => setService({ ...service, price_cents: Number(e.target.value) })} placeholder="Price in cents" />
        </div>
      ) : step === 2 ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <input value={portfolioUrl} onChange={(e) => setPortfolioUrl(e.target.value)} placeholder="Portfolio image URL" />
        </div>
      ) : step === 3 ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <input type="datetime-local" value={availability.starts_at} onChange={(e) => setAvailability({ ...availability, starts_at: e.target.value })} />
          <input type="datetime-local" value={availability.ends_at} onChange={(e) => setAvailability({ ...availability, ends_at: e.target.value })} />
          <input type="number" value={availability.slot_interval_minutes} onChange={(e) => setAvailability({ ...availability, slot_interval_minutes: Number(e.target.value) })} placeholder="Slot interval minutes" />
        </div>
      ) : (
        <div>
          <p>Request phone verification to finish onboarding.</p>
        </div>
      )}
      <button onClick={submitStep} disabled={saving} style={{ marginTop: 24, padding: '12px 20px', borderRadius: 10, background: '#2563eb', color: '#fff', border: 'none' }}>
        {step === steps.length - 1 ? 'Request verification' : 'Save and continue'}
      </button>
      {message ? <p style={{ marginTop: 16 }}>{message}</p> : null}
    </main>
  );
}
