import { useState } from 'react';
import { Button, Linking, Text, View } from 'react-native';
import { supabase } from '../lib/supabaseClient';

export default function GoogleSignInButton() {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleGoogleSignIn() {
    setLoading(true);
    setMessage('');

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: 'kajola://auth/callback' }
      });

      if (error) {
        setMessage(error.message);
      } else if (data?.url) {
        await Linking.openURL(data.url);
        setMessage('Continue in your browser to complete Google sign-in.');
      } else {
        setMessage('Continue in your browser to complete Google sign-in.');
      }
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Unable to start Google sign-in.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ marginTop: 20 }}>
      <Button title={loading ? 'Opening Google…' : 'Continue with Google'} onPress={handleGoogleSignIn} disabled={loading} />
      {message ? <Text style={{ marginTop: 12, color: '#111827' }}>{message}</Text> : null}
    </View>
  );
}
