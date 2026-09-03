import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState , useMemo} from 'react';
import Feather from '@react-native-vector-icons/feather';
import { api } from '../../src/api';
import { SPACING, RADIUS, FONT } from '../../src/theme'
import { useTheme } from '../../src/theme/ThemeContext';

export default function Friends() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [friends, setFriends] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setFriends(await api.listFriends()); } catch (e) { console.warn(e); }
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => { setLoading(true); await load(); if (active) setLoading(false); })();
    return () => { active = false; };
  }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const remove = async (id: string) => {
    try { await api.deleteFriend(id); await load(); } catch {}
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="friends-screen">
      <View style={styles.headerRow}>
        <Text style={styles.header}>Friends</Text>
        <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
          <Pressable
            onPress={() => router.push('/groups')}
            style={styles.addBtn}
            testID="open-groups-from-friends"
          >
            <Feather name="folder" size={16} color={colors.onSurface} />
            <Text style={styles.addBtnText}>Groups</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/add-friend')}
            style={styles.addBtn}
            testID="add-friend-button"
          >
            <Feather name="plus" size={18} color={colors.onSurface} />
            <Text style={styles.addBtnText}>Add</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <FlatList
          data={friends}
          keyExtractor={(item) => item.friend_id}
          contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
          ListEmptyComponent={
            <View style={styles.empty} testID="friends-empty">
              <View style={styles.emptyIcon}><Feather name="user-plus" size={24} color={colors.brand} /></View>
              <Text style={styles.emptyTitle}>No friends yet</Text>
              <Text style={styles.emptyText}>Add friends to split expenses with them.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.row} testID={`friend-${item.friend_id}`}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(item.name || '?').slice(0,1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                {item.email ? <Text style={styles.sub}>{item.email}</Text> : null}
              </View>
              <Pressable
                onPress={() => remove(item.friend_id)}
                style={styles.deleteBtn}
                testID={`delete-friend-${item.friend_id}`}
                hitSlop={12}
              >
                <Feather name="trash-2" size={18} color={colors.error} />
              </Pressable>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={{ height: SPACING.sm }} />}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.lg },
  header: { fontSize: FONT.size.xxxl, fontWeight: '800', color: colors.onSurface, letterSpacing: -0.5 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surfaceSecondary, paddingHorizontal: SPACING.md, height: 36, borderRadius: RADIUS.pill },
  addBtnText: { fontWeight: '600', color: colors.onSurface },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFF', fontWeight: '700', fontSize: FONT.size.lg },
  name: { fontSize: FONT.size.lg, fontWeight: '600', color: colors.onSurface },
  sub: { fontSize: FONT.size.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  deleteBtn: { padding: SPACING.sm },
  empty: { alignItems: 'center', paddingVertical: SPACING.xxxl, gap: SPACING.md },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: FONT.size.xl, fontWeight: '700', color: colors.onSurface },
  emptyText: { fontSize: FONT.size.base, color: colors.onSurfaceTertiary, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
