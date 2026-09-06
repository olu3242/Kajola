'use client';

import { useMemo, useState } from 'react';
import { BUSINESS_TYPE_GROUPS, OTHER_BUSINESS_TYPE, SUGGESTED_SERVICES_BY_BUSINESS } from '../../../lib/service-taxonomy';
import { PublicShell } from '../../components/shells';
import { Alert, Button, Field, Input, NigeriaLocationOptions, PageHeader, Select, Textarea } from '../../components/ui';

const steps = ['Business profile', 'Services', 'Portfolio', 'Availability', 'Verification'];

export default function ArtisanOnboardingPage() {
  const [step, setStep] = useState(0);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'success' | 'error'>('success');
  const [saving, setSaving] = useState(false);
  const [typeSearch, setTypeSearch] = useState('');
  const [profile, setProfile] = useState({ business_name: '', business_category: '', business_type: '', custom_business_type: '', headline: '', description: '', city: '', profile_photo_url: '' });
  const [service, setService] = useState({ name: '', service_type: '', duration_minutes: 60, price_kobo: 200000 });
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [availability, setAvailability] = useState({ starts_at: '', ends_at: '', slot_interval_minutes: 60 });

  const filteredGroups = useMemo(() => BUSINESS_TYPE_GROUPS.map((group) => ({ ...group, types: group.types.filter((type) => !typeSearch || `${type} ${group.group}`.toLowerCase().includes(typeSearch.toLowerCase())) })).filter((group) => group.types.length), [typeSearch]);
  const suggestions = SUGGESTED_SERVICES_BY_BUSINESS[profile.business_type] ?? [];

  function selectBusinessType(value: string) {
    const group = BUSINESS_TYPE_GROUPS.find((item) => item.types.some((type) => type === value));
    setProfile((current) => ({ ...current, business_type: value, business_category: group?.group ?? (value === 'other' ? 'Other' : current.business_category), custom_business_type: value === 'other' ? current.custom_business_type : '' }));
  }

  async function submitStep() {
    setMessage('');
    if (step === 0 && (!profile.business_name || !profile.business_type || !profile.city || (profile.business_type === 'other' && !profile.custom_business_type.trim()))) {
      setTone('error'); setMessage(profile.business_type === 'other' && !profile.custom_business_type.trim() ? 'Tell us what your business does.' : 'Complete the required business profile fields.'); return;
    }
    if (step === 1 && !service.name.trim()) { setTone('error'); setMessage('Add or choose at least one service.'); return; }
    setSaving(true);
    const token = window.localStorage.getItem('kajola_access_token');
    const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const requests = [
      { url: '/api/artisan/onboarding', body: profile },
      { url: '/api/artisan/services', body: { services: [service] } },
      { url: '/api/artisan/portfolio', body: { portfolio: [{ url: portfolioUrl, caption: 'Completed job sample' }] } },
      { url: '/api/artisan/availability', body: { windows: [availability] } },
      { url: '/api/artisan/verification', body: { type: 'phone' } },
    ];
    try {
      const current = requests[step];
      const response = await fetch(current.url, { method: 'POST', headers, body: JSON.stringify(current.body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Could not save this step.');
      setTone('success'); setMessage(step === steps.length - 1 ? 'Verification requested.' : 'Saved. Continue to the next step.'); setStep((value) => Math.min(steps.length - 1, value + 1));
    } catch (reason) { setTone('error'); setMessage(reason instanceof Error ? reason.message : 'Save failed.'); }
    finally { setSaving(false); }
  }

  return <PublicShell><PageHeader eyebrow="For service professionals" title="Build your Kajola business" description="Turn your skill into a structured, discoverable, repeatable business." /><div className="kj-progress" aria-label={`Onboarding step ${step + 1} of ${steps.length}`}><span style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div><p className="kj-small kj-muted">Step {step + 1} of {steps.length} · {steps[step]}</p><section className="kj-card" style={{ marginTop: 'var(--space-6)' }}><h2 className="kj-heading-2">{steps[step]}</h2><div className="kj-form" style={{ marginTop: 'var(--space-6)' }}>
    {step === 0 ? <><Field label="Business name"><Input value={profile.business_name} onChange={(event) => setProfile({ ...profile, business_name: event.target.value })} required /></Field><div className="kj-form-grid"><Field label="Search business types"><Input value={typeSearch} onChange={(event) => setTypeSearch(event.target.value)} placeholder="Try barber, home, fitness…" /></Field><Field label="What type of business do you run?"><Select aria-label="What type of business do you run?" value={profile.business_type} onChange={(event) => selectBusinessType(event.target.value)} required><option value="">Choose a business type</option>{filteredGroups.map((group) => <optgroup label={group.group} key={group.group}>{group.types.map((type) => <option value={type} key={type}>{type}</option>)}</optgroup>)}<optgroup label="Other"><option value="other">{OTHER_BUSINESS_TYPE}</option></optgroup></Select></Field></div>{profile.business_type === 'other' ? <Field label="Tell us what your business does"><Input value={profile.custom_business_type} onChange={(event) => setProfile({ ...profile, custom_business_type: event.target.value })} required placeholder="Describe your service business" /></Field> : null}<Field label="Business description"><Textarea value={profile.description} onChange={(event) => setProfile({ ...profile, description: event.target.value })} /></Field><div className="kj-form-grid"><Field label="Business location"><Select aria-label="Business location" value={profile.city} onChange={(event) => setProfile({ ...profile, city: event.target.value })} required><NigeriaLocationOptions allLabel="Choose a location" /></Select></Field><Field label="Profile photo URL"><Input type="url" value={profile.profile_photo_url} onChange={(event) => setProfile({ ...profile, profile_photo_url: event.target.value })} /></Field></div></> : null}
    {step === 1 ? <><p className="kj-muted">Choose a common service or add your own business-specific offering. Suggestions never limit what you can publish.</p>{suggestions.length ? <div className="kj-service-suggestions" aria-label="Suggested services">{suggestions.map((name) => <Button type="button" variant="outline" key={name} onClick={() => setService({ ...service, name, service_type: name })}>{name}</Button>)}</div> : null}<div className="kj-form-grid"><Field label="Custom service name"><Input value={service.name} onChange={(event) => setService({ ...service, name: event.target.value, service_type: event.target.value })} placeholder="+ Add custom service" /></Field><Field label="Duration in minutes"><Input type="number" min={15} value={service.duration_minutes} onChange={(event) => setService({ ...service, duration_minutes: Number(event.target.value) })} /></Field><Field label="Price in kobo"><Input type="number" min={0} value={service.price_kobo} onChange={(event) => setService({ ...service, price_kobo: Number(event.target.value) })} /></Field></div></> : null}
    {step === 2 ? <Field label="Portfolio image URL"><Input type="url" value={portfolioUrl} onChange={(event) => setPortfolioUrl(event.target.value)} /></Field> : null}
    {step === 3 ? <div className="kj-form-grid"><Field label="Starts at"><Input type="datetime-local" value={availability.starts_at} onChange={(event) => setAvailability({ ...availability, starts_at: event.target.value })} /></Field><Field label="Ends at"><Input type="datetime-local" value={availability.ends_at} onChange={(event) => setAvailability({ ...availability, ends_at: event.target.value })} /></Field><Field label="Slot interval in minutes"><Input type="number" min={15} value={availability.slot_interval_minutes} onChange={(event) => setAvailability({ ...availability, slot_interval_minutes: Number(event.target.value) })} /></Field></div> : null}
    {step === 4 ? <p>Request phone verification to finish onboarding and submit your profile for review.</p> : null}
    <Button onClick={submitStep} disabled={saving}>{saving ? 'Saving…' : step === steps.length - 1 ? 'Request verification' : 'Save and continue →'}</Button>{message ? <Alert tone={tone}>{message}</Alert> : null}
  </div></section></PublicShell>;
}
