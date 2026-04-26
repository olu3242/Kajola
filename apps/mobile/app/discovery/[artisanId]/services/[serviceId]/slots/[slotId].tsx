import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, Linking, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';

type BookingSlot = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
};

type Service = {
  id: string;
  name: string;
  price_cents: number;
  currency: string;
};

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

export default function ConfirmSlotScreen() {
  const params = useLocalSearchParams();
  const artisanId = params.artisanId as string;
  const serviceId = params.serviceId as string;
  const slotId = params.slotId as string;
  const [slot, setSlot] = useState<BookingSlot | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [paymentMode, setPaymentMode] = useState<'instant' | 'escrow'>('instant');

  useEffect(() => {
    async function load() {
      try {
        const [slotResponse, serviceResponse, token] = await Promise.all([
          fetch(`${API_BASE}/api/booking-slots?slot_id=${slotId}`),
          fetch(`${API_BASE}/api/services?service_id=${serviceId}`),
          SecureStore.getItemAsync('kajola_access_token')
        ]);
        const slotData = await slotResponse.json();
        const serviceData = await serviceResponse.json();
        setSlot(slotData.booking_slot ?? null);
        setService(serviceData.service ?? null);
        setAccessToken(token);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    }
    if (slotId && serviceId) load();
  }, [slotId, serviceId]);

  async function handleCreateBooking() {
    if (!accessToken) {
      setMessage('Please sign in before booking.');
      return;
    }

    setMessage('');
    try {
      const bookingResponse = await fetch(`${API_BASE}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          slot_id: slotId,
          service_id: serviceId,
          artisan_id: artisanId,
          payment_mode: paymentMode
        })
      });
      const bookingData = await bookingResponse.json();
      if (!bookingResponse.ok) {
        setMessage(bookingData.error || 'Failed to create booking.');
        return;
      }

      const paymentResponse = await fetch(`${API_BASE}/api/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          booking_id: bookingData.booking.id,
          amount_cents: service?.price_cents ?? 0,
          currency: service?.currency ?? 'NGN',
          provider: 'paystack'
        })
      });
      const paymentData = await paymentResponse.json();
      if (!paymentResponse.ok) {
        setMessage(paymentData.error || 'Payment initiation failed.');
        return;
      }

      if (paymentData.payment_url) {
        setMessage('Booking created. Redirecting to payment.');
        await Linking.openURL(paymentData.payment_url);
        return;
      }

      setMessage('Payment URL missing.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unexpected error');
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  if (!slot || !service) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Text>Slot or service not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text style={{ fontSize: 28, fontWeight: '700', marginBottom: 16 }}>Confirm Booking</Text>
        <View style={{ marginBottom: 24, padding: 20, borderRadius: 16, backgroundColor: '#F8FAFC' }}>
          <Text style={{ fontWeight: '700', marginBottom: 8 }}>{service.name}</Text>
          <Text>NGN {service.price_cents / 100}</Text>
          <Text style={{ marginTop: 12 }}>Slot: {new Date(slot.start_at).toLocaleString()} - {new Date(slot.end_at).toLocaleString()}</Text>
          <Text>Status: {slot.status}</Text>
        </View>
        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontWeight: '700', marginBottom: 8 }}>Payment option</Text>
          <View style={{ marginBottom: 10 }}>
            <Button title="Pay Artisan Directly (Fastest)" onPress={() => setPaymentMode('instant')} color={paymentMode === 'instant' ? '#D9922A' : '#6B7280'} />
            <Text style={{ marginTop: 6 }}>Pay directly to artisan for faster service.</Text>
          </View>
          <View>
            <Button title="Use Kajola Secure Escrow" onPress={() => setPaymentMode('escrow')} color={paymentMode === 'escrow' ? '#D9922A' : '#6B7280'} />
            <Text style={{ marginTop: 6 }}>Funds held securely until work is completed.</Text>
          </View>
        </View>
        <Button title="Create booking and pay" onPress={handleCreateBooking} />
        {message ? <Text style={{ marginTop: 16, color: '#1F2937' }}>{message}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
