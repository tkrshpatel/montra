import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState , useMemo} from 'react';
import Feather from '@react-native-vector-icons/feather';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth/AuthContext';
import { useFx } from '../../src/fx/FxContext';
import { SPACING, RADIUS, FONT, categoryMeta, currencySymbol } from '../../src/theme'
import { useTheme } from '../../src/theme/ThemeContext';

export default function ExpenseDetail() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { convert } = useFx();
  const params = useLocalSearchParams<{
    id: string; amount?: string; currency?: string; category?: string;
    merchant?: string; notes?: string; date?: string; has_receipt?: string;
    is_split?: string;
  }>();

  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [loadingReceipt, setLoadingReceipt] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const home = user?.currency || 'USD';
  const meta = categoryMeta(params.category || 'Other');
  const amount = parseFloat(params.amount || '0');
  const currency = params.currency || 'USD';
  const sym = currencySymbol(currency);
  const homeSym = currencySymbol(home);
  const converted = currency !== home ? convert(amount, currency, home) : null;

  useEffect(() => {
    if (params.has_receipt !== '1') return;
    let cancelled = false;
    (async () => {
      setLoadingReceipt(true);
      try {
        const r = await api.getReceipt(String(params.id));
        if (!cancelled && r?.image_base64) {
          setReceiptUri(`data:${r.mime_type || 'image/jpeg'};base64,${r.image_base64}`);
        }
      } catch {}
      finally { if (!cancelled) setLoadingReceipt(false); }
    })();
    return () => { cancelled = true; };
  }, [params.id, params.has_receipt]);

  const remove = () => {
    Alert.alert('Delete expense?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setDeleting(true);
        try { await api.deleteExpense(String(params.id)); router.back(); } catch {} finally { setDeleting(false); }
      } },
    ]);
  };

  const dateStr = params.date ? new Date(String(params.date)).toLocaleString() : '';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="expense-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="close-expense">
          <Feather name="x" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Expense</Text>
        <Pressable onPress={remove} hitSlop={12} disabled={deleting} testID="delete-expense-button">
          {deleting ? <ActivityIndicator color={colors.error} /> : <Feather name="trash-2" size={20} color={colors.error} />}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxxl }}>
        <View style={styles.card}>
          <View style={[styles.icon, { backgroundColor: meta.color + '22' }]}>
            <Feather name={meta.icon as any} size={24} color={meta.color} />
          </View>
          <Text style={styles.merchant}>{params.merchant || params.category || 'Expense'}</Text>
          <Text style={styles.amount}>-{sym}{amount.toFixed(2)}</Text>
          {converted !== null ? (
            <Text style={styles.converted}>{`\u2248 ${homeSym}${converted.toFixed(2)} in ${home}`}</Text>
          ) : null}
          <View style={styles.pillsRow}>
            <View style={styles.pill}><Text style={styles.pillText}>{params.category}</Text></View>
            {params.is_split === '1' ? <View style={[styles.pill, { backgroundColor: colors.brandTertiary }]}><Text style={[styles.pillText, { color: colors.brand }]}>Split</Text></View> : null}
          </View>
        </View>

        <Row label="Date" value={dateStr} />
        {params.notes ? <Row label="Notes" value={String(params.notes)} /> : null}

        {params.has_receipt === '1' ? (
          <>
            <Text style={styles.section}>Receipt</Text>
            <View style={styles.receiptWrap}>
              {loadingReceipt ? (
                <View style={styles.receiptLoading}><ActivityIndicator color={colors.brand} /></View>
              ) : receiptUri ? (
                <Image source={{ uri: receiptUri }} style={styles.receiptImg} contentFit="cover" testID="receipt-image" />
              ) : (
                <Text style={styles.hint}>Could not load receipt.</Text>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.border, paddingTop: SPACING.sm },
  title: { fontSize: FONT.size.lg, fontWeight: '700', color: colors.onSurface },
  card: { alignItems: 'center', padding: SPACING.xl, borderRadius: RADIUS.lg, backgroundColor: colors.surfaceSecondary, marginBottom: SPACING.lg, gap: SPACING.sm },
  icon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  merchant: { fontSize: FONT.size.xl, fontWeight: '700', color: colors.onSurface, marginTop: SPACING.sm },
  amount: { fontSize: FONT.size.hero, fontWeight: '800', color: colors.onSurface, letterSpacing: -1 },
  converted: { fontSize: FONT.size.base, color: colors.onSurfaceTertiary },
  pillsRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  pill: { paddingHorizontal: SPACING.md, height: 28, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: FONT.size.sm, fontWeight: '700', color: colors.onSurface },
  row: { flexDirection: 'row', justifyContent: 'space-between', padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, marginBottom: SPACING.sm, gap: SPACING.md },
  rowLabel: { fontSize: FONT.size.base, color: colors.onSurfaceTertiary, fontWeight: '600' },
  rowValue: { flex: 1, textAlign: 'right', fontSize: FONT.size.base, color: colors.onSurface, fontWeight: '600' },
  section: { fontSize: FONT.size.sm, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase', marginTop: SPACING.md, marginBottom: SPACING.sm, letterSpacing: 0.5 },
  receiptWrap: { borderRadius: RADIUS.md, overflow: 'hidden', backgroundColor: colors.surfaceSecondary, minHeight: 240 },
  receiptImg: { width: '100%', height: 400 },
  receiptLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: SPACING.xxxl },
  hint: { padding: SPACING.lg, color: colors.onSurfaceTertiary },
});
