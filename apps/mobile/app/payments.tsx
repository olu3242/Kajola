'use client';

import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Link } from 'expo-router';

type Payment = {
  id: string;
  status: string;
  amount_cents: number;
  currency: string;
  created_at: string;
  provider: string;
  provider_reference?: string;
  reference?: string;
};

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

export default function PaymentsScreen() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      const token = await SecureStore.getItemAsync('kajola_access_token');
      if (!token) {
        setError('Sign in to view payment history');
        setLoading(false);
        return;
      }
      const res = await fetch(`${API_BASE}/api/payments/history`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Unable to load payments');
      } else {
        setPayments(data.payments ?? []);
      }
      setLoading(false);
    }
    load();
  }, []);

  return (
    <ScrollView contentContainerStyle={{ padding: 24 }}>
      <Link href="/" style={{ marginBottom: 20 }}><Text style={{ color: '#2563eb' }}>← Home</Text></Link>
      <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 16 }}>Payment history</Text>
      {loading && <Text>Loading…</Text>}
      {error ? <Text style={{ color: '#b91c1c' }}>{error}</Text> : null}
      {payments.length === 0 && !loading && !error ? <Text>No payments found.</Text> : null}
      {payments.map((payment) => (
        <View key={payment.id} style={{ padding: 16, borderRadius: 14, backgroundColor: '#f8fafc', marginBottom: 12 }}>
          <Text style={{ fontSize: 18, fontWeight: '600' }}>{payment.provider}</Text>
          <Text>Amount: {payment.currency} {payment.amount_cents / 100}</Text>
          <Text>Status: {payment.status}</Text>
          <Text>Reference: {payment.reference ?? payment.provider_reference}</Text>
          <Text>{new Date(payment.created_at).toLocaleString()}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
