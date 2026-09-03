import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import Feather from '@react-native-vector-icons/feather';
import { api } from '../src/api';
import { useAuth } from '../src/auth/AuthContext';
import { SPACING, RADIUS, FONT, currencySymbol } from '../src/theme';
import { useTheme } from '../src/theme/ThemeContext';

type Settlement = {
  settlement_id: string;
  friend_id: string;
  amount: number;
  currency: string;
  note?: string | null;
  created_at: string;
};

export default function Settlements() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [items, setItems] = useState<Settlement[]>([]);
  const [friends, setFriends] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [stl, frs] = await Promise.all([api.listSettlements(), api.listFriends()]);
      setItems(stl || []);
      const map: Record<string, string> = {};
      (frs || []).forEach((f: any) => { map[f.friend_id] = f.name; });
      setFriends(map);
    } catch (e) { console.warn(e); }
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => { setLoading(true); await load(); if (active) setLoading(false); })();
    return () => { active = false; };
  }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const sym = (cur: string) => currencySymbol(cur || user?.currency || 'USD');

  const fmt = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch { return iso; }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + SPACING.sm }]} testID="settlements-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="close-settlements">
          <Feather name="chevron-left" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Recent settlements</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.settlement_id}
          contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
          ListEmptyComponent={
            <View style={styles.empty} testID="settlements-empty">
              <View style={styles.emptyIcon}><Feather name="clock" size={24} color={colors.brand} /></View>
              <Text style={styles.emptyTitle}>No settlements yet</Text>
              <Text style={styles.emptyText}>When a friend pays you back, it appears here.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const name = friends[item.friend_id] || 'Friend';
            return (
              <Pressable
                onPress={() => router.push({ pathname: '/friend/[id]', params: { id: item.friend_id, name } })}
                style={styles.row}
                testID={`settlement-${item.settlement_id}`}
              >
                <View style={styles.iconWrap}>
                  <Feather name="check" size={18} color={colors.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{name}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {fmt(item.created_at)}{item.note ? ` · ${item.note}` : ''}
                  </Text>
                </View>
                <Text style={styles.rowAmount}>{sym(item.currency)}{Number(item.amount).toFixed(2)}</Text>
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
  title: { fontSize: FONT.size.lg, fontWeight: '700', color: colors.onSurface },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  iconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  rowName: { fontSize: FONT.size.lg, fontWeight: '700', color: colors.onSurface },
  rowSub: { fontSize: FONT.size.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  rowAmount: { fontSize: FONT.size.lg, fontWeight: '700', color: colors.brand },
  empty: { alignItems: 'center', paddingVertical: SPACING.xxxl, gap: SPACING.md },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: FONT.size.xl, fontWeight: '700', color: colors.onSurface },
  emptyText: { fontSize: FONT.size.base, color: colors.onSurfaceTertiary, textAlign: 'center', paddingHorizontal: SPACING.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
