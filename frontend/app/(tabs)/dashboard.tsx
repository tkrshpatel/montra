import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import Feather from '@react-native-vector-icons/feather';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth/AuthContext';
import { useFx } from '../../src/fx/FxContext';
import { COLORS, SPACING, RADIUS, FONT, categoryMeta, currencySymbol } from '../../src/theme';

type Expense = {
  expense_id: string; amount: number; currency: string; category: string;
  merchant?: string; notes?: string; date: string; is_split: boolean; split_with: string[];
};

const HERO_BG = 'https://images.pexels.com/photos/20818851/pexels-photo-20818851.jpeg';

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { convert, refresh: refreshFx } = useFx();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balance, setBalance] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'All' | 'Personal' | 'Split'>('All');

  const load = useCallback(async () => {
    try {
      const [exp, bal] = await Promise.all([api.listExpenses(), api.balances()]);
      setExpenses(exp);
      setBalance(bal);
    } catch (e) {
      console.warn(e);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      setLoading(true);
      await load();
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [load]));

  const onRefresh = async () => { setRefreshing(true); await Promise.all([load(), refreshFx()]); setRefreshing(false); };

  const filtered = expenses.filter(e => {
    if (filter === 'All') return true;
    if (filter === 'Personal') return !e.is_split;
    return e.is_split;
  });

  const currency = user?.currency || 'USD';
  const sym = currencySymbol(currency);

  const totalThisMonth = expenses
    .filter(e => new Date(e.date).getMonth() === new Date().getMonth())
    .reduce((s, e) => s + convert(e.amount, e.currency, currency), 0);

  return (
    <View style={[styles.root, { paddingBottom: 0 }]} testID="dashboard-screen">
      {/* Hero */}
      <View style={[styles.heroWrap, { paddingTop: insets.top + SPACING.lg }]}>
        <Image source={{ uri: HERO_BG }} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient
          colors={['rgba(26,26,26,0.35)', 'rgba(26,26,26,0.85)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.heroContent}>
          <View style={styles.heroTopRow}>
            <Text style={styles.heroLabel}>Spent this month</Text>
            <Pressable
              onPress={() => router.push('/insights')}
              style={styles.insightsBtn}
              testID="open-insights-button"
            >
              <Feather name="bar-chart-2" size={14} color="#FFF" />
              <Text style={styles.insightsBtnText}>Insights</Text>
            </Pressable>
          </View>
          <Text style={styles.heroAmount} testID="hero-amount">
            {sym}{totalThisMonth.toFixed(2)}
          </Text>
          <View style={styles.heroRow}>
            <View style={styles.pill}>
              <Feather name="arrow-down-left" size={13} color={COLORS.onSurfaceInverse} />
              <Text style={styles.pillText}>
                Owed to you  {sym}{(balance?.total_owed_to_me || 0).toFixed(2)}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Filters */}
      <View style={styles.filterRow}>
        {(['All', 'Personal', 'Split'] as const).map(k => (
          <Pressable
            key={k}
            onPress={() => setFilter(k)}
            style={[styles.chip, filter === k && styles.chipActive]}
            testID={`filter-${k.toLowerCase()}`}
          >
            <Text style={[styles.chipText, filter === k && styles.chipTextActive]}>{k}</Text>
          </Pressable>
        ))}
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.expense_id}
          contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 120 }}
          ListHeaderComponent={<Text style={styles.section}>Recent transactions</Text>}
          ListEmptyComponent={
            <View style={styles.empty} testID="empty-state">
              <View style={styles.emptyIcon}><Feather name="inbox" size={28} color={COLORS.brand} /></View>
              <Text style={styles.emptyTitle}>No expenses yet</Text>
              <Text style={styles.emptyText}>Tap + to log your first expense.</Text>
            </View>
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.brand} />}
          renderItem={({ item }) => {
            const meta = categoryMeta(item.category);
            const sym2 = currencySymbol(item.currency);
            const convertedNeeded = item.currency !== currency;
            const conv = convertedNeeded ? convert(item.amount, item.currency, currency) : 0;
            return (
              <Pressable
                onPress={() => router.push({
                  pathname: '/expense/[id]',
                  params: {
                    id: item.expense_id,
                    amount: String(item.amount),
                    currency: item.currency,
                    category: item.category,
                    merchant: item.merchant || '',
                    notes: item.notes || '',
                    date: item.date,
                    has_receipt: (item as any).has_receipt ? '1' : '0',
                    is_split: item.is_split ? '1' : '0',
                  },
                })}
                style={styles.row}
                testID={`expense-${item.expense_id}`}
              >
                <View style={[styles.rowIcon, { backgroundColor: meta.color + '22' }]}>
                  <Feather name={meta.icon as any} size={18} color={meta.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.merchant || item.category}
                  </Text>
                  <Text style={styles.rowSub}>
                    {new Date(item.date).toLocaleDateString()}
                    {item.is_split ? '  \u2022  Split' : ''}
                    {(item as any).has_receipt ? '  \u2022  \uD83D\uDCCE' : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.rowAmount}>-{sym2}{item.amount.toFixed(2)}</Text>
                  {convertedNeeded ? (
                    <Text style={styles.rowSub}>{`\u2248 ${sym}${conv.toFixed(2)}`}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <View style={{ height: SPACING.sm }} />}
        />
      )}

      {/* FAB */}
      <Pressable
        onPress={() => router.push('/add-expense')}
        style={[styles.fab, { bottom: SPACING.lg }]}
        testID="fab-add-expense"
      >
        <Feather name="plus" size={26} color={COLORS.onBrandPrimary || '#FFF'} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  heroWrap: {
    marginHorizontal: SPACING.lg, borderRadius: RADIUS.lg, overflow: 'hidden',
    marginTop: SPACING.md,
  },
  heroContent: { padding: SPACING.xl, paddingTop: SPACING.xl },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  insightsBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SPACING.md, height: 30, borderRadius: RADIUS.pill, backgroundColor: 'rgba(255,255,255,0.2)' },
  insightsBtnText: { color: '#FFF', fontSize: FONT.size.sm, fontWeight: '700' },
  heroLabel: { color: 'rgba(255,255,255,0.75)', fontSize: FONT.size.base, fontWeight: '500' },
  heroAmount: { color: '#FFF', fontSize: FONT.size.hero, fontWeight: '800', marginTop: SPACING.xs, letterSpacing: -1 },
  heroRow: { flexDirection: 'row', marginTop: SPACING.md, gap: SPACING.sm },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: SPACING.md, paddingVertical: 6, borderRadius: RADIUS.pill,
  },
  pillText: { color: '#FFF', fontSize: FONT.size.sm, fontWeight: '600' },

  filterRow: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.md },
  chip: { paddingHorizontal: SPACING.lg, height: 36, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceSecondary },
  chipActive: { backgroundColor: COLORS.onSurface },
  chipText: { fontSize: FONT.size.base, fontWeight: '600', color: COLORS.onSurfaceSecondary },
  chipTextActive: { color: '#FFF' },

  section: { fontSize: FONT.size.lg, fontWeight: '700', color: COLORS.onSurface, marginBottom: SPACING.md },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    backgroundColor: COLORS.surface, padding: SPACING.md, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  rowIcon: { width: 40, height: 40, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: FONT.size.lg, fontWeight: '600', color: COLORS.onSurface },
  rowSub: { fontSize: FONT.size.sm, color: COLORS.onSurfaceTertiary, marginTop: 2 },
  rowAmount: { fontSize: FONT.size.lg, fontWeight: '700', color: COLORS.onSurface },

  empty: { alignItems: 'center', paddingVertical: SPACING.xxxl, gap: SPACING.md },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: FONT.size.xl, fontWeight: '700', color: COLORS.onSurface },
  emptyText: { fontSize: FONT.size.base, color: COLORS.onSurfaceTertiary },

  fab: {
    position: 'absolute', right: SPACING.lg,
    width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.brand,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
