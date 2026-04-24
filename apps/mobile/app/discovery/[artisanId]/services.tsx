import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';

type Service = {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  duration_minutes: number;
};

export default function ServiceListScreen() {
  const params = useLocalSearchParams();
  const artisanId = params.artisanId as string;
  const navigation = useNavigation();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch(`/api/services?artisan_id=${artisanId}`);
        const data = await response.json();
        setServices(data.services ?? []);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    }
    if (artisanId) load();
  }, [artisanId]);

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
        <Text style={{ fontSize: 28, fontWeight: '700', marginBottom: 24 }}>Services</Text>
        <FlatList
          data={services}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => navigation.push('discovery/[artisanId]/services/[serviceId]/slots', {
                artisanId,
                serviceId: item.id
              })}
              style={{ marginBottom: 16, padding: 20, borderRadius: 16, backgroundColor: '#F8FAFC' }}
            >
              <Text style={{ fontSize: 18, fontWeight: '700' }}>{item.name}</Text>
              <Text style={{ marginTop: 8, color: '#6B7280' }}>{item.description}</Text>
              <Text style={{ marginTop: 8, color: '#4B5563' }}>
                NGN {item.price_cents / 100} • {item.duration_minutes} mins
              </Text>
            </Pressable>
          )}
        />
      </View>
    </SafeAreaView>
  );
}
