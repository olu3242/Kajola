'use client';

import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

export default function GoogleSignInButton({ label = 'Continue with Google' }: { label?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setLoading(true);
    setError(null);

    try {
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo }
      });

      if (error) {
        setError(error.message);
      } else if (data?.url) {
        window.location.assign(data.url);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to start Google sign-in.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: 24, maxWidth: 420 }}>
      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={loading}
        style={{
          width: '100%',
          padding: '14px 18px',
          borderRadius: 10,
          border: '1px solid #D1D5DB',
          background: loading ? '#F3F4F6' : '#FFFFFF',
          color: '#111827',
          fontWeight: 700,
          cursor: loading ? 'not-allowed' : 'pointer'
        }}
      >
        {loading ? 'Opening Google…' : label}
      </button>
      {error ? <p style={{ marginTop: 12, color: '#B91C1C' }}>{error}</p> : null}
    </div>
  );
}
