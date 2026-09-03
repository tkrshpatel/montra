import { View, Text, StyleSheet, Pressable, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import Feather from '@react-native-vector-icons/feather';
import * as Haptics from 'expo-haptics';
import { api } from '../src/api';
import { useAuth } from '../src/auth/AuthContext';
import { COLORS, SPACING, RADIUS, FONT, currencySymbol } from '../src/theme';

export default function Settle() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ friend_id: string; name: string; amount?: string }>();

  const preset = params.amount ? String(params.amount) : '';
  const [amount, setAmount] = useState(preset);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const currency = user?.currency || 'USD';
  const sym = currencySymbol(currency);

  const save = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setErr('Enter a positive amount'); return; }
    setSaving(true);
    setErr(null);
    try {
      await api.createSettlement({
        friend_id: params.friend_id,
        amount: amt,
        currency,
        note: note || null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } catch (e: any) {
      setErr('Failed to save settlement');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.surface }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="close-settle">
          <Feather name="x" size={24} color={COLORS.onSurface} />
        </Pressable>
        <Text style={styles.title}>Settle up</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxxl }} keyboardShouldPersistTaps="handled">
        <View style={styles.friendCard}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{(params.name || '?').slice(0,1).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.friendName}>{params.name}</Text>
            <Text style={styles.friendSub}>owes you {sym}{parseFloat(preset || '0').toFixed(2)}</Text>
          </View>
        </View>

        <Text style={styles.label}>Repayment amount ({currency})</Text>
        <View style={styles.amountRow}>
          <Text style={styles.amountSym}>{sym}</Text>
          <TextInput
            value={amount}
            onChangeText={(v) => { setAmount(v); if (err) setErr(null); }}
            placeholder="0.00"
            placeholderTextColor={COLORS.onSurfaceTertiary}
            keyboardType="decimal-pad"
            style={styles.amountInput}
            testID="settle-amount-input"
            autoFocus
          />
        </View>

        <Text style={styles.label}>Note (optional)</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Paid in cash"
          placeholderTextColor={COLORS.onSurfaceTertiary}
          style={styles.input}
          testID="settle-note-input"
        />

        {err ? <Text style={styles.err}>{err}</Text> : null}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: insets.bottom + SPACING.md }]}>
        <Pressable
          onPress={save}
          disabled={saving || !amount}
          style={[styles.saveBtn, (!amount || saving) && { opacity: 0.5 }]}
          testID="save-settlement-button"
        >
          {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveText}>Record payment</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  title: { fontSize: FONT.size.lg, fontWeight: '700', color: COLORS.onSurface },
  friendCard: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.lg, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSecondary },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.brand, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFF', fontWeight: '700', fontSize: FONT.size.lg },
  friendName: { fontSize: FONT.size.lg, fontWeight: '700', color: COLORS.onSurface },
  friendSub: { fontSize: FONT.size.base, color: COLORS.brand, marginTop: 2, fontWeight: '600' },
  label: { fontSize: FONT.size.sm, fontWeight: '700', color: COLORS.onSurfaceTertiary, textTransform: 'uppercase', marginTop: SPACING.lg, marginBottom: SPACING.sm, letterSpacing: 0.5 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, borderBottomWidth: 2, borderBottomColor: COLORS.border, paddingBottom: SPACING.sm },
  amountSym: { fontSize: FONT.size.xxl, color: COLORS.onSurfaceTertiary, fontWeight: '700' },
  amountInput: { flex: 1, fontSize: 40, fontWeight: '800', color: COLORS.onSurface },
  input: { backgroundColor: COLORS.surfaceSecondary, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, height: 52, fontSize: FONT.size.lg, color: COLORS.onSurface },
  err: { color: COLORS.error, marginTop: SPACING.md },
  bar: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  saveBtn: { backgroundColor: COLORS.brand, height: 54, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#FFF', fontSize: FONT.size.lg, fontWeight: '700' },
});
