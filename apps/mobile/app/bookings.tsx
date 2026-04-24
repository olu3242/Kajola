'use client';

import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Link } from 'expo-router';

type Booking = {
  id: string;
  status: string;
  created_at: string;
  service?: { name: string };
  artisan?: { business_name: string };
};

export default function BookingsScreen() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      const token = await SecureStore.getItemAsync('kajola_access_token');
      if (!token) {
        setError('Sign in to view bookings');
        setLoading(false);
        return;
      }
      const res = await fetch('/api/bookings', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Unable to load bookings');
      } else {
        setBookings(data.bookings ?? []);
      }
      setLoading(false);
    }
    load();
  }, []);

  return (
    <ScrollView contentContainerStyle={{ padding: 24 }}>
      <Link href="/" style={{ marginBottom: 20 }}><Text style={{ color: '#2563eb' }}>← Home</Text></Link>
      <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 16 }}>My Bookings</Text>
      {loading && <Text>Loading…</Text>}
      {error ? <Text style={{ color: '#b91c1c' }}>{error}</Text> : null}
      {bookings.map((booking) => (
        <View key={booking.id} style={{ padding: 16, borderRadius: 14, backgroundColor: '#f8fafc', marginBottom: 12 }}>
          <Text style={{ fontSize: 18, fontWeight: '600' }}>{booking.service?.name ?? 'Service'}</Text>
          <Text>{booking.artisan?.business_name ?? 'Artisan'}</Text>
          <Text>Status: {booking.status}</Text>
          <Text>{new Date(booking.created_at).toLocaleString()}</Text>
          <Link href={`/bookings/${booking.id}`}><Text style={{ color: '#2563eb', marginTop: 8 }}>View details</Text></Link>
        </View>
      ))}
    </ScrollView>
  );
}
