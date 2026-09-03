import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import Feather from '@react-native-vector-icons/feather';
import { api } from '../src/api';
import { useAuth } from '../src/auth/AuthContext';
import { COLORS, SPACING, RADIUS, FONT, CATEGORIES, currencySymbol } from '../src/theme';

export default function Recurring() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState('Bills');
  const [cadence, setCadence] = useState<'monthly'|'weekly'>('monthly');
  const [currency, setCurrency] = useState(user?.currency || 'USD');

  const load = useCallback(async () => {
    try { setItems(await api.listRecurring()); } catch (e) { console.warn(e); }
  }, []);

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false); })(); }, [load]);

  const create = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    setSaving(true);
    try {
      await api.createRecurring({
        amount: amt, currency, category, merchant: merchant || null,
        cadence, split_with: [], group_id: null,
      });
      setAmount(''); setMerchant(''); setCategory('Bills'); setCadence('monthly'); setCreating(false);
      await load();
    } catch (e) { console.warn(e); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => { try { await api.deleteRecurring(id); await load(); } catch {} };

  const sym = currencySymbol(currency);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.surface }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="close-recurring">
          <Feather name="x" size={24} color={COLORS.onSurface} />
        </Pressable>
        <Text style={styles.title}>Recurring</Text>
        <Pressable onPress={() => setCreating(v => !v)} hitSlop={12} testID="toggle-create-recurring">
          <Feather name={creating ? 'minus' : 'plus'} size={24} color={COLORS.brand} />
        </Pressable>
      </View>

      {creating ? (
        <ScrollView contentContainerStyle={{ padding: SPACING.lg }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Amount</Text>
          <View style={styles.amountRow}>
            <Text style={styles.amountSym}>{sym}</Text>
            <TextInput
              value={amount} onChangeText={setAmount}
              placeholder="0.00" placeholderTextColor={COLORS.onSurfaceTertiary}
              keyboardType="decimal-pad" style={styles.amountInput}
              testID="recurring-amount"
            />
          </View>

          <Text style={styles.label}>Description</Text>
          <TextInput
            value={merchant} onChangeText={setMerchant}
            placeholder="e.g. Rent, Netflix"
            placeholderTextColor={COLORS.onSurfaceTertiary} style={styles.input}
            testID="recurring-merchant"
          />

          <Text style={styles.label}>Cadence</Text>
          <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
            {(['monthly','weekly'] as const).map(c => (
              <Pressable
                key={c}
                onPress={() => setCadence(c)}
                style={[styles.pill, cadence === c && styles.pillActive]}
                testID={`cadence-${c}`}
              >
                <Text style={[styles.pillText, cadence === c && { color: '#FFF' }]}>{c[0].toUpperCase() + c.slice(1)}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Currency</Text>
          <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
            {['USD','INR'].map(c => (
              <Pressable key={c} onPress={() => setCurrency(c)} style={[styles.pill, currency === c && styles.pillActive]} testID={`rec-cur-${c}`}>
                <Text style={[styles.pillText, currency === c && { color: '#FFF' }]}>{c}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.sm }}>
            {CATEGORIES.map(c => {
              const active = category === c.key;
              return (
                <Pressable
                  key={c.key}
                  onPress={() => setCategory(c.key)}
                  style={[styles.catChip, active && { borderColor: c.color, backgroundColor: c.color + '18' }]}
                  testID={`rec-cat-${c.key}`}
                >
                  <Feather name={c.icon as any} size={14} color={active ? c.color : COLORS.onSurfaceSecondary} />
                  <Text style={[styles.catText, active && { color: c.color, fontWeight: '700' }]}>{c.key}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable onPress={create} disabled={saving || !amount} style={[styles.saveBtn, (!amount || saving) && { opacity: 0.5 }]} testID="save-recurring-button">
            {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveText}>Save recurring</Text>}
          </Pressable>
        </ScrollView>
      ) : loading ? (
        <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.recurring_id}
          contentContainerStyle={{ padding: SPACING.lg }}
          ListEmptyComponent={
            <View style={styles.empty} testID="recurring-empty">
              <View style={styles.emptyIcon}><Feather name="repeat" size={24} color={COLORS.brand} /></View>
              <Text style={styles.emptyTitle}>No recurring expenses</Text>
              <Text style={styles.emptyText}>Rent, subscriptions, utilities — automate them all.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const sym2 = currencySymbol(item.currency);
            const next = new Date(item.next_run).toLocaleDateString();
            return (
              <View style={styles.card} testID={`recurring-${item.recurring_id}`}>
                <View style={styles.cardIcon}><Feather name="repeat" size={18} color={COLORS.brand} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName}>{item.merchant || item.category}</Text>
                  <Text style={styles.cardSub}>{`${item.cadence} \u2022 next: ${next}`}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: SPACING.xs }}>
                  <Text style={styles.cardAmt}>{sym2}{item.amount.toFixed(2)}</Text>
                  <Pressable onPress={() => remove(item.recurring_id)} hitSlop={10} testID={`delete-recurring-${item.recurring_id}`}>
                    <Feather name="trash-2" size={16} color={COLORS.error} />
                  </Pressable>
                </View>
              </View>
            );
          }}
          ItemSeparatorComponent={() => <View style={{ height: SPACING.sm }} />}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  title: { fontSize: FONT.size.lg, fontWeight: '700', color: COLORS.onSurface },
  label: { fontSize: FONT.size.sm, fontWeight: '700', color: COLORS.onSurfaceTertiary, textTransform: 'uppercase', marginTop: SPACING.lg, marginBottom: SPACING.sm, letterSpacing: 0.5 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, borderBottomWidth: 2, borderBottomColor: COLORS.border, paddingBottom: SPACING.sm },
  amountSym: { fontSize: FONT.size.xxl, color: COLORS.onSurfaceTertiary, fontWeight: '700' },
  amountInput: { flex: 1, fontSize: 36, fontWeight: '800', color: COLORS.onSurface },
  input: { backgroundColor: COLORS.surfaceSecondary, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, height: 52, fontSize: FONT.size.lg, color: COLORS.onSurface },
  pill: { flex: 1, height: 44, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  pillActive: { backgroundColor: COLORS.onSurface, borderColor: COLORS.onSurface },
  pillText: { fontWeight: '700', color: COLORS.onSurfaceSecondary },
  catChip: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACING.md, height: 36, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  catText: { fontSize: FONT.size.base, color: COLORS.onSurfaceSecondary, fontWeight: '600' },
  saveBtn: { backgroundColor: COLORS.brand, height: 54, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', marginTop: SPACING.xl },
  saveText: { color: '#FFF', fontSize: FONT.size.lg, fontWeight: '700' },
  card: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  cardIcon: { width: 40, height: 40, borderRadius: RADIUS.md, backgroundColor: COLORS.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: FONT.size.lg, fontWeight: '700', color: COLORS.onSurface },
  cardSub: { fontSize: FONT.size.sm, color: COLORS.onSurfaceTertiary, marginTop: 2 },
  cardAmt: { fontSize: FONT.size.lg, fontWeight: '700', color: COLORS.onSurface },
  empty: { alignItems: 'center', paddingVertical: SPACING.xxxl, gap: SPACING.md },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: FONT.size.xl, fontWeight: '700', color: COLORS.onSurface },
  emptyText: { fontSize: FONT.size.base, color: COLORS.onSurfaceTertiary, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
