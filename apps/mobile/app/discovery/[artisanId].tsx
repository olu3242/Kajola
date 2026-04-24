import { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

export default function ArtisanDetailScreen() {
  const params = useLocalSearchParams();
  const artisanId = params.artisanId as string;
  const [artisan, setArtisan] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch(`/api/artisans?id=${artisanId}`);
        const data = await response.json();
        setArtisan(data.artisan);
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

  if (!artisan) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Text>Artisan not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text style={{ fontSize: 28, fontWeight: '700' }}>{artisan.business_name}</Text>
        <Text style={{ marginTop: 12, fontSize: 16, color: '#4B5563' }}>{artisan.headline || artisan.category}</Text>
        <View style={{ marginTop: 24, gap: 12 }}>
          <Text style={{ fontWeight: '700' }}>Location</Text>
          <Text>{artisan.city}, {artisan.state}</Text>
          <Text style={{ fontWeight: '700', marginTop: 16 }}>Description</Text>
          <Text>{artisan.description || 'No description yet.'}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
