import { Slot } from 'expo-router';
import { View, Text } from 'react-native';

export default function RootLayout() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ fontSize: 18, marginBottom: 16 }}>Loading Kajola...</Text>
      <Slot />
    </View>
  );
}
