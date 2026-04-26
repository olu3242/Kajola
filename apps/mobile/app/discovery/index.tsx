import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';

type Artisan = {
  id: string;
  business_name: string;
  headline?: string;
  category?: string;
  city?: string;
  reason?: string;
  stats?: { avg_rating?: number; total_reviews?: number; completed_jobs?: number };
  badges?: string[];
};

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

async function loadSection(path: string, token: string | null) {
  const res = await fetch(`${API_BASE}${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  const data = await res.json();
  return data.artisans ?? [];
}

export default function DiscoveryScreen() {
  const router = useRouter();
  const [recommended, setRecommended] = useState<Artisan[]>([]);
  const [topRated, setTopRated] = useState<Artisan[]>([]);
  const [popular, setPopular] = useState<Artisan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const token = await SecureStore.getItemAsync('kajola_access_token');
      const [recommendedData, topRatedData, popularData] = await Promise.all([
        loadSection('/api/discovery/recommended', token),
        loadSection('/api/artisans?limit=6', null),
        loadSection('/api/discovery/popular', null)
      ]);
      setRecommended(recommendedData);
      setTopRated(topRatedData);
      setPopular(popularData);
      setLoading(false);
    }
    load();
  }, []);

  async function track(artisanId: string, event_type: 'view' | 'click') {
    const token = await SecureStore.getItemAsync('kajola_access_token');
    if (!token) return;
    await fetch(`${API_BASE}/api/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ artisan_id: artisanId, event_type })
    }).catch(() => {});
  }

  function renderCard(item: Artisan, label: string) {
    return (
      <Pressable
        key={`${label}-${item.id}`}
        onPress={() => {
          track(item.id, 'click');
          router.push({ pathname: '/discovery/[artisanId]', params: { artisanId: item.id } });
        }}
        onLayout={() => track(item.id, 'view')}
        style={{ marginBottom: 12, padding: 16, borderRadius: 8, backgroundColor: '#F8FAFC' }}
      >
        <Text style={{ color: '#6B7280' }}>{item.reason ?? label}</Text>
        <Text style={{ fontSize: 18, fontWeight: '700', marginTop: 6 }}>{item.business_name}</Text>
        <Text style={{ marginTop: 6, color: '#6B7280' }}>{item.headline || item.category}</Text>
        <Text style={{ marginTop: 8 }}>⭐ {Number(item.stats?.avg_rating ?? 0).toFixed(1)} ({item.stats?.total_reviews ?? 0}) · {item.stats?.completed_jobs ?? 0} jobs</Text>
        {item.badges?.length ? <Text style={{ marginTop: 8, color: '#166534', fontWeight: '700' }}>{item.badges.join(' · ')}</Text> : null}
      </Pressable>
    );
  }

  function section(title: string, label: string, items: Artisan[]) {
    return (
      <View style={{ marginTop: 24 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 12 }}>{title}</Text>
        {items.length === 0 ? <Text>No artisans available yet.</Text> : items.map((item) => renderCard(item, label))}
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text style={{ fontSize: 28, fontWeight: '700', marginBottom: 8 }}>Discover</Text>
        <Text style={{ color: '#4B5563' }}>Smart picks ranked by trust, availability, and booking momentum.</Text>
        {loading ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
          <>
            {section('Recommended for You', 'Because of your recent activity', recommended)}
            {section('Top Rated Near You', 'Highly rated near you', topRated)}
            {section('Popular Right Now', 'Popular right now', popular)}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
