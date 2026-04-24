'use client';

import { useEffect, useState } from 'react';
import { ScrollView, Text, View, Button } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Link, useLocalSearchParams } from 'expo-router';

type Booking = {
  id: string;
  status: string;
  created_at: string;
  notes?: string;
  service?: { name: string; price_cents: number };
  artisan?: { business_name: string };
  payments?: Array<{ status: string; amount_cents: number }>;
};

export default function BookingDetailScreen() {
  const params = useLocalSearchParams();
  const bookingId = params.bookingId as string;
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    const token = await SecureStore.getItemAsync('kajola_access_token');
    if (!token) {
      setError('Sign in to view booking');
      setLoading(false);
      return;
    }
    const res = await fetch(`/api/bookings/${bookingId}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Unable to load booking');
    } else {
      setBooking(data.booking);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [bookingId]);

  async function cancelBooking() {
    if (!booking) return;
    setSubmitting(true);
    setError('');
    const token = await SecureStore.getItemAsync('kajola_access_token');
    const res = await fetch(`/api/bookings/${bookingId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'cancelled' })
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Unable to cancel booking');
    } else {
      setBooking(data.booking);
    }
    setSubmitting(false);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 24 }}>
      <Link href="/bookings" style={{ marginBottom: 20 }}><Text style={{ color: '#2563eb' }}>← Back</Text></Link>
      <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 16 }}>Booking detail</Text>
      {loading && <Text>Loading…</Text>}
      {error ? <Text style={{ color: '#b91c1c' }}>{error}</Text> : null}
      {booking ? (
        <View style={{ padding: 16, borderRadius: 14, backgroundColor: '#f8fafc' }}>
          <Text style={{ fontSize: 18, fontWeight: '600' }}>{booking.service?.name ?? 'Service'}</Text>
          <Text>Status: {booking.status}</Text>
          <Text>Amount: NGN {(booking.service?.price_cents ?? 0) / 100}</Text>
          <Text>Booked at: {new Date(booking.created_at).toLocaleString()}</Text>
          {booking.notes ? <Text>Notes: {booking.notes}</Text> : null}
          {booking.payments?.map((payment, idx) => (
            <View key={idx} style={{ marginTop: 10 }}>
              <Text>Payment: NGN {payment.amount_cents / 100}</Text>
              <Text>Status: {payment.status}</Text>
            </View>
          ))}
          {booking.status !== 'cancelled' && booking.status !== 'completed' ? (
            <View style={{ marginTop: 20 }}>
              <Button title={submitting ? 'Cancelling…' : 'Cancel booking'} onPress={cancelBooking} disabled={submitting} />
            </View>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
