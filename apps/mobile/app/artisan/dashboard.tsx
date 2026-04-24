import { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

export default function ArtisanDashboardScreen() {
  const [metrics, setMetrics] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const token = await SecureStore.getItemAsync('kajola_access_token');
        const res = await fetch(`${API_BASE}/api/artisan/dashboard`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Unable to load dashboard');
        setMetrics(data.metrics);
      } catch (err) {
        setError((err as Error).message);
      }
    }
    load();
  }, []);

  if (error) {
    return (
      <SafeAreaView style={{ flex: 1, padding: 24 }}>
        <Text style={{ color: '#b91c1c' }}>{error}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text style={{ fontSize: 28, fontWeight: '700', marginBottom: 16 }}>Artisan Dashboard</Text>
        {!metrics ? (
          <ActivityIndicator />
        ) : (
          <View style={{ gap: 16 }}>
            <View style={{ padding: 20, borderRadius: 16, backgroundColor: '#F8FAFC', marginBottom: 12 }}>
              <Text style={{ fontSize: 18, fontWeight: '700' }}>Total jobs</Text>
              <Text>{metrics.total_jobs}</Text>
            </View>
            <View style={{ padding: 20, borderRadius: 16, backgroundColor: '#F8FAFC', marginBottom: 12 }}>
              <Text style={{ fontSize: 18, fontWeight: '700' }}>Earnings</Text>
              <Text>NGN {(metrics.earnings / 100).toFixed(2)}</Text>
            </View>
            <View style={{ padding: 20, borderRadius: 16, backgroundColor: '#F8FAFC', marginBottom: 12 }}>
              <Text style={{ fontSize: 18, fontWeight: '700' }}>Trust score</Text>
              <Text>{metrics.trust_score}</Text>
            </View>
            <View style={{ padding: 20, borderRadius: 16, backgroundColor: '#F8FAFC', marginBottom: 12 }}>
              <Text style={{ fontSize: 18, fontWeight: '700' }}>Profile completion</Text>
              <Text>{metrics.profile_score}%</Text>
            </View>
            <View style={{ padding: 20, borderRadius: 16, backgroundColor: '#F8FAFC', marginBottom: 12 }}>
              <Text style={{ fontSize: 18, fontWeight: '700' }}>Views</Text>
              <Text>{metrics.views}</Text>
            </View>
            <View style={{ padding: 20, borderRadius: 16, backgroundColor: '#F8FAFC', marginBottom: 12 }}>
              <Text style={{ fontSize: 18, fontWeight: '700' }}>Clicks</Text>
              <Text>{metrics.clicks}</Text>
            </View>
            <View style={{ padding: 20, borderRadius: 16, backgroundColor: '#F8FAFC', marginBottom: 12 }}>
              <Text style={{ fontSize: 18, fontWeight: '700' }}>Conversion rate</Text>
              <Text>{metrics.conversion_rate}%</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
