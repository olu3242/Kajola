import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kajola Dashboard',
  description: 'Multi-tenant marketplace dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
