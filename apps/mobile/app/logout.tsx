'use client';

import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';

export default function LogoutScreen() {
  const [message, setMessage] = useState('Logging out…');
  const router = useRouter();

  useEffect(() => {
    async function clear() {
      await SecureStore.deleteItemAsync('kajola_access_token');
      await SecureStore.deleteItemAsync('kajola_refresh_token');
      setMessage('Logged out. Redirecting…');
      router.push('/');
    }
    clear();
  }, [router]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <Text style={{ fontSize: 18 }}>{message}</Text>
    </View>
  );
}
