import { Text, View, TouchableOpacity } from 'react-native';
import { Link } from 'expo-router';

export default function HomeScreen() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 12 }}>Kajola Mobile</Text>
      <Text style={{ fontSize: 16, color: '#4B5563', marginBottom: 24 }}>Welcome to Kajola mobile.</Text>
      <Link href="/discovery" style={{ marginBottom: 16 }}><Text style={{ color: '#2563eb' }}>Browse artisans</Text></Link>
      <Link href="/artisan/onboarding" style={{ marginBottom: 16 }}><Text style={{ color: '#2563eb' }}>Artisan onboarding</Text></Link>
      <Link href="/artisan/dashboard" style={{ marginBottom: 16 }}><Text style={{ color: '#2563eb' }}>Artisan dashboard</Text></Link>
      <Link href="/artisan/billing" style={{ marginBottom: 16 }}><Text style={{ color: '#2563eb' }}>Billing & promotions</Text></Link>
      <Link href="/bookings"><Text style={{ color: '#2563eb' }}>My bookings</Text></Link>
      <Link href="/payments" style={{ marginTop: 16 }}><Text style={{ color: '#2563eb' }}>Payment history</Text></Link>
      <Link href="/logout" style={{ marginTop: 16 }}><Text style={{ color: '#ef4444' }}>Log out</Text></Link>
    </View>
  );
}
