'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LogoutPage() {
  const [message, setMessage] = useState('Logging out…');
  const router = useRouter();

  useEffect(() => {
    window.localStorage.removeItem('kajola_access_token');
    window.localStorage.removeItem('kajola_refresh_token');
    setMessage('Logged out. Redirecting…');
    const timer = window.setTimeout(() => router.push('/'), 800);
    return () => window.clearTimeout(timer);
  }, [router]);

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '0 auto' }}>
      <h1>{message}</h1>
    </main>
  );
}
