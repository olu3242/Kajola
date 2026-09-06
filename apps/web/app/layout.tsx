import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kajola — Trusted local services',
  description: 'Africa’s Service Commerce Operating System. Discover and book trusted local service professionals near you.',
  openGraph: {
    title: 'Kajola — Trusted local services',
    description: 'Africa’s Service Commerce Operating System for customers and service businesses.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
