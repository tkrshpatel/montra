import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import Feather from '@react-native-vector-icons/feather';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../src/api';
import { useAuth } from '../src/auth/AuthContext';
import { SPACING, RADIUS, FONT, CATEGORIES, CURRENCIES, currencySymbol } from '../src/theme'
import { useTheme } from '../src/theme/ThemeContext';
import { takePendingReceipt } from '../src/pendingReceipt';

const EQUAL = 'equal' as const;
const CUSTOM = 'custom' as const;

export default function AddExpense() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
  const [splitMode, setSplitMode] = useState<typeof EQUAL | typeof CUSTOM>(EQUAL);
  const [shares, setShares] = useState<Record<string, string>>({ self: '1' }); // string for TextInput
  const [receiptBase64, setReceiptBase64] = useState<string | null>(null);
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.listFriends().then(setFriends).catch(() => {});
    api.listGroups().then(setGroups).catch(() => {});
    const pending = takePendingReceipt();
    if (pending) {
      setReceiptBase64(pending.base64);
      setReceiptUri(`data:${pending.mime};base64,${pending.base64}`);
    }
  }, []);

  const attachPhoto = async (source: 'camera' | 'gallery') => {
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: 'images', quality: 0.7, base64: true, allowsEditing: false };
    const res = source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    setReceiptUri(a.uri);
    setReceiptBase64(a.base64 || null);
  };

  const clearPhoto = () => { setReceiptUri(null); setReceiptBase64(null); };

  useEffect(() => {
    if (params.amount) setAmount(String(params.amount));
    if (params.merchant) setMerchant(String(params.merchant));
    if (params.category) setCategory(String(params.category));
    if (params.currency && (CURRENCIES as readonly string[]).includes(String(params.currency))) {
      setCurrency(String(params.currency));
    }
  }, [params.amount, params.merchant, params.category, params.currency]);

  const selectedIds = useMemo(() => Object.keys(selected).filter(k => selected[k]), [selected]);

  // Keep shares object aligned with participants when custom mode
  useEffect(() => {
    if (splitMode !== CUSTOM) return;
    setShares(prev => {
      const next: Record<string, string> = { self: prev.self || '1' };
      selectedIds.forEach(id => { next[id] = prev[id] || '1'; });
      return next;
    });
  }, [selectedIds, splitMode]);

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

  const amt = parseFloat(amount) || 0;

  // Per-participant preview
  const preview = useMemo(() => {
    if (!selectedIds.length) return null;
    if (splitMode === EQUAL) {
      const per = amt / (1 + selectedIds.length);
      const rows: { id: string; label: string; amount: number }[] = [
        { id: 'self', label: 'You', amount: per },
        ...selectedIds.map(id => ({ id, label: friends.find(f => f.friend_id === id)?.name || 'Friend', amount: per })),
      ];
      return rows;
    }
    const total = Object.values(shares).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    if (total <= 0) return null;
    const rows = [
      { id: 'self', label: 'You', amount: amt * ((parseFloat(shares.self) || 0) / total) },
      ...selectedIds.map(id => ({
        id, label: friends.find(f => f.friend_id === id)?.name || 'Friend',
        amount: amt * ((parseFloat(shares[id]) || 0) / total),
      })),
    ];
    return rows;
  }, [splitMode, selectedIds, shares, amt, friends]);

  const save = async () => {
    if (!amt || amt <= 0) {
      Alert.alert('Amount required', 'Please enter an amount greater than 0.');
      return;
    }
    setSaving(true);
    try {
      const body: any = {
        amount: amt, currency, category,
        merchant: merchant || null,
        notes: notes || null,
        group_id: groupId,
        date: new Date().toISOString(),
      };
      if (selectedIds.length && splitMode === CUSTOM) {
        const arr = [
          { participant_id: 'self', share: parseFloat(shares.self) || 0 },
          ...selectedIds.map(id => ({ participant_id: id, share: parseFloat(shares[id]) || 0 })),
        ].filter(s => s.share > 0);
        body.shares = arr;
      } else {
        body.split_with = selectedIds;
      }
      if (receiptBase64) {
        // Guard against oversized receipts (backend caps at ~5.5M chars ≈ 4MB image).
        if (receiptBase64.length > 5_400_000) {
          Alert.alert('Receipt too large', 'The attached photo is very large. Please retake it or remove it to save the expense.');
          setSaving(false);
          return;
        }
        body.receipt_image_base64 = receiptBase64;
      }
      await api.createExpense(body);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } catch (e: any) {
      console.warn('createExpense failed', e);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      const msg = String(e?.message || e || '').trim();
      if (msg === 'unauthorized') {
        Alert.alert('Session expired', 'Please sign in again to save this expense.', [
          { text: 'OK', onPress: () => router.replace('/login') },
        ]);
      } else {
        // Try to surface backend detail if present
        let detail = 'Something went wrong. Please try again.';
        try {
          const parsed = JSON.parse(msg);
          if (parsed?.detail) detail = String(parsed.detail);
          else if (msg) detail = msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
        } catch {
          if (msg && msg !== 'HTTP 0') detail = msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
        }
        Alert.alert("Couldn't save expense", detail);
      }
    } finally {
      setSaving(false);
    }
  };

  const sym = currencySymbol(currency);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.surface }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.header, { paddingTop: insets.top + SPACING.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="close-modal">
          <Feather name="x" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>New expense</Text>
        <Pressable
          onPress={() => router.push('/scan')}
          style={styles.scanBtn}
          testID="open-scan"
        >
          <Feather name="camera" size={16} color={colors.brand} />
          <Text style={styles.scanText}>Scan</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxxl }} keyboardShouldPersistTaps="handled">
        {/* Amount + currency */}
        <View style={styles.amountWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, paddingHorizontal: SPACING.sm }}>
            <View style={styles.currencyToggle}>
              {CURRENCIES.map(c => (
                <Pressable key={c} onPress={() => setCurrency(c)} style={[styles.curBtn, currency === c && styles.curBtnActive]} testID={`cur-${c}`}>
                  <Text style={[styles.curText, currency === c && { color: colors.onBrand }]}>{c}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <View style={styles.amountRow}>
            <Text style={styles.amountSym}>{sym}</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor={colors.onSurfaceTertiary}
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
          placeholderTextColor={colors.onSurfaceTertiary}
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
                <Feather name={c.icon as any} size={14} color={active ? c.color : colors.onSurfaceSecondary} />
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
                    style={[styles.catChip, active && { borderColor: colors.brand, backgroundColor: colors.brandTertiary }]}
                    testID={`grp-${g.group_id}`}
                  >
                    <Feather name="folder" size={14} color={active ? colors.brand : colors.onSurfaceSecondary} />
                    <Text style={[styles.catText, active && { color: colors.brand, fontWeight: '700' }]}>{g.name}</Text>
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
                  <View style={[styles.miniAvatar, active && { backgroundColor: colors.brand }]}>
                    <Text style={styles.miniAvatarText}>{(f.name || '?').slice(0,1).toUpperCase()}</Text>
                  </View>
                  <Text style={[styles.friendText, active && { color: colors.brand, fontWeight: '700' }]}>{f.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* Split mode + shares editor */}
        {selectedIds.length > 0 ? (
          <View>
            <Text style={styles.label}>Split mode</Text>
            <View style={styles.splitModeRow}>
              {([EQUAL, CUSTOM] as const).map(m => (
                <Pressable
                  key={m}
                  onPress={() => setSplitMode(m)}
                  style={[styles.modeChip, splitMode === m && styles.modeChipActive]}
                  testID={`split-mode-${m}`}
                >
                  <Feather name={m === EQUAL ? 'divide' : 'sliders'} size={14} color={splitMode === m ? colors.onBrand : colors.onSurfaceSecondary} />
                  <Text style={[styles.modeText, splitMode === m && { color: colors.onBrand }]}>
                    {m === EQUAL ? 'Equal' : 'Custom ratio'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {splitMode === CUSTOM ? (
              <View style={styles.sharesCard}>
                <Text style={styles.sharesHint}>Set a weight for each participant. Amount is split proportionally.</Text>
                {['self', ...selectedIds].map(pid => {
                  const label = pid === 'self' ? 'You' : (friends.find(f => f.friend_id === pid)?.name || 'Friend');
                  const share = shares[pid] ?? '1';
                  const row = preview?.find(r => r.id === pid);
                  return (
                    <View key={pid} style={styles.shareRow} testID={`share-row-${pid}`}>
                      <Text style={styles.shareLabel}>{label}</Text>
                      <TextInput
                        value={share}
                        onChangeText={(v) => setShares(s => ({ ...s, [pid]: v.replace(/[^0-9.]/g, '') }))}
                        keyboardType="decimal-pad"
                        placeholder="1"
                        placeholderTextColor={colors.onSurfaceTertiary}
                        style={styles.shareInput}
                        testID={`share-input-${pid}`}
                      />
                      <Text style={styles.sharePreview}>{sym}{(row?.amount || 0).toFixed(2)}</Text>
                    </View>
                  );
                })}
              </View>
            ) : preview ? (
              <View style={styles.sharesCard}>
                {preview.map(r => (
                  <View key={r.id} style={styles.shareRow}>
                    <Text style={styles.shareLabel}>{r.label}</Text>
                    <Text style={styles.sharePreview}>{sym}{r.amount.toFixed(2)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Notes */}
        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Add note..."
          placeholderTextColor={colors.onSurfaceTertiary}
          style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
          multiline
          testID="notes-input"
        />

        {/* Receipt photo */}
        <Text style={styles.label}>Receipt (optional)</Text>
        {receiptUri ? (
          <View style={styles.receiptPreview} testID="receipt-preview">
            <Image source={{ uri: receiptUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            <Pressable onPress={clearPhoto} style={styles.receiptClear} testID="remove-receipt-button">
              <Feather name="x" size={16} color="#FFF" />
            </Pressable>
          </View>
        ) : (
          <View style={styles.photoRow}>
            <Pressable onPress={() => attachPhoto('camera')} style={styles.photoBtn} testID="attach-photo-camera">
              <Feather name="camera" size={16} color={colors.onSurface} />
              <Text style={styles.photoText}>Photo</Text>
            </Pressable>
            <Pressable onPress={() => attachPhoto('gallery')} style={styles.photoBtn} testID="attach-photo-gallery">
              <Feather name="image" size={16} color={colors.onSurface} />
              <Text style={styles.photoText}>Upload</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <View style={[styles.saveBar, { paddingBottom: insets.bottom + SPACING.md }]}>
        <Pressable
          onPress={save}
          disabled={saving || !amt || amt <= 0}
          style={[styles.saveBtn, (!amt || amt <= 0 || saving) && { opacity: 0.5 }]}
          testID="save-expense-button"
        >
          {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveText}>Save expense</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: FONT.size.lg, fontWeight: '700', color: colors.onSurface },
  scanBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brandTertiary, paddingHorizontal: SPACING.md, height: 32, borderRadius: RADIUS.pill },
  scanText: { color: colors.brand, fontWeight: '700' },
  amountWrap: { alignItems: 'center', paddingVertical: SPACING.lg, gap: SPACING.md },
  currencyToggle: { flexDirection: 'row', gap: 4, backgroundColor: colors.surfaceSecondary, borderRadius: RADIUS.pill, padding: 4 },
  curBtn: { paddingHorizontal: SPACING.md, height: 32, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  curBtnActive: { backgroundColor: colors.brand },
  curText: { fontWeight: '700', color: colors.onSurfaceSecondary },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  amountSym: { fontSize: FONT.size.hero, color: colors.onSurfaceTertiary, fontWeight: '700' },
  amountInput: { fontSize: 56, fontWeight: '800', color: colors.onSurface, minWidth: 140, textAlign: 'left' },
  label: { fontSize: FONT.size.sm, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase', marginTop: SPACING.lg, marginBottom: SPACING.sm, letterSpacing: 0.5 },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, height: 52, fontSize: FONT.size.lg, color: colors.onSurface },
  hint: { fontSize: FONT.size.base, color: colors.onSurfaceTertiary },
  catChip: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACING.md, height: 36, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  catText: { fontSize: FONT.size.base, color: colors.onSurfaceSecondary, fontWeight: '600' },
  friendChip: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACING.sm, height: 40, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingRight: SPACING.md },
  friendChipActive: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  miniAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.onSurfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  miniAvatarText: { color: '#FFF', fontWeight: '700', fontSize: FONT.size.sm },
  friendText: { fontWeight: '600', color: colors.onSurfaceSecondary },

  splitModeRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xs },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACING.md, height: 36, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  modeChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  modeText: { fontWeight: '700', color: colors.onSurfaceSecondary },

  sharesCard: { marginTop: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: colors.surfaceSecondary, gap: SPACING.sm },
  sharesHint: { fontSize: FONT.size.sm, color: colors.onSurfaceTertiary },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  shareLabel: { flex: 1, fontSize: FONT.size.base, color: colors.onSurface, fontWeight: '600' },
  shareInput: { width: 64, height: 36, borderRadius: RADIUS.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: SPACING.sm, textAlign: 'center', fontWeight: '700', color: colors.onSurface },
  sharePreview: { minWidth: 78, textAlign: 'right', fontSize: FONT.size.base, fontWeight: '700', color: colors.brand },

  photoRow: { flexDirection: 'row', gap: SPACING.sm },
  photoBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 48, borderRadius: RADIUS.md, backgroundColor: colors.surfaceSecondary },
  photoText: { fontWeight: '700', color: colors.onSurface },
  receiptPreview: { height: 180, borderRadius: RADIUS.md, overflow: 'hidden', backgroundColor: colors.surfaceSecondary },
  receiptClear: { position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },

  saveBar: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  saveBtn: { backgroundColor: colors.brand, height: 54, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#FFF', fontSize: FONT.size.lg, fontWeight: '700' },
});
