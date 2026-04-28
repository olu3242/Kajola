import { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, Text, View, Linking } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../../lib/supabaseClient';
import { useRouter } from 'expo-router';

export default function AuthCallbackScreen() {
  const [message, setMessage] = useState('Completing Google sign-in...');
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    async function handleCallback() {
      try {
        const url = await Linking.getInitialURL();
        if (!url) {
          throw new Error('Unable to read auth callback URL.');
        }

        const { data, error } = await supabase.auth.exchangeCodeForSession(url);
        if (error || !data.session) {
          throw new Error(error?.message ?? 'Unable to complete Google sign-in.');
        }

        const session = data.session;
        if (session.access_token) {
          await SecureStore.setItemAsync('kajola_access_token', session.access_token);
        }
        if (session.refresh_token) {
          await SecureStore.setItemAsync('kajola_refresh_token', session.refresh_token);
        }

        const profileResponse = await supabase.functions.invoke('auth/google-callback', {
          body: { user: session.user }
        });

        if (profileResponse.error) {
          throw new Error(profileResponse.error.message ?? 'Failed to sync profile.');
        }

        router.replace('/dashboard');
      } catch (caught) {
        setMessage(caught instanceof Error ? caught.message : 'Unexpected Google sign-in error.');
      } finally {
        setLoading(false);
      }
    }

    handleCallback();
  }, [router]);

  return (
    <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      {loading ? <ActivityIndicator size="large" /> : null}
      <View style={{ marginTop: 16, maxWidth: '100%' }}>
        <Text style={{ fontSize: 20, fontWeight: '700', textAlign: 'center' }}>Google sign-in</Text>
        <Text style={{ marginTop: 12, textAlign: 'center', color: '#111827' }}>{message}</Text>
      </View>
    </SafeAreaView>
  );
}
