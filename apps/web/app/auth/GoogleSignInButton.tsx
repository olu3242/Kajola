'use client';

import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { Alert, Button } from '../components/ui';

export default function GoogleSignInButton({ label = 'Continue with Google' }: { label?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setLoading(true);
    setError(null);

    try {
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { data, error } = await supabase!.auth.signInWithOAuth({
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
    <div style={{ marginTop: 'var(--space-5)' }}>
      <Button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={loading}
        variant="outline"
        block
      >
        {loading ? 'Opening Google…' : label}
      </Button>
      {error ? <div style={{ marginTop: 'var(--space-3)' }}><Alert tone="error">{error}</Alert></div> : null}
    </div>
  );
}
