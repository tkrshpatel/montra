import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Animated } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import Feather from '@react-native-vector-icons/feather';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { api } from '../src/api';
import { useAuth } from '../src/auth/AuthContext';
import { useFx } from '../src/fx/FxContext';
import { SPACING, RADIUS, FONT, CATEGORIES, CURRENCIES, currencySymbol } from '../src/theme'
import { useTheme } from '../src/theme/ThemeContext';
import { takePendingReceipt } from '../src/pendingReceipt';

const EQUAL = 'equal' as const;
const CUSTOM = 'custom' as const;

function formatMoney(v: number) {
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d: Date) {
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, y)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export default function AddExpense() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { convert, rates } = useFx();
  const params = useLocalSearchParams<{ amount?: string; merchant?: string; category?: string; date?: string; currency?: string }>();

  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState('Other');
  const [currency, setCurrency] = useState(user?.currency || 'USD');
  const [date, setDate] = useState<Date>(new Date());
  const [showDate, setShowDate] = useState(false);
  const [friends, setFriends] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [splitMode, setSplitMode] = useState<typeof EQUAL | typeof CUSTOM>(EQUAL);
  const [shares, setShares] = useState<Record<string, string>>({ self: '1' });
  const [receiptBase64, setReceiptBase64] = useState<string | null>(null);
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState<{ amount?: boolean; merchant?: boolean }>({});

  const notesRef = useRef<TextInput>(null);

  // Success overlay animation
  const [showSuccess, setShowSuccess] = useState(false);
  const successAnim = useRef(new Animated.Value(0)).current;

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
    if (!perm.granted) {
      Alert.alert(
        source === 'camera' ? 'Camera access needed' : 'Photo access needed',
        `Allow ${source === 'camera' ? 'camera' : 'photo'} access to attach a receipt.`,
      );
      return;
    }
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
    if (params.date) {
      const d = new Date(String(params.date));
      if (!isNaN(d.getTime())) setDate(d);
    }
  }, [params.amount, params.merchant, params.category, params.currency, params.date]);

  const selectedIds = useMemo(() => Object.keys(selected).filter(k => selected[k]), [selected]);

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
  const userCurrency = user?.currency || 'USD';

  // Live conversion preview into the user's default currency
  const converted = useMemo(() => {
    if (!amt || amt <= 0) return null;
    if (currency === userCurrency) return null;
    if (!rates) return null;
    const v = convert(amt, currency, userCurrency);
    if (!v || v === amt) return null;
    return v;
  }, [amt, currency, userCurrency, rates, convert]);

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

  // Validation
  const amountError = (!amt || amt <= 0);
  const merchantError = !merchant.trim();
  const canSave = !amountError && !merchantError && !saving;

  const isDirty = amount.length > 0 || merchant.trim().length > 0 || notes.trim().length > 0 || !!receiptUri || selectedIds.length > 0;

  const handleClose = () => {
    if (isDirty && !saving && !showSuccess) {
      Alert.alert('Discard expense?', 'Your changes will be lost.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => router.back() },
      ]);
    } else {
      router.back();
    }
  };

  const runSuccess = () => {
    setShowSuccess(true);
    Animated.spring(successAnim, { toValue: 1, useNativeDriver: true, friction: 6, tension: 80 }).start();
    setTimeout(() => router.back(), 950);
  };

  const save = async () => {
    setTouched({ amount: true, merchant: true });
    if (!canSave) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    setSaving(true);
    try {
      const body: any = {
        amount: amt, currency, category,
        merchant: merchant.trim() || null,
        notes: notes.trim() || null,
        group_id: groupId,
        date: date.toISOString(),
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
        if (receiptBase64.length > 5_400_000) {
          Alert.alert('Receipt too large', 'The attached photo is very large. Please retake it or remove it to save the expense.');
          setSaving(false);
          return;
        }
        body.receipt_image_base64 = receiptBase64;
      }
      await api.createExpense(body);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      runSuccess();
    } catch (e: any) {
      console.warn('createExpense failed', e);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      const msg = String(e?.message || e || '').trim();
      if (msg === 'unauthorized') {
        Alert.alert('Session expired', 'Please sign in again to save this expense.', [
          { text: 'OK', onPress: () => router.replace('/login') },
        ]);
      } else {
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
      setSaving(false);
    }
  };

  const onChangeDate = (event: any, selected?: Date) => {
    if (Platform.OS === 'android') {
      setShowDate(false);
      if (event?.type === 'set' && selected) setDate(selected);
    } else if (selected) {
      setDate(selected);
    }
  };

  const sym = currencySymbol(currency);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.surface }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + SPACING.sm }]}>
        <Pressable onPress={handleClose} hitSlop={12} style={styles.headerBtn} testID="close-modal">
          <Feather name="x" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>New expense</Text>
        <Pressable
          onPress={() => router.push('/scan')}
          style={styles.scanBtn}
          testID="open-scan"
        >
          <Feather name="camera" size={15} color={colors.brand} />
          <Text style={styles.scanText}>Scan</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxxl }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Amount + currency */}
        <View style={[styles.amountWrap, touched.amount && amountError && styles.amountWrapError]}>
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
              onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))}
              onBlur={() => setTouched(t => ({ ...t, amount: true }))}
              placeholder="0.00"
              placeholderTextColor={colors.onSurfaceTertiary}
              keyboardType="decimal-pad"
              style={styles.amountInput}
              testID="amount-input"
            />
          </View>
          {converted != null ? (
            <View style={styles.convPreview} testID="conversion-preview">
              <Feather name="repeat" size={12} color={colors.onSurfaceSecondary} />
              <Text style={styles.convText}>
                ≈ {currencySymbol(userCurrency)}{formatMoney(converted)} in {userCurrency} · your default
              </Text>
            </View>
          ) : null}
          {touched.amount && amountError ? (
            <Text style={styles.errorText} testID="amount-error">Enter an amount greater than 0</Text>
          ) : null}
        </View>

        {/* Merchant */}
        <View style={styles.labelRow}>
          <Text style={[styles.label, styles.labelInline]}>Merchant / Description</Text>
          <Text style={[styles.reqStar, styles.labelInline]}>*</Text>
        </View>
        <TextInput
          value={merchant}
          onChangeText={setMerchant}
          onBlur={() => setTouched(t => ({ ...t, merchant: true }))}
          placeholder="e.g. Starbucks"
          placeholderTextColor={colors.onSurfaceTertiary}
          style={[styles.input, touched.merchant && merchantError && styles.inputError]}
          returnKeyType="next"
          onSubmitEditing={() => notesRef.current?.focus()}
          testID="merchant-input"
        />
        {touched.merchant && merchantError ? (
          <Text style={styles.errorText} testID="merchant-error">Add a merchant or description</Text>
        ) : null}

        {/* Date */}
        <Text style={styles.label}>Date</Text>
        <Pressable onPress={() => setShowDate(s => !s)} style={styles.dateRow} testID="date-field">
          <Feather name="calendar" size={16} color={colors.brand} />
          <Text style={styles.dateText}>{formatDate(date)}</Text>
          <Feather name={showDate ? 'chevron-up' : 'chevron-down'} size={16} color={colors.onSurfaceTertiary} />
        </Pressable>
        {showDate ? (
          Platform.OS === 'ios' ? (
            <View style={styles.iosPickerCard}>
              <DateTimePicker
                value={date}
                mode="date"
                display="inline"
                maximumDate={new Date()}
                onChange={onChangeDate}
                themeVariant={colors.surface === '#FFFFFF' ? 'light' : 'dark'}
                accentColor={colors.brand}
              />
              <Pressable onPress={() => setShowDate(false)} style={styles.iosDoneBtn}>
                <Text style={styles.iosDoneText}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <DateTimePicker
              value={date}
              mode="date"
              display="default"
              maximumDate={new Date()}
              onChange={onChangeDate}
            />
          )
        ) : null}

        {/* Category */}
        <Text style={styles.label}>Category</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.sm, paddingRight: SPACING.lg }}>
          {CATEGORIES.map(c => {
            const active = category === c.key;
            return (
              <Pressable
                key={c.key}
                onPress={() => { Haptics.selectionAsync().catch(() => {}); setCategory(c.key); }}
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
        <Text style={styles.label}>Split with (optional)</Text>
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
          ref={notesRef}
          value={notes}
          onChangeText={setNotes}
          placeholder="Add note..."
          placeholderTextColor={colors.onSurfaceTertiary}
          style={[styles.input, { height: 80, paddingTop: SPACING.md, textAlignVertical: 'top' }]}
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
          disabled={saving}
          style={[styles.saveBtn, !canSave && { opacity: 0.55 }]}
          testID="save-expense-button"
        >
          {saving ? (
            <ActivityIndicator color={colors.onBrand} />
          ) : (
            <>
              <Feather name="check" size={18} color={colors.onBrand} />
              <Text style={styles.saveText}>Save expense</Text>
            </>
          )}
        </Pressable>
      </View>

      {showSuccess ? (
        <View style={styles.successOverlay} testID="save-success">
          <Animated.View
            style={[
              styles.successCircle,
              { opacity: successAnim, transform: [{ scale: successAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }] },
            ]}
          >
            <Feather name="check" size={40} color={colors.onBrand} />
          </Animated.View>
          <Animated.Text style={[styles.successText, { opacity: successAnim }]}>Expense saved</Animated.Text>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginLeft: -SPACING.sm },
  title: { fontSize: FONT.size.lg, fontWeight: '700', color: colors.onSurface },
  scanBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.brandTertiary, paddingHorizontal: SPACING.md, height: 34, borderRadius: RADIUS.pill },
  scanText: { color: colors.brand, fontWeight: '700', fontSize: FONT.size.base },

  amountWrap: { alignItems: 'center', paddingVertical: SPACING.xl, gap: SPACING.md, backgroundColor: colors.surfaceSecondary, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: colors.border, marginBottom: SPACING.xs },
  amountWrapError: { borderColor: colors.error },
  currencyToggle: { flexDirection: 'row', gap: 4, backgroundColor: colors.surface, borderRadius: RADIUS.pill, padding: 4, borderWidth: 1, borderColor: colors.border },
  curBtn: { paddingHorizontal: SPACING.md, height: 32, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  curBtnActive: { backgroundColor: colors.brand },
  curText: { fontWeight: '700', color: colors.onSurfaceSecondary },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  amountSym: { fontSize: FONT.size.xxl, color: colors.onSurfaceTertiary, fontWeight: '700' },
  amountInput: { fontSize: 52, fontWeight: '800', color: colors.onSurface, minWidth: 120, maxWidth: 240, textAlign: 'left', padding: 0 },
  convPreview: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, paddingHorizontal: SPACING.md, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: colors.border },
  convText: { fontSize: FONT.size.sm, color: colors.onSurfaceSecondary, fontWeight: '600' },

  labelRow: { flexDirection: 'row', alignItems: 'center', marginTop: SPACING.lg, marginBottom: SPACING.sm, gap: 4 },
  label: { fontSize: FONT.size.sm, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase', marginTop: SPACING.lg, marginBottom: SPACING.sm, letterSpacing: 0.5 },
  reqStar: { fontSize: FONT.size.sm, fontWeight: '800', color: colors.error, marginTop: SPACING.lg, marginBottom: SPACING.sm },
  labelInline: { marginTop: 0, marginBottom: 0 },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, height: 52, fontSize: FONT.size.lg, color: colors.onSurface, borderWidth: 1, borderColor: colors.border },
  inputError: { borderColor: colors.error },
  errorText: { fontSize: FONT.size.sm, color: colors.error, fontWeight: '600', marginTop: SPACING.xs, marginLeft: 2 },
  hint: { fontSize: FONT.size.base, color: colors.onSurfaceTertiary },

  dateRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: colors.surfaceSecondary, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, height: 52, borderWidth: 1, borderColor: colors.border },
  dateText: { flex: 1, fontSize: FONT.size.lg, color: colors.onSurface, fontWeight: '600' },
  iosPickerCard: { marginTop: SPACING.sm, backgroundColor: colors.surfaceSecondary, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: SPACING.sm, paddingBottom: SPACING.sm },
  iosDoneBtn: { alignSelf: 'flex-end', paddingHorizontal: SPACING.lg, height: 40, borderRadius: RADIUS.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', marginTop: SPACING.xs, marginRight: SPACING.sm, marginBottom: SPACING.sm },
  iosDoneText: { color: colors.onBrand, fontWeight: '700', fontSize: FONT.size.base },

  catChip: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACING.md, height: 38, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  catText: { fontSize: FONT.size.base, color: colors.onSurfaceSecondary, fontWeight: '600' },
  friendChip: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACING.sm, height: 40, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingRight: SPACING.md },
  friendChipActive: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  miniAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.onSurfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  miniAvatarText: { color: '#FFF', fontWeight: '700', fontSize: FONT.size.sm },
  friendText: { fontWeight: '600', color: colors.onSurfaceSecondary },

  splitModeRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xs },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACING.md, height: 38, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  modeChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  modeText: { fontWeight: '700', color: colors.onSurfaceSecondary },

  sharesCard: { marginTop: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: colors.surfaceSecondary, gap: SPACING.sm, borderWidth: 1, borderColor: colors.border },
  sharesHint: { fontSize: FONT.size.sm, color: colors.onSurfaceTertiary },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  shareLabel: { flex: 1, fontSize: FONT.size.base, color: colors.onSurface, fontWeight: '600' },
  shareInput: { width: 64, height: 36, borderRadius: RADIUS.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: SPACING.sm, textAlign: 'center', fontWeight: '700', color: colors.onSurface },
  sharePreview: { minWidth: 78, textAlign: 'right', fontSize: FONT.size.base, fontWeight: '700', color: colors.brand },

  photoRow: { flexDirection: 'row', gap: SPACING.sm },
  photoBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 48, borderRadius: RADIUS.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  photoText: { fontWeight: '700', color: colors.onSurface },
  receiptPreview: { height: 180, borderRadius: RADIUS.md, overflow: 'hidden', backgroundColor: colors.surfaceSecondary },
  receiptClear: { position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },

  saveBar: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  saveBtn: { flexDirection: 'row', gap: SPACING.sm, backgroundColor: colors.brand, height: 54, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: colors.onBrand, fontSize: FONT.size.lg, fontWeight: '700' },

  successOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: SPACING.lg },
  successCircle: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  successText: { fontSize: FONT.size.xl, fontWeight: '800', color: colors.onSurface },
});
