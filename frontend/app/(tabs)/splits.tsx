import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState , useMemo} from 'react';
import Feather from '@react-native-vector-icons/feather';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth/AuthContext';
import { SPACING, RADIUS, FONT, currencySymbol } from '../../src/theme'
import { useTheme } from '../../src/theme/ThemeContext';

export default function Splits() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.balances()); } catch (e) { console.warn(e); }
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => { setLoading(true); await load(); if (active) setLoading(false); })();
    return () => { active = false; };
  }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const sym = currencySymbol(user?.currency || 'USD');
  const total = data?.total_owed_to_me || 0;
  const items: any[] = data?.friends || [];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="splits-screen">
      <View style={styles.headerRow}>
        <Text style={styles.header}>Splits</Text>
        <Pressable
          onPress={() => router.push('/settlements')}
          style={styles.iconBtn}
          testID="open-settlements-button"
          hitSlop={10}
        >
          <Feather name="clock" size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      <View style={styles.netCard} testID="net-card">
        <Text style={styles.netLabel}>Net balance</Text>
        <Text style={[styles.netAmount, total > 0 ? { color: colors.brand } : { color: colors.onSurface }]}>
          {total > 0 ? '+' : ''}{sym}{total.toFixed(2)}
        </Text>
        <Text style={styles.netSub}>
          {total > 0 ? `You are owed ${sym}${total.toFixed(2)}` : 'All settled up'}
        </Text>
      </View>

      <Text style={styles.section}>By friend</Text>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.friend_id}
          contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
          ListEmptyComponent={
            <View style={styles.empty} testID="splits-empty">
              <View style={styles.emptyIcon}><Feather name="users" size={24} color={colors.brand} /></View>
              <Text style={styles.emptyTitle}>No splits yet</Text>
              <Text style={styles.emptyText}>Add friends and split an expense to see balances here.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const positive = item.amount > 0.005;
            const negative = item.amount < -0.005;
            return (
              <Pressable
                onPress={() => router.push({ pathname: '/friend/[id]', params: { id: item.friend_id, name: item.name } })}
                style={styles.row}
                testID={`balance-${item.friend_id}`}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{(item.name || '?').slice(0,1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{item.name}</Text>
                  <Text style={styles.rowSub}>
                    {positive ? 'owes you' : (negative ? 'overpaid' : 'settled')} · view history
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Text style={[styles.rowAmount, positive ? { color: colors.brand } : { color: colors.onSurfaceTertiary }]}>
                    {positive ? '+' : ''}{sym}{item.amount.toFixed(2)}
                  </Text>
                  {positive ? (
                    <Pressable
                      onPress={(e) => { e.stopPropagation?.(); router.push({ pathname: '/settle', params: { friend_id: item.friend_id, name: item.name, amount: String(item.amount) } }); }}
                      style={styles.settleBtn}
                      testID={`settle-${item.friend_id}`}
                    >
                      <Feather name="check" size={12} color={colors.brand} />
                      <Text style={styles.settleText}>Settle</Text>
                    </Pressable>
                  ) : null}
                </View>
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
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg },
  header: { fontSize: FONT.size.xxxl, fontWeight: '800', color: colors.onSurface, letterSpacing: -0.5 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  netCard: {
    margin: SPACING.lg, padding: SPACING.xl, borderRadius: RADIUS.lg,
    backgroundColor: colors.brandTertiary,
  },
  netLabel: { fontSize: FONT.size.base, color: colors.onBrandTertiary, fontWeight: '600' },
  netAmount: { fontSize: FONT.size.hero, fontWeight: '800', marginTop: SPACING.xs, letterSpacing: -1 },
  netSub: { fontSize: FONT.size.base, color: colors.onSurfaceSecondary, marginTop: SPACING.xs },
  section: { fontSize: FONT.size.lg, fontWeight: '700', color: colors.onSurface, paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    backgroundColor: colors.surface, padding: SPACING.md, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: colors.border,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFF', fontWeight: '700', fontSize: FONT.size.lg },
  rowName: { fontSize: FONT.size.lg, fontWeight: '600', color: colors.onSurface },
  rowSub: { fontSize: FONT.size.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  rowAmount: { fontSize: FONT.size.lg, fontWeight: '700' },
  settleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SPACING.sm, height: 24, borderRadius: RADIUS.pill, backgroundColor: colors.brandTertiary },
  settleText: { fontSize: FONT.size.sm, fontWeight: '700', color: colors.brand },
  empty: { alignItems: 'center', paddingVertical: SPACING.xxxl, gap: SPACING.md },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: FONT.size.xl, fontWeight: '700', color: colors.onSurface },
  emptyText: { fontSize: FONT.size.base, color: colors.onSurfaceTertiary, textAlign: 'center', paddingHorizontal: SPACING.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
