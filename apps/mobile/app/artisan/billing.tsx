import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

type SubscriptionPlan = {
  tier: string;
  title: string;
  description: string;
  rank_boost: number;
  analytics: boolean;
};

type FeaturedOption = {
  type: string;
  title: string;
  description: string;
  suggested_amount_cents: number;
  duration_days: number;
};

export default function BillingScreen() {
  const [subscription, setSubscription] = useState<any>(null);
  const [featuredOptions, setFeaturedOptions] = useState<FeaturedOption[]>([]);
  const [selectedPlan, setSelectedPlan] = useState('free');
  const [selectedFeatured, setSelectedFeatured] = useState('boost');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      const token = await SecureStore.getItemAsync('kajola_access_token');
      const [subsRes, featRes] = await Promise.all([
        fetch(`${API_BASE}/api/revenue/subscriptions`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined),
        fetch(`${API_BASE}/api/revenue/featured`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
      ]);
      const subsJson = await subsRes.json();
      const featJson = await featRes.json();
      setSubscription(subsJson.subscription ?? subsJson);
      setFeaturedOptions(featJson.options ?? []);
      setSelectedPlan(subsJson.subscription?.current_tier ?? 'free');
    }
    load().catch((err) => setError(err.message));
  }, []);

  async function upgradePlan() {
    setStatus('Updating plan...');
    setError('');
    try {
      const token = await SecureStore.getItemAsync('kajola_access_token');
      const amount = selectedPlan === 'pro' ? 12000 : selectedPlan === 'elite' ? 24000 : 0;
      const res = await fetch(`${API_BASE}/api/revenue/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subscription_tier: selectedPlan, amount_cents: amount, currency: 'NGN' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to update plan');
      setSubscription({ ...subscription, current_tier: selectedPlan });
      setStatus(`Upgraded to ${selectedPlan}`);
    } catch (err) {
      setError((err as Error).message);
      setStatus('');
    }
  }

  async function purchaseFeatured() {
    setStatus('Purchasing featured listing...');
    setError('');
    try {
      const token = await SecureStore.getItemAsync('kajola_access_token');
      const option = featuredOptions.find((opt) => opt.type === selectedFeatured);
      if (!option) throw new Error('Featured option not found');
      const res = await fetch(`${API_BASE}/api/revenue/featured`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: option.type, duration_days: option.duration_days, amount_cents: option.suggested_amount_cents, currency: 'NGN' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to purchase featured listing');
      setStatus('Featured listing purchased successfully');
    } catch (err) {
      setError((err as Error).message);
      setStatus('');
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text style={{ fontSize: 28, fontWeight: '700', marginBottom: 8 }}>Billing</Text>
        <Text style={{ color: '#4B5563', marginBottom: 18 }}>Manage your subscription and featured listing spend.</Text>
        {error ? <Text style={{ color: '#b91c1c', marginBottom: 12 }}>{error}</Text> : null}

        {!subscription ? (
          <ActivityIndicator />
        ) : (
          <>
            <View style={{ padding: 18, borderRadius: 16, backgroundColor: '#f8fafc', marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8 }}>Current plan</Text>
              <Text>{subscription.current_tier}</Text>
              <Text>Platform fee: {subscription.platform_fee_percent}%</Text>
            </View>

            <View style={{ padding: 18, borderRadius: 16, backgroundColor: '#ecfdf5', marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8 }}>Subscription plans</Text>
              {subscription.plans.map((plan: SubscriptionPlan) => (
                <Pressable key={plan.tier} onPress={() => setSelectedPlan(plan.tier)} style={{ marginBottom: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: selectedPlan === plan.tier ? '#2563eb' : '#d1d5db', marginRight: 12 }} />
                    <View>
                      <Text style={{ fontWeight: '700' }}>{plan.title}</Text>
                      <Text>{plan.description}</Text>
                    </View>
                  </View>
                </Pressable>
              ))}
              <Pressable onPress={upgradePlan} style={{ marginTop: 12, padding: 14, backgroundColor: '#2563eb', borderRadius: 12 }}>
                <Text style={{ color: '#fff', textAlign: 'center' }}>Upgrade plan</Text>
              </Pressable>
            </View>

            <View style={{ padding: 18, borderRadius: 16, backgroundColor: '#fff7ed', marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8 }}>Featured listings</Text>
              {featuredOptions.map((option) => (
                <Pressable key={option.type} onPress={() => setSelectedFeatured(option.type)} style={{ marginBottom: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: selectedFeatured === option.type ? '#16a34a' : '#d1d5db', marginRight: 12 }} />
                    <View>
                      <Text style={{ fontWeight: '700' }}>{option.title}</Text>
                      <Text>{option.description}</Text>
                      <Text>{option.suggested_amount_cents / 100} NGN for {option.duration_days} days</Text>
                    </View>
                  </View>
                </Pressable>
              ))}
              <Pressable onPress={purchaseFeatured} style={{ marginTop: 12, padding: 14, backgroundColor: '#047857', borderRadius: 12 }}>
                <Text style={{ color: '#fff', textAlign: 'center' }}>Purchase featured listing</Text>
              </Pressable>
            </View>

            {status ? <Text style={{ color: '#065f46' }}>{status}</Text> : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
