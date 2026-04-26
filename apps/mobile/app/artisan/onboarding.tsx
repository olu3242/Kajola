import { useState } from 'react';
import { Button, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const steps = ['Profile', 'Services', 'Portfolio', 'Availability', 'Verification'];
const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

export default function ArtisanOnboardingScreen() {
  const [step, setStep] = useState(0);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState({ business_name: '', category: '', headline: '', description: '', city: '', profile_photo_url: '' });
  const [service, setService] = useState({ name: '', duration_minutes: '60', price_cents: '2000' });
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [availability, setAvailability] = useState({ starts_at: '', ends_at: '', slot_interval_minutes: '60' });

  async function submitStep() {
    setMessage('');
    setLoading(true);
    try {
      const token = await SecureStore.getItemAsync('kajola_access_token');
      const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      if (step === 0) {
        await fetch(`${API_BASE}/api/artisan/onboarding`, { method: 'POST', headers, body: JSON.stringify(profile) });
      }
      if (step === 1) {
        await fetch(`${API_BASE}/api/artisan/services`, { method: 'POST', headers, body: JSON.stringify({ services: [{ name: service.name, duration_minutes: Number(service.duration_minutes), price_cents: Number(service.price_cents) }] }) });
      }
      if (step === 2) {
        await fetch(`${API_BASE}/api/artisan/portfolio`, { method: 'POST', headers, body: JSON.stringify({ portfolio: [{ url: portfolioUrl, caption: 'Portfolio sample' }] }) });
      }
      if (step === 3) {
        await fetch(`${API_BASE}/api/artisan/availability`, { method: 'POST', headers, body: JSON.stringify({ windows: [{ starts_at: availability.starts_at, ends_at: availability.ends_at, slot_interval_minutes: Number(availability.slot_interval_minutes), max_bookings_per_slot: 1 }] }) });
      }
      if (step === 4) {
        await fetch(`${API_BASE}/api/artisan/verification`, { method: 'POST', headers, body: JSON.stringify({ type: 'phone' }) });
      }
      setStep((current) => Math.min(steps.length - 1, current + 1));
      setMessage('Saved, continue to the next step.');
    } catch (err) {
      setMessage((err as Error).message || 'Failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text style={{ fontSize: 28, fontWeight: '700', marginBottom: 12 }}>Artisan Onboarding</Text>
        <Text style={{ marginBottom: 20, color: '#6B7280' }}>{steps[step]}</Text>
        {step === 0 ? (
          <>
            <TextInput value={profile.business_name} onChangeText={(text) => setProfile({ ...profile, business_name: text })} placeholder="Business name" style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, marginBottom: 12 }} />
            <TextInput value={profile.category} onChangeText={(text) => setProfile({ ...profile, category: text })} placeholder="Category" style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, marginBottom: 12 }} />
            <TextInput value={profile.headline} onChangeText={(text) => setProfile({ ...profile, headline: text })} placeholder="Headline" style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, marginBottom: 12 }} />
            <TextInput value={profile.description} onChangeText={(text) => setProfile({ ...profile, description: text })} placeholder="Description" multiline style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, minHeight: 100, marginBottom: 12 }} />
            <TextInput value={profile.city} onChangeText={(text) => setProfile({ ...profile, city: text })} placeholder="City" style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, marginBottom: 12 }} />
            <TextInput value={profile.profile_photo_url} onChangeText={(text) => setProfile({ ...profile, profile_photo_url: text })} placeholder="Profile photo URL" style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12 }} />
          </>
        ) : step === 1 ? (
          <>
            <TextInput value={service.name} onChangeText={(text) => setService({ ...service, name: text })} placeholder="Service name" style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, marginBottom: 12 }} />
            <TextInput keyboardType="numeric" value={service.duration_minutes} onChangeText={(text) => setService({ ...service, duration_minutes: text })} placeholder="Duration minutes" style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, marginBottom: 12 }} />
            <TextInput keyboardType="numeric" value={service.price_cents} onChangeText={(text) => setService({ ...service, price_cents: text })} placeholder="Price in cents" style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12 }} />
          </>
        ) : step === 2 ? (
          <TextInput value={portfolioUrl} onChangeText={setPortfolioUrl} placeholder="Portfolio image URL" style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12 }} />
        ) : step === 3 ? (
          <>
            <TextInput value={availability.starts_at} onChangeText={(text) => setAvailability({ ...availability, starts_at: text })} placeholder="Starts at (ISO)" style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, marginBottom: 12 }} />
            <TextInput value={availability.ends_at} onChangeText={(text) => setAvailability({ ...availability, ends_at: text })} placeholder="Ends at (ISO)" style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, marginBottom: 12 }} />
            <TextInput keyboardType="numeric" value={availability.slot_interval_minutes} onChangeText={(text) => setAvailability({ ...availability, slot_interval_minutes: text })} placeholder="Slot interval minutes" style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12 }} />
          </>
        ) : (
          <Text>Submit your phone verification request to complete onboarding.</Text>
        )}
        <View style={{ marginTop: 24 }}>
          <Button title={loading ? 'Saving…' : step === steps.length - 1 ? 'Request verification' : 'Save and continue'} onPress={submitStep} disabled={loading} />
        </View>
        {message ? <Text style={{ marginTop: 16, color: '#2563eb' }}>{message}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
