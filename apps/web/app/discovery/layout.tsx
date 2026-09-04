import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Discover trusted local services | Kajola',
  description: 'Compare verified service professionals, transparent prices, ratings, and availability across Nigeria.',
  openGraph: { title: 'Discover trusted local services | Kajola', description: 'Find and book trusted local service professionals across Nigeria.', type: 'website' },
};

export default function DiscoveryLayout({ children }: { children: React.ReactNode }) { return children; }
