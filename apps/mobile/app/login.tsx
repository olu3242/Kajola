import { useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Button, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [message, setMessage] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  async function handleSendOtp() {
    if (!phone) {
      setMessage('Enter your phone number first.');
      return;
    }

    setMessage('');
    setSendingOtp(true);

    try {
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, purpose: 'login' })
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? 'Failed to send OTP');
        setOtpSent(false);
      } else {
        setMessage('OTP sent. Check your phone or use debug code if testing.');
        setOtpSent(true);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unexpected error');
      setOtpSent(false);
    } finally {
      setSendingOtp(false);
    }
  }

  async function handleLogin() {
    setMessage('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp_code: otp })
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? 'Login failed');
      } else {
        await SecureStore.setItemAsync('kajola_access_token', result.access_token);
        setMessage('Login successful.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unexpected error');
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text style={{ fontSize: 28, fontWeight: '700', marginBottom: 24 }}>Login</Text>
        <View style={{ gap: 16 }}>
          <View>
            <Text style={{ marginBottom: 8 }}>Phone</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="+2348123456789"
              style={{ borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10, padding: 14 }}
            />
          </View>
          <View>
            <Text style={{ marginBottom: 8 }}>OTP Code</Text>
            <TextInput
              value={otp}
              onChangeText={setOtp}
              placeholder="123456"
              style={{ borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10, padding: 14 }}
            />
          </View>
          <Button title={sendingOtp ? 'Sending OTP…' : 'Send OTP'} onPress={handleSendOtp} disabled={sendingOtp || !phone} />
          {otpSent ? <Text style={{ marginTop: 12, color: '#047857' }}>OTP request submitted.</Text> : null}
          <Button title="Sign in" onPress={handleLogin} />
          {message ? <Text style={{ marginTop: 16, color: '#1F2937' }}>{message}</Text> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
