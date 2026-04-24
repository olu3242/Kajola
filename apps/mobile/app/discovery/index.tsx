import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, Text, View } from 'react-native';

type Artisan = {
  id: string;
  business_name: string;
  headline: string;
  category: string;
  city: string;
};

export default function DiscoveryScreen({ navigation }: any) {
  const [artisans, setArtisans] = useState<Artisan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch('/api/artisans');
        const data = await response.json();
        setArtisans(data.artisans ?? []);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
      <View style={{ padding: 24 }}>
        <Text style={{ fontSize: 28, fontWeight: '700', marginBottom: 16 }}>Discover</Text>
        {loading ? (
          <ActivityIndicator />
        ) : (
          <FlatList
            data={artisans}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => navigation.push('discovery/[artisanId]', { artisanId: item.id })}
                style={{ marginBottom: 16, padding: 20, borderRadius: 16, backgroundColor: '#F8FAFC' }}
              >
                <Text style={{ fontSize: 18, fontWeight: '700' }}>{item.business_name}</Text>
                <Text style={{ marginTop: 8, color: '#6B7280' }}>{item.headline || item.category}</Text>
                <Text style={{ marginTop: 8, color: '#4B5563' }}>{item.city}</Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
