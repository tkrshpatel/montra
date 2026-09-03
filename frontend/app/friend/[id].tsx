import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import Feather from '@react-native-vector-icons/feather';
import { api } from '../../src/api';
import { SPACING, RADIUS, FONT, currencySymbol, categoryMeta } from '../../src/theme';
import { useTheme } from '../../src/theme/ThemeContext';

type TimelineItem = {
  type: 'expense' | 'settlement';
  id: string;
  date?: string;
  created_at?: string;
  merchant?: string | null;
  category?: string | null;
  notes?: string | null;
  amount: number;
  currency: string;
  friend_share?: number;
  home_amount: number;
  note?: string | null;
  settled?: boolean;
};

type HistoryPayload = {
  friend: { friend_id: string; name: string; email?: string | null; settled_through?: string | null };
  currency: string;
  net_home: number;
  timeline: TimelineItem[];
};

export default function FriendDetail() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; name?: string }>();

  const [data, setData] = useState<HistoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!params.id) return;
    try { setData(await api.friendHistory(String(params.id))); }
    catch (e) { console.warn('friendHistory failed', e); }
  }, [params.id]);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => { setLoading(true); await load(); if (active) setLoading(false); })();
    return () => { active = false; };
  }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const currency = data?.currency || 'USD';
  const sym = currencySymbol(currency);
  const net = data?.net_home || 0;
  const positive = net > 0.005;
  const negative = net < -0.005;

  const displayName = data?.friend.name || params.name || 'Friend';

  const fmt = (iso?: string) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return iso; }
  };

  const activeItems = (data?.timeline || []).filter(i => !i.settled);
  const settledItems = (data?.timeline || []).filter(i => !!i.settled);

  return (
    <View style={[styles.root, { paddingTop: insets.top + SPACING.sm }]} testID="friend-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="close-friend-detail">
          <Feather name="chevron-left" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{displayName}</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <FlatList
          data={[{ __hero: true }, ...activeItems.map(i => ({ ...i, __section: 'active' })), ...(settledItems.length ? [{ __sep: 'History (settled)' }, ...settledItems.map(i => ({ ...i, __section: 'settled' }))] : [])] as any[]}
          keyExtractor={(it: any, idx) => it.__hero ? 'hero' : it.__sep ? `sep-${idx}` : `${it.type}-${it.id}`}
          contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No shared history yet.</Text>
            </View>
          }
          renderItem={({ item }: any) => {
            if (item.__hero) {
              return (
                <View style={styles.hero} testID="friend-net-card">
                  <Text style={styles.heroLabel}>Current balance</Text>
                  <Text style={[styles.heroAmount, positive ? { color: colors.brand } : negative ? { color: colors.warning } : { color: colors.onSurface }]}>
                    {positive ? '+' : ''}{sym}{Math.abs(net).toFixed(2)}
                  </Text>
                  <Text style={styles.heroSub}>
                    {positive ? `${displayName} owes you ${sym}${net.toFixed(2)}`
                      : negative ? `You owe ${displayName} ${sym}${Math.abs(net).toFixed(2)}`
                      : 'All settled up 🎉'}
                  </Text>
                  {positive ? (
                    <Pressable
                      onPress={() => router.push({ pathname: '/settle', params: { friend_id: params.id as string, name: displayName, amount: String(net) } })}
                      style={styles.settleBtn}
                      testID="hero-settle-btn"
                    >
                      <Feather name="check-circle" size={16} color="#FFF" />
                      <Text style={styles.settleText}>Settle up</Text>
                    </Pressable>
                  ) : null}
                  {activeItems.length > 0 ? <Text style={styles.section}>Active</Text> : null}
                </View>
              );
            }
            if (item.__sep) {
              return <Text style={styles.sepTitle}>{item.__sep}</Text>;
            }
            if (item.type === 'settlement') {
              return (
                <View style={[styles.row, item.__section === 'settled' && styles.rowSettled]} testID={`hist-settlement-${item.id}`}>
                  <View style={[styles.iconWrap, { backgroundColor: colors.brandTertiary }]}>
                    <Feather name="check" size={18} color={colors.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName}>Settlement</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {fmt(item.created_at)}{item.note ? ` · ${item.note}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.rowAmount, { color: colors.warning }]}>-{sym}{Number(item.home_amount).toFixed(2)}</Text>
                </View>
              );
            }
            // expense
            const cat = categoryMeta(item.category || 'Other');
            return (
              <Pressable
                onPress={() => router.push({ pathname: '/expense/[id]', params: { id: item.id } })}
                style={[styles.row, item.__section === 'settled' && styles.rowSettled]}
                testID={`hist-expense-${item.id}`}
              >
                <View style={[styles.iconWrap, { backgroundColor: cat.color + '22' }]}>
                  <Feather name={cat.icon as any} size={18} color={cat.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{item.merchant || item.category || 'Expense'}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {fmt(item.date || item.created_at)} · their share {sym}{Number(item.home_amount).toFixed(2)}
                  </Text>
                </View>
                <Text style={[styles.rowAmount, { color: colors.brand }]}>+{sym}{Number(item.home_amount).toFixed(2)}</Text>
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <View style={{ height: SPACING.sm }} />}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingBottom: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { flex: 1, fontSize: FONT.size.lg, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  hero: { padding: SPACING.xl, borderRadius: RADIUS.lg, backgroundColor: colors.brandTertiary, marginBottom: SPACING.md, alignItems: 'flex-start', gap: SPACING.xs },
  heroLabel: { fontSize: FONT.size.base, color: colors.onBrandTertiary, fontWeight: '600' },
  heroAmount: { fontSize: FONT.size.hero, fontWeight: '800', letterSpacing: -1 },
  heroSub: { fontSize: FONT.size.base, color: colors.onSurfaceSecondary, marginBottom: SPACING.sm },
  settleBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACING.md, height: 40, borderRadius: RADIUS.pill, backgroundColor: colors.brand, marginTop: SPACING.xs },
  settleText: { color: '#FFF', fontWeight: '700' },
  section: { fontSize: FONT.size.sm, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase', marginTop: SPACING.lg, letterSpacing: 0.5 },
  sepTitle: { fontSize: FONT.size.sm, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase', marginTop: SPACING.lg, marginBottom: SPACING.xs, letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  rowSettled: { opacity: 0.65 },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowName: { fontSize: FONT.size.base, fontWeight: '700', color: colors.onSurface },
  rowSub: { fontSize: FONT.size.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  rowAmount: { fontSize: FONT.size.base, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: SPACING.xxxl },
  emptyText: { fontSize: FONT.size.base, color: colors.onSurfaceTertiary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
