import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState , useMemo} from 'react';
import Feather from '@react-native-vector-icons/feather';
import { api } from '../src/api';
import { SPACING, RADIUS, FONT } from '../src/theme'
import { useTheme } from '../src/theme/ThemeContext';

type Friend = { friend_id: string; name: string };
type Group = { group_id: string; name: string; member_ids: string[] };

export default function Groups() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [friends, setFriends] = useState<Friend[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [g, f] = await Promise.all([api.listGroups(), api.listFriends()]);
      setGroups(g); setFriends(f);
    } catch (e) { console.warn(e); }
  }, []);

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false); })(); }, [load]);

  const toggle = (id: string) => setSelected(s => ({ ...s, [id]: !s[id] }));

  const create = async () => {
    if (!name.trim()) return;
    const member_ids = Object.keys(selected).filter(k => selected[k]);
    setSaving(true);
    try {
      await api.createGroup({ name: name.trim(), member_ids });
      setName(''); setSelected({}); setCreating(false);
      await load();
    } catch (e) { console.warn(e); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    try { await api.deleteGroup(id); await load(); } catch {}
  };

  const memberNames = (ids: string[]) =>
    ids.map(id => friends.find(f => f.friend_id === id)?.name).filter(Boolean).join(', ');

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="close-groups">
          <Feather name="x" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Groups</Text>
        <Pressable onPress={() => setCreating(v => !v)} hitSlop={12} testID="toggle-create-group">
          <Feather name={creating ? 'minus' : 'plus'} size={24} color={colors.brand} />
        </Pressable>
      </View>

      {creating ? (
        <ScrollView contentContainerStyle={{ padding: SPACING.lg }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Group name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Goa trip"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.input}
            testID="group-name-input"
            autoFocus
          />
          <Text style={styles.label}>Members</Text>
          {friends.length === 0 ? (
            <Text style={styles.hint}>Add friends first from the Friends tab.</Text>
          ) : (
            <View style={{ gap: SPACING.sm }}>
              {friends.map(f => {
                const active = !!selected[f.friend_id];
                return (
                  <Pressable
                    key={f.friend_id}
                    onPress={() => toggle(f.friend_id)}
                    style={[styles.memberRow, active && { borderColor: colors.brand, backgroundColor: colors.brandTertiary }]}
                    testID={`member-${f.friend_id}`}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{f.name.slice(0,1).toUpperCase()}</Text>
                    </View>
                    <Text style={styles.memberName}>{f.name}</Text>
                    <Feather name={active ? 'check-circle' : 'circle'} size={20} color={active ? colors.brand : colors.onSurfaceTertiary} />
                  </Pressable>
                );
              })}
            </View>
          )}
          <Pressable onPress={create} disabled={saving || !name.trim()} style={[styles.saveBtn, (!name.trim() || saving) && { opacity: 0.5 }]} testID="save-group-button">
            {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveText}>Create group</Text>}
          </Pressable>
        </ScrollView>
      ) : loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.group_id}
          contentContainerStyle={{ padding: SPACING.lg }}
          ListEmptyComponent={
            <View style={styles.empty} testID="groups-empty">
              <View style={styles.emptyIcon}><Feather name="folder" size={24} color={colors.brand} /></View>
              <Text style={styles.emptyTitle}>No groups yet</Text>
              <Text style={styles.emptyText}>Create a trip or roommate group to split ongoing expenses.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.groupCard} testID={`group-${item.group_id}`}>
              <View style={styles.groupIcon}><Feather name="folder" size={20} color={colors.brand} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.groupName}>{item.name}</Text>
                <Text style={styles.groupSub} numberOfLines={1}>
                  {item.member_ids.length} member{item.member_ids.length === 1 ? '' : 's'}
                  {item.member_ids.length ? '  \u2022  ' + memberNames(item.member_ids) : ''}
                </Text>
              </View>
              <Pressable onPress={() => remove(item.group_id)} hitSlop={10} testID={`delete-group-${item.group_id}`}>
                <Feather name="trash-2" size={18} color={colors.error} />
              </Pressable>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={{ height: SPACING.sm }} />}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: FONT.size.lg, fontWeight: '700', color: colors.onSurface },
  label: { fontSize: FONT.size.sm, fontWeight: '700', color: colors.onSurfaceTertiary, textTransform: 'uppercase', marginBottom: SPACING.sm, marginTop: SPACING.md, letterSpacing: 0.5 },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, height: 52, fontSize: FONT.size.lg, color: colors.onSurface },
  hint: { fontSize: FONT.size.base, color: colors.onSurfaceTertiary },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border },
  memberName: { flex: 1, fontSize: FONT.size.lg, fontWeight: '600', color: colors.onSurface },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFF', fontWeight: '700' },
  saveBtn: { backgroundColor: colors.brand, height: 54, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', marginTop: SPACING.xl },
  saveText: { color: '#FFF', fontSize: FONT.size.lg, fontWeight: '700' },
  groupCard: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  groupIcon: { width: 40, height: 40, borderRadius: RADIUS.md, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  groupName: { fontSize: FONT.size.lg, fontWeight: '700', color: colors.onSurface },
  groupSub: { fontSize: FONT.size.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  empty: { alignItems: 'center', paddingVertical: SPACING.xxxl, gap: SPACING.md },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: FONT.size.xl, fontWeight: '700', color: colors.onSurface },
  emptyText: { fontSize: FONT.size.base, color: colors.onSurfaceTertiary, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
