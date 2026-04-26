import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

type BookingSlot = {
  id: string;
  start_at: string;
  end_at: string;
};

export default function SlotSelectionScreen() {
  const params = useLocalSearchParams();
  const artisanId = params.artisanId as string;
  const serviceId = params.serviceId as string;
  const router = useRouter();
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch(`${process.env.EXPO_PUBLIC_API_BASE_URL ?? ''}/api/booking-slots?artisan_id=${artisanId}&service_id=${serviceId}&status=available`);
        const data = await response.json();
        setSlots(data.booking_slots ?? []);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    }
    if (artisanId && serviceId) load();
  }, [artisanId, serviceId]);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
      <View style={{ padding: 24 }}>
        <Text style={{ fontSize: 28, fontWeight: '700', marginBottom: 24 }}>Pick a slot</Text>
        <FlatList
          data={slots}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({
                pathname: '/discovery/[artisanId]/services/[serviceId]/slots/[slotId]',
                params: {
                artisanId,
                serviceId,
                slotId: item.id
                }
              })}
              style={{ marginBottom: 16, padding: 20, borderRadius: 16, backgroundColor: '#F8FAFC' }}
            >
              <Text style={{ fontSize: 18, fontWeight: '700' }}>{new Date(item.start_at).toLocaleString()}</Text>
              <Text style={{ marginTop: 8, color: '#6B7280' }}>Until {new Date(item.end_at).toLocaleString()}</Text>
            </Pressable>
          )}
          ListEmptyComponent={() => <Text>No available slots yet.</Text>}
        />
      </View>
    </SafeAreaView>
  );
}
