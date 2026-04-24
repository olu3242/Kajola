'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState('Processing Google sign-in...');

  useEffect(() => {
    async function handleRedirect() {
      const { data, error } = await supabase.auth.getSessionFromUrl({ storeSession: false });
      if (error || !data.session) {
        setMessage(error?.message ?? 'Unable to complete Google sign-in.');
        return;
      }

      const session = data.session;
      const user = session.user;
      const token = session.access_token;
      const refreshToken = session.refresh_token;

      if (token) window.localStorage.setItem('kajola_access_token', token);
      if (refreshToken) window.localStorage.setItem('kajola_refresh_token', refreshToken);

      const profileResponse = await fetch('/api/auth/google-callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user })
      });

      const profileData = await profileResponse.json();
      if (!profileResponse.ok) {
        setMessage(profileData.error ?? 'Failed to sync Google profile.');
        return;
      }

      router.replace(profileData.redirectTo || '/dashboard');
    }

    handleRedirect();
  }, [router]);

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '0 auto' }}>
      <h1>Google sign-in</h1>
      <p>{message}</p>
    </main>
  );
}
