import { Slot } from 'expo-router';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Linking } from 'react-native';
import { View, Text } from 'react-native';

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    function routeUrl(url: string) {
      const parsed = new URL(url);
      if (parsed.hostname === 'payment-success' || parsed.pathname.includes('payment-success')) {
        const bookingId = parsed.searchParams.get('bookingId');
        const reference = parsed.searchParams.get('reference');
        if (bookingId) {
          router.replace({ pathname: '/payment-success', params: { bookingId, reference: reference ?? '' } });
        }
      }

      if (
        parsed.pathname.includes('/auth/callback') ||
        parsed.pathname.includes('auth/callback') ||
        (parsed.hostname === 'auth' && parsed.pathname === '/callback')
      ) {
        router.replace('/auth/callback');
      }
    }

    Linking.getInitialURL().then((url) => {
      if (url) routeUrl(url);
    });
    const subscription = Linking.addEventListener('url', ({ url }) => routeUrl(url));
    return () => subscription.remove();
  }, [router]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ fontSize: 18, marginBottom: 16 }}>Loading Kajola...</Text>
      <Slot />
    </View>
  );
}
