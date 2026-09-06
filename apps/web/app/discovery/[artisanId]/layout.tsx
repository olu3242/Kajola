import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Provider profile and availability | Kajola',
  description: 'View verified provider services, transparent prices, reviews, and real booking availability on Kajola.',
  openGraph: { title: 'Provider profile and availability | Kajola', description: 'Choose a local service and book real availability.', type: 'website' },
};

export default function ProviderLayout({ children }: { children: React.ReactNode }) { return children; }
