import { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

export default function ArtisanDetailScreen() {
  const params = useLocalSearchParams();
  const artisanId = params.artisanId as string;
  const [artisan, setArtisan] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const base = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
        const [response, reviewResponse] = await Promise.all([
          fetch(`${base}/api/artisans?id=${artisanId}`),
          fetch(`${base}/api/artisans/${artisanId}/reviews`)
        ]);
        const data = await response.json();
        const reviewData = await reviewResponse.json();
        setArtisan(data.artisan);
        setReviews(reviewData.reviews ?? []);
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
        <Text style={{ marginTop: 12 }}>⭐ {Number(artisan.stats?.avg_rating ?? 0).toFixed(1)} ({artisan.stats?.total_reviews ?? 0}) · {artisan.stats?.completed_jobs ?? 0} jobs completed</Text>
        {artisan.badges?.length ? <Text style={{ marginTop: 8, color: '#166534', fontWeight: '700' }}>{artisan.badges.join(' · ')}</Text> : null}
        <View style={{ marginTop: 24, gap: 12 }}>
          <Text style={{ fontWeight: '700' }}>Location</Text>
          <Text>{artisan.city}, {artisan.state}</Text>
          <Text style={{ fontWeight: '700', marginTop: 16 }}>Description</Text>
          <Text>{artisan.description || 'No description yet.'}</Text>
        </View>
        <View style={{ marginTop: 28 }}>
          <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 12 }}>Reviews</Text>
          {reviews.length === 0 ? <Text>No reviews yet.</Text> : reviews.map((review) => (
            <View key={review.id} style={{ padding: 12, backgroundColor: '#F8FAFC', borderRadius: 8, marginBottom: 10 }}>
              <Text>⭐ {review.rating}/5</Text>
              {review.comment ? <Text style={{ marginTop: 6 }}>{review.comment}</Text> : null}
              {review.review_tags?.length ? <Text style={{ marginTop: 6 }}>{review.review_tags.map((tag: any) => `#${tag.tag}`).join(' ')}</Text> : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
