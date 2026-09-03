import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import Feather from '@react-native-vector-icons/feather';
import * as Haptics from 'expo-haptics';
import { api } from '../src/api';
import { useAuth } from '../src/auth/AuthContext';
import { COLORS, SPACING, RADIUS, FONT, CATEGORIES, currencySymbol } from '../src/theme';

export default function AddExpense() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ amount?: string; merchant?: string; category?: string; date?: string; currency?: string }>();

  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState('Other');
  const [currency, setCurrency] = useState(user?.currency || 'USD');
  const [friends, setFriends] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.listFriends().then(setFriends).catch(() => {});
    api.listGroups().then(setGroups).catch(() => {});
  }, []);

  useEffect(() => {
    if (params.amount) setAmount(String(params.amount));
    if (params.merchant) setMerchant(String(params.merchant));
    if (params.category) setCategory(String(params.category));
    if (params.currency && ['USD','INR'].includes(String(params.currency))) setCurrency(String(params.currency));
  }, [params.amount, params.merchant, params.category, params.currency]);

  const toggle = (fid: string) => {
    Haptics.selectionAsync().catch(() => {});
    setSelected(s => ({ ...s, [fid]: !s[fid] }));
  };

  const pickGroup = (gid: string) => {
    Haptics.selectionAsync().catch(() => {});
    if (groupId === gid) {
      setGroupId(null);
      setSelected({});
      return;
    }
    setGroupId(gid);
    const grp = groups.find(g => g.group_id === gid);
    const next: Record<string, boolean> = {};
    (grp?.member_ids || []).forEach((id: string) => { next[id] = true; });
    setSelected(next);
  };

  const save = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    setSaving(true);
    try {
      const split_with = Object.keys(selected).filter(k => selected[k]);
      await api.createExpense({
        amount: amt,
        currency,
        category,
        merchant: merchant || null,
        notes: notes || null,
        split_with,
        group_id: groupId,
        date: new Date().toISOString(),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } catch (e) {
      console.warn(e);
    } finally {
      setSaving(false);
    }
  };

  const sym = currencySymbol(currency);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: COLORS.surface }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.header, { paddingTop: insets.top + SPACING.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="close-modal">
          <Feather name="x" size={24} color={COLORS.onSurface} />
        </Pressable>
        <Text style={styles.title}>New expense</Text>
        <Pressable
          onPress={() => router.push('/scan')}
          style={styles.scanBtn}
          testID="open-scan"
        >
          <Feather name="camera" size={16} color={COLORS.brand} />
          <Text style={styles.scanText}>Scan</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxxl }} keyboardShouldPersistTaps="handled">
        {/* Amount */}
        <View style={styles.amountWrap}>
          <View style={styles.currencyToggle}>
            {['USD','INR'].map(c => (
              <Pressable key={c} onPress={() => setCurrency(c)} style={[styles.curBtn, currency === c && styles.curBtnActive]} testID={`cur-${c}`}>
                <Text style={[styles.curText, currency === c && { color: '#FFF' }]}>{c}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.amountRow}>
            <Text style={styles.amountSym}>{sym}</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor={COLORS.onSurfaceTertiary}
              keyboardType="decimal-pad"
              style={styles.amountInput}
              testID="amount-input"
            />
          </View>
        </View>

        {/* Merchant */}
        <Text style={styles.label}>Merchant / Description</Text>
        <TextInput
          value={merchant}
          onChangeText={setMerchant}
          placeholder="e.g. Starbucks"
          placeholderTextColor={COLORS.onSurfaceTertiary}
          style={styles.input}
          testID="merchant-input"
        />

        {/* Category */}
        <Text style={styles.label}>Category</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.sm, paddingRight: SPACING.lg }}>
          {CATEGORIES.map(c => {
            const active = category === c.key;
            return (
              <Pressable
                key={c.key}
                onPress={() => setCategory(c.key)}
                style={[styles.catChip, active && { borderColor: c.color, backgroundColor: c.color + '18' }]}
                testID={`cat-${c.key}`}
              >
                <Feather name={c.icon as any} size={14} color={active ? c.color : COLORS.onSurfaceSecondary} />
                <Text style={[styles.catText, active && { color: c.color, fontWeight: '700' }]}>{c.key}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Group */}
        {groups.length > 0 ? (
          <>
            <Text style={styles.label}>Group (optional)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.sm, paddingRight: SPACING.lg }}>
              {groups.map(g => {
                const active = groupId === g.group_id;
                return (
                  <Pressable
                    key={g.group_id}
                    onPress={() => pickGroup(g.group_id)}
                    style={[styles.catChip, active && { borderColor: COLORS.brand, backgroundColor: COLORS.brandTertiary }]}
                    testID={`grp-${g.group_id}`}
                  >
                    <Feather name="folder" size={14} color={active ? COLORS.brand : COLORS.onSurfaceSecondary} />
                    <Text style={[styles.catText, active && { color: COLORS.brand, fontWeight: '700' }]}>{g.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        ) : null}

        {/* Split with friends */}
        <Text style={styles.label}>Split with</Text>
        {friends.length === 0 ? (
          <Text style={styles.hint}>No friends yet. Add friends from the Friends tab.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.sm, paddingRight: SPACING.lg }}>
            {friends.map(f => {
              const active = !!selected[f.friend_id];
              return (
                <Pressable
                  key={f.friend_id}
                  onPress={() => toggle(f.friend_id)}
                  style={[styles.friendChip, active && styles.friendChipActive]}
                  testID={`friend-chip-${f.friend_id}`}
                >
                  <View style={[styles.miniAvatar, active && { backgroundColor: COLORS.brand }]}>
                    <Text style={styles.miniAvatarText}>{(f.name || '?').slice(0,1).toUpperCase()}</Text>
                  </View>
                  <Text style={[styles.friendText, active && { color: COLORS.brand, fontWeight: '700' }]}>{f.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* Notes */}
        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Add note..."
          placeholderTextColor={COLORS.onSurfaceTertiary}
          style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
          multiline
          testID="notes-input"
        />
      </ScrollView>

      <View style={[styles.saveBar, { paddingBottom: insets.bottom + SPACING.md }]}>
        <Pressable
          onPress={save}
          disabled={saving || !amount}
          style={[styles.saveBtn, (!amount || saving) && { opacity: 0.5 }]}
          testID="save-expense-button"
        >
          {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveText}>Save expense</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  title: { fontSize: FONT.size.lg, fontWeight: '700', color: COLORS.onSurface },
  scanBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.brandTertiary, paddingHorizontal: SPACING.md, height: 32, borderRadius: RADIUS.pill },
  scanText: { color: COLORS.brand, fontWeight: '700' },
  amountWrap: { alignItems: 'center', paddingVertical: SPACING.lg, gap: SPACING.md },
  currencyToggle: { flexDirection: 'row', gap: 4, backgroundColor: COLORS.surfaceSecondary, borderRadius: RADIUS.pill, padding: 4 },
  curBtn: { paddingHorizontal: SPACING.md, height: 32, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  curBtnActive: { backgroundColor: COLORS.onSurface },
  curText: { fontWeight: '700', color: COLORS.onSurfaceSecondary },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  amountSym: { fontSize: FONT.size.hero, color: COLORS.onSurfaceTertiary, fontWeight: '700' },
  amountInput: { fontSize: 56, fontWeight: '800', color: COLORS.onSurface, minWidth: 140, textAlign: 'left' },
  label: { fontSize: FONT.size.sm, fontWeight: '700', color: COLORS.onSurfaceTertiary, textTransform: 'uppercase', marginTop: SPACING.lg, marginBottom: SPACING.sm, letterSpacing: 0.5 },
  input: { backgroundColor: COLORS.surfaceSecondary, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, height: 52, fontSize: FONT.size.lg, color: COLORS.onSurface },
  hint: { fontSize: FONT.size.base, color: COLORS.onSurfaceTertiary },
  catChip: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACING.md, height: 36, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  catText: { fontSize: FONT.size.base, color: COLORS.onSurfaceSecondary, fontWeight: '600' },
  friendChip: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACING.sm, height: 40, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, paddingRight: SPACING.md },
  friendChipActive: { borderColor: COLORS.brand, backgroundColor: COLORS.brandTertiary },
  miniAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.onSurfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  miniAvatarText: { color: '#FFF', fontWeight: '700', fontSize: FONT.size.sm },
  friendText: { fontWeight: '600', color: COLORS.onSurfaceSecondary },
  saveBar: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  saveBtn: { backgroundColor: COLORS.brand, height: 54, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#FFF', fontSize: FONT.size.lg, fontWeight: '700' },
});
