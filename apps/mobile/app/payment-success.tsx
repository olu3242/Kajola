import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, SafeAreaView, Text, View } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

export default function PaymentSuccessScreen() {
  const { bookingId, reference } = useLocalSearchParams<{ bookingId: string; reference: string }>();
  const router = useRouter();
  const [state, setState] = useState<'verifying' | 'success' | 'failed'>('verifying');
  const [message, setMessage] = useState('Verifying payment...');

  useEffect(() => {
    async function verify() {
      const token = await SecureStore.getItemAsync('kajola_access_token');
      if (!bookingId || !reference || !token) {
        setState('failed');
        setMessage('Unable to verify this payment.');
        return;
      }
      const res = await fetch(`${API_BASE}/api/payments/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bookingId, reference })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setState('failed');
        setMessage(data.error ?? 'Payment verification failed.');
        return;
      }
      setState('success');
      setMessage(data.booking?.payment_mode === 'escrow' ? 'Your payment is secured in escrow' : 'Your artisan is confirmed');
    }
    verify();
  }, [bookingId, reference]);

  return (
    <SafeAreaView style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
      <View style={{ padding: 20, borderRadius: 12, backgroundColor: '#f8fafc' }}>
        {state === 'verifying' ? <ActivityIndicator /> : null}
        <Text style={{ fontSize: 22, fontWeight: '700', marginVertical: 12 }}>{message}</Text>
        {state === 'success' ? (
          <>
            <Text style={{ marginBottom: 16 }}>Review booking details and contact the artisan if anything changes.</Text>
            <Button title="View booking" onPress={() => router.replace({ pathname: '/bookings/[bookingId]', params: { bookingId } })} />
          </>
        ) : null}
        {state === 'failed' ? (
          <>
            <Text style={{ marginBottom: 16 }}>You can retry payment from the booking details screen.</Text>
            <Link href={{ pathname: '/bookings/[bookingId]', params: { bookingId } }}>Open booking</Link>
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
