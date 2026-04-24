import { useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Button, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';
import GoogleSignInButton from './GoogleSignInButton';

export default function SignupScreen() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [fullName, setFullName] = useState('');
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
        body: JSON.stringify({ phone, purpose: 'signup' })
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

  async function handleSignup() {
    setMessage('');
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp_code: otp, full_name: fullName })
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? 'Signup failed');
      } else {
        await SecureStore.setItemAsync('kajola_access_token', result.access_token);
        setMessage('Signup successful.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unexpected error');
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text style={{ fontSize: 28, fontWeight: '700', marginBottom: 24 }}>Sign up</Text>
        <View style={{ gap: 16 }}>
          <View>
            <Text style={{ marginBottom: 8 }}>Full name</Text>
            <TextInput
              value={fullName}
              onChangeText={setFullName}
              placeholder="Amina Ade"
              style={{ borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10, padding: 14 }}
            />
          </View>
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
          <Button title="Sign up" onPress={handleSignup} />
          {message ? <Text style={{ marginTop: 16, color: '#1F2937' }}>{message}</Text> : null}
        </View>
        <GoogleSignInButton />
      </ScrollView>
    </SafeAreaView>
  );
}
