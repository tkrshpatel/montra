import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import Feather from '@react-native-vector-icons/feather';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth/AuthContext';
import { useFx } from '../../src/fx/FxContext';
import { SPACING, RADIUS, FONT, CATEGORIES, categoryMeta, currencySymbol } from '../../src/theme'
import { useTheme } from '../../src/theme/ThemeContext';

type Expense = {
  expense_id: string; amount: number; currency: string; category: string;
  merchant?: string; notes?: string; date: string; is_split: boolean; split_with: string[];
  has_receipt?: boolean;
};

type DateRange = 'all' | '7d' | '30d' | 'month';

const HERO_BG = 'https://images.pexels.com/photos/20818851/pexels-photo-20818851.jpeg';
const DATE_OPTIONS: { key: DateRange; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'month', label: 'This month' },
  { key: '30d', label: 'Last 30d' },
  { key: '7d', label: 'Last 7d' },
];

export default function Dashboard() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { convert, refresh: refreshFx, syncing } = useFx();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balance, setBalance] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'All' | 'Personal' | 'Split'>('All');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [showFilters, setShowFilters] = useState(false);

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

  const filtered = useMemo(() => {
    const now = new Date();
    const q = search.trim().toLowerCase();
    return expenses.filter(e => {
      if (filter === 'Personal' && e.is_split) return false;
      if (filter === 'Split' && !e.is_split) return false;
      if (categoryFilter !== 'All' && e.category !== categoryFilter) return false;
      if (dateRange !== 'all') {
        const d = new Date(e.date);
        if (dateRange === 'month' && (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear())) return false;
        if (dateRange === '7d' && (now.getTime() - d.getTime()) > 7 * 86400000) return false;
        if (dateRange === '30d' && (now.getTime() - d.getTime()) > 30 * 86400000) return false;
      }
      if (q) {
        const hay = `${e.merchant || ''} ${e.notes || ''} ${e.category || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [expenses, filter, search, categoryFilter, dateRange]);

  const activeFilterCount = (categoryFilter !== 'All' ? 1 : 0) + (dateRange !== 'all' ? 1 : 0);

  const currency = user?.currency || 'USD';
  const sym = currencySymbol(currency);

  const totalThisMonth = expenses
    .filter(e => new Date(e.date).getMonth() === new Date().getMonth())
    .reduce((s, e) => s + convert(e.amount, e.currency, currency), 0);

  return (
    <View style={[styles.root, { paddingBottom: 0 }]} testID="dashboard-screen">
      {syncing ? (
        <View style={[styles.syncBanner, { top: insets.top + SPACING.sm }]} testID="fx-syncing-banner" pointerEvents="none">
          <ActivityIndicator color={colors.brand} size="small" />
          <Text style={styles.syncText}>Syncing live FX rates</Text>
        </View>
      ) : null}
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
              <Feather name="arrow-down-left" size={13} color={colors.onSurfaceInverse} />
              <Text style={styles.pillText}>
                Owed to you  {sym}{(balance?.total_owed_to_me || 0).toFixed(2)}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Filters row */}
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
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => setShowFilters(v => !v)}
          style={[styles.chip, (showFilters || activeFilterCount > 0) && styles.chipActive]}
          testID="toggle-filters-button"
          hitSlop={6}
        >
          <Feather name="sliders" size={14} color={(showFilters || activeFilterCount > 0) ? '#FFF' : colors.onSurfaceSecondary} />
          <Text style={[styles.chipText, (showFilters || activeFilterCount > 0) && styles.chipTextActive, { marginLeft: 4 }]}>
            {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filters'}
          </Text>
        </Pressable>
      </View>

      {/* Search + filter chips (collapsible) */}
      {showFilters ? (
        <View style={styles.filtersPanel} testID="filters-panel">
          <View style={styles.searchWrap}>
            <Feather name="search" size={16} color={colors.onSurfaceTertiary} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search merchant, note, category"
              placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.searchInput}
              testID="search-input"
              returnKeyType="search"
            />
            {search ? (
              <Pressable onPress={() => setSearch('')} hitSlop={8} testID="clear-search">
                <Feather name="x-circle" size={16} color={colors.onSurfaceTertiary} />
              </Pressable>
            ) : null}
          </View>

          <FlatList
            data={[{ key: 'All' } as any, ...CATEGORIES]}
            horizontal
            keyExtractor={(item: any) => item.key}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: SPACING.sm, paddingHorizontal: SPACING.lg }}
            style={{ marginTop: SPACING.sm }}
            renderItem={({ item }: any) => {
              const active = categoryFilter === item.key;
              const color = item.color || colors.onSurface;
              const icon = item.icon || 'grid';
              return (
                <Pressable
                  onPress={() => setCategoryFilter(item.key)}
                  style={[styles.catChip, active && { borderColor: color, backgroundColor: color + '18' }]}
                  testID={`cat-filter-${item.key}`}
                >
                  <Feather name={icon as any} size={14} color={active ? color : colors.onSurfaceSecondary} />
                  <Text style={[styles.catChipText, active && { color, fontWeight: '700' }]}>{item.key}</Text>
                </Pressable>
              );
            }}
          />

          <FlatList
            data={DATE_OPTIONS}
            horizontal
            keyExtractor={(item) => item.key}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: SPACING.sm, paddingHorizontal: SPACING.lg }}
            style={{ marginTop: SPACING.sm, marginBottom: SPACING.sm }}
            renderItem={({ item }) => {
              const active = dateRange === item.key;
              return (
                <Pressable
                  onPress={() => setDateRange(item.key)}
                  style={[styles.catChip, active && { borderColor: colors.brand, backgroundColor: colors.brandTertiary }]}
                  testID={`date-filter-${item.key}`}
                >
                  <Feather name="calendar" size={14} color={active ? colors.brand : colors.onSurfaceSecondary} />
                  <Text style={[styles.catChipText, active && { color: colors.brand, fontWeight: '700' }]}>{item.label}</Text>
                </Pressable>
              );
            }}
          />
        </View>
      ) : null}

      {/* List */}
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.expense_id}
          contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 120 }}
          ListHeaderComponent={<Text style={styles.section}>Recent transactions</Text>}
          ListEmptyComponent={
            <View style={styles.empty} testID="empty-state">
              <View style={styles.emptyIcon}><Feather name="inbox" size={28} color={colors.brand} /></View>
              <Text style={styles.emptyTitle}>{search || activeFilterCount ? 'No matches' : 'No expenses yet'}</Text>
              <Text style={styles.emptyText}>{search || activeFilterCount ? 'Try clearing your search or filters.' : 'Tap + to log your first expense.'}</Text>
            </View>
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
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
        <Feather name="plus" size={26} color={colors.onBrandPrimary || '#FFF'} />
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.tintedBg },
  syncBanner: {
    position: 'absolute', alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm,
    backgroundColor: colors.surface, borderRadius: RADIUS.pill,
    shadowColor: colors.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 12, elevation: 4,
    zIndex: 100,
  },
  syncText: { fontSize: FONT.size.sm, fontWeight: '700', color: colors.onSurface },
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

  filterRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.md },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, height: 36, borderRadius: RADIUS.pill, backgroundColor: colors.surfaceSecondary },
  chipActive: { backgroundColor: colors.brand },
  chipText: { fontSize: FONT.size.base, fontWeight: '600', color: colors.onSurfaceSecondary },
  chipTextActive: { color: colors.onBrand },

  filtersPanel: { paddingBottom: SPACING.sm, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: SPACING.sm },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginHorizontal: SPACING.lg, height: 44, borderRadius: RADIUS.md, backgroundColor: colors.surfaceSecondary, paddingHorizontal: SPACING.md },
  searchInput: { flex: 1, fontSize: FONT.size.base, color: colors.onSurface, paddingVertical: 0 },
  catChip: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACING.md, height: 36, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  catChipText: { fontSize: FONT.size.base, color: colors.onSurfaceSecondary, fontWeight: '600' },

  section: { fontSize: FONT.size.lg, fontWeight: '700', color: colors.onSurface, marginBottom: SPACING.md },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    backgroundColor: colors.surface, padding: SPACING.md, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: colors.border,
  },
  rowIcon: { width: 40, height: 40, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: FONT.size.lg, fontWeight: '600', color: colors.onSurface },
  rowSub: { fontSize: FONT.size.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  rowAmount: { fontSize: FONT.size.lg, fontWeight: '700', color: colors.onSurface },

  empty: { alignItems: 'center', paddingVertical: SPACING.xxxl, gap: SPACING.md },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: FONT.size.xl, fontWeight: '700', color: colors.onSurface },
  emptyText: { fontSize: FONT.size.base, color: colors.onSurfaceTertiary },

  fab: {
    position: 'absolute', right: SPACING.lg,
    width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brand,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
