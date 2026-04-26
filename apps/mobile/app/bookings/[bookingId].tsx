import { useEffect, useState } from 'react';
import { Button, Linking, ScrollView, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Link, useLocalSearchParams } from 'expo-router';

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
type Booking = {
  id: string;
  status: string;
  payment_mode?: 'instant' | 'escrow';
  created_at: string;
  notes?: string;
  services?: { name: string; price_cents: number; currency: string };
  service?: { name: string; price_cents: number; currency: string };
  artisans?: { business_name: string };
  artisan?: { business_name: string };
  payments?: Array<{ status: string; amount_cents: number }>;
  escrow_accounts?: Array<{ status: string; amount: number; currency: string; milestones?: Array<{ name: string; status: string }> }>;
  reviews?: Array<{ id: string }>;
};

const reviewTags = ['fast', 'professional', 'clean', 'great_value', 'on_time', 'late', 'rude', 'poor_quality'];

export default function BookingDetailScreen() {
  const params = useLocalSearchParams();
  const bookingId = params.bookingId as string;
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    const token = await SecureStore.getItemAsync('kajola_access_token');
    if (!token) {
      setError('Sign in to view booking');
      setLoading(false);
      return;
    }
    const res = await fetch(`${API_BASE}/api/bookings/${bookingId}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Unable to load booking');
    else {
      setBooking(data.booking);
      setError('');
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [bookingId]);

  useEffect(() => {
    if (booking?.status !== 'awaiting_payment') return;
    const id = setInterval(() => load(true), 4000);
    return () => clearInterval(id);
  }, [booking?.status, bookingId]);

  async function cancelBooking() {
    setSubmitting(true);
    const token = await SecureStore.getItemAsync('kajola_access_token');
    const res = await fetch(`${API_BASE}/api/bookings/${bookingId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'cancelled' })
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Unable to cancel booking');
    else setBooking(data.booking);
    setSubmitting(false);
  }

  async function retryPayment() {
    setSubmitting(true);
    const token = await SecureStore.getItemAsync('kajola_access_token');
    const res = await fetch(`${API_BASE}/api/payments/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bookingId })
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error ?? 'Unable to retry payment');
      return;
    }
    await Linking.openURL(data.payment_url);
  }

  async function submitReview() {
    setSubmitting(true);
    const token = await SecureStore.getItemAsync('kajola_access_token');
    const res = await fetch(`${API_BASE}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ booking_id: bookingId, rating, comment, tags: selectedTags })
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Unable to submit review');
    else await load(true);
    setSubmitting(false);
  }

  const service = booking?.services ?? booking?.service;
  const artisan = booking?.artisans ?? booking?.artisan;
  const payment = booking?.payments?.[0];
  const escrow = booking?.escrow_accounts?.[0];
  const timeline = booking?.payment_mode === 'escrow'
    ? ['pending', 'awaiting_payment', 'in_progress', 'completed']
    : ['pending', 'awaiting_payment', 'confirmed', 'completed'];

  return (
    <ScrollView contentContainerStyle={{ padding: 24 }}>
      <Link href="/bookings" style={{ marginBottom: 20 }}><Text style={{ color: '#2563eb' }}>Back</Text></Link>
      <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 16 }}>Booking detail</Text>
      {loading && <Text>Loading...</Text>}
      {error ? <Text style={{ color: '#b91c1c' }}>{error}</Text> : null}
      {booking ? (
        <View style={{ padding: 16, borderRadius: 8, backgroundColor: '#f8fafc' }}>
          <Text style={{ fontSize: 18, fontWeight: '700' }}>{service?.name ?? 'Service'}</Text>
          <Text>Status: {booking.status}</Text>
          <Text>Artisan: {artisan?.business_name ?? 'Assigned artisan'}</Text>
          <Text>Amount: {service?.currency ?? 'NGN'} {((service?.price_cents ?? payment?.amount_cents ?? 0) / 100).toLocaleString()}</Text>
          <Text>Scheduled time: {new Date(booking.created_at).toLocaleString()}</Text>
          <Text>Payment status: {payment?.status ?? 'pending'}</Text>
          <Text>Payment mode: {booking.payment_mode === 'escrow' ? 'Kajola Secure Escrow' : 'Instant direct payment'}</Text>
          <View style={{ marginVertical: 16 }}>
            {timeline.map((step) => (
              <Text key={step} style={{ color: timeline.indexOf(step) <= Math.max(timeline.indexOf(booking.status), 0) ? '#166534' : '#6b7280' }}>
                {step === booking.status ? '●' : '○'} {step}
              </Text>
            ))}
          </View>
          {booking.payment_mode !== 'escrow' && booking.status === 'confirmed' ? (
            <Text style={{ marginBottom: 12, fontWeight: '700' }}>Payment sent to artisan</Text>
          ) : null}
          {booking.payment_mode === 'escrow' ? (
            <View style={{ marginBottom: 12, padding: 12, backgroundColor: '#fff', borderRadius: 8 }}>
              <Text style={{ fontWeight: '700' }}>Kajola Secure Escrow</Text>
              <Text>Funds held securely until work is completed.</Text>
              <Text>Status: {escrow?.status ?? (booking.status === 'in_progress' ? 'held' : 'pending')}</Text>
              {(escrow?.milestones ?? [
                { name: 'Payment secured', status: booking.status === 'in_progress' ? 'completed' : 'pending' },
                { name: 'Work in progress', status: booking.status === 'in_progress' ? 'active' : 'pending' },
                { name: 'Release payout', status: 'pending' }
              ]).map((milestone) => (
                <Text key={milestone.name}>{milestone.status === 'completed' ? '●' : '○'} {milestone.name}</Text>
              ))}
            </View>
          ) : null}
          {['pending', 'awaiting_payment'].includes(booking.status) && payment?.status !== 'successful' ? (
            <View style={{ marginBottom: 12 }}><Button title="Retry payment" onPress={retryPayment} disabled={submitting} /></View>
          ) : null}
          {['pending', 'awaiting_payment', 'confirmed', 'in_progress'].includes(booking.status) ? (
            <Button title={submitting ? 'Cancelling...' : 'Cancel booking'} onPress={cancelBooking} disabled={submitting} />
          ) : null}
          {booking.status === 'completed' && !booking.reviews?.length ? (
            <View style={{ marginTop: 20, padding: 12, backgroundColor: '#fff', borderRadius: 8 }}>
              <Text style={{ fontSize: 18, fontWeight: '700' }}>Rate your experience</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginVertical: 12 }}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <Button key={value} title={value <= rating ? '★' : '☆'} onPress={() => setRating(value)} />
                ))}
              </View>
              <Text onPress={() => setComment(comment ? '' : 'Great service')}>{comment || 'Tap to add a quick comment'}</Text>
              <View style={{ marginVertical: 12 }}>
                {reviewTags.map((tag) => (
                  <Text key={tag} onPress={() => setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])} style={{ padding: 6, color: selectedTags.includes(tag) ? '#166534' : '#374151' }}>
                    {selectedTags.includes(tag) ? '●' : '○'} {tag}
                  </Text>
                ))}
              </View>
              <Button title="Submit review" onPress={submitReview} disabled={submitting} />
            </View>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
