import { useCallback, useState } from 'react';
import { ScrollView, View, Text, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { useTheme, CURRENCIES } from '../theme';
import { Group, sharedApi } from './api';
import { Button, Field, ErrorText, Chip, layout } from './ui';

export default function GroupsScreen() {
  const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter(); const { user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]); const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'create' | 'join' | null>(null); const [name, setName] = useState(''); const [code, setCode] = useState('');
  const [currency, setCurrency] = useState(user?.currency || 'USD');
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await sharedApi.list(); setGroups(r.items); setHasMore(r.has_more); }
    catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const submit = async () => {
    if (busy) return; setBusy(true); setError(null);
    try { const g = mode === 'create' ? await sharedApi.create(name.trim(), currency) : await sharedApi.join(code.trim());
      setMode(null); setName(''); setCode(''); router.push({ pathname: '/group/[id]', params: { id: g.group_id } });
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const more = async () => {
    setBusy(true); try { const r = await sharedApi.list(groups.length); setGroups(old => [...old, ...r.items]); setHasMore(r.has_more); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return <ScrollView style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }} contentContainerStyle={layout.content}
    keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} testID="shared-groups-screen">
    <Text style={[layout.title, { color: colors.onSurface }]}>Together</Text>
    <Text style={{ color: colors.onSurfaceSecondary, lineHeight: 22 }}>One shared record for trips, homes and everyday plans.</Text>
    <View style={layout.row}><Chip text="Create group" selected={mode === 'create'} onPress={() => setMode(mode === 'create' ? null : 'create')} />
      <Chip text="Join with code" selected={mode === 'join'} onPress={() => setMode(mode === 'join' ? null : 'join')} /></View>
    <ErrorText message={error} />
    {mode ? <View style={[layout.card, { borderColor: colors.border }]}>
      {mode === 'create' ? <><Field label="Group name" value={name} onChangeText={setName} placeholder="Goa trip, Flatmates…" maxLength={80} testID="shared-group-name" />
        <Text style={{ color: colors.onSurfaceSecondary }}>Group currency · fixed for accurate balances</Text>
        <View style={layout.row}>{CURRENCIES.map(c => <Chip key={c} text={c} selected={currency === c} onPress={() => setCurrency(c)} />)}</View></> :
        <><Field label="Invitation code" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} testID="shared-join-code" />
          <Text style={{ color: colors.onSurfaceSecondary }}>Joining shares this group’s activity. Your personal expenses remain private.</Text></>}
      <Button title={mode === 'create' ? 'Create shared group' : 'Join group'} onPress={submit} busy={busy}
        disabled={mode === 'create' ? !name.trim() : !code.trim()} testID="shared-submit" />
    </View> : null}
    {loading && groups.length === 0 ? <ActivityIndicator color={colors.brand} /> : null}
    {!loading && groups.length === 0 ? <View style={[layout.card, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
      <Text style={[layout.subtitle, { color: colors.onSurface }]}>Start with your people</Text>
      <Text style={{ color: colors.onSurfaceSecondary, lineHeight: 22 }}>Create a group and invite friends. Everyone can add expenses and see who owes what.</Text>
    </View> : null}
    {groups.map(g => <Pressable accessibilityRole="button" key={g.group_id} testID={`shared-group-${g.group_id}`}
      onPress={() => router.push({ pathname: '/group/[id]', params: { id: g.group_id } })}
      style={[layout.card, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
      <Text style={[layout.subtitle, { color: colors.onSurface }]}>{g.name}</Text>
      <Text style={{ color: colors.onSurfaceSecondary }}>{g.members.filter(m => m.active).length} members · {g.currency}</Text>
      <Text style={{ color: colors.brand }}>Open shared activity →</Text>
    </Pressable>)}
    {hasMore ? <Button title="Load more groups" onPress={more} busy={busy} secondary /> : null}
    <Button title="Manage private split presets" onPress={() => router.push('/private-groups')} secondary />
  </ScrollView>;
}
