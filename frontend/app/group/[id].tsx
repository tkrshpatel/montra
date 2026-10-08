import { useCallback, useMemo, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Share, RefreshControl, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { useAuth } from '../../src/auth/AuthContext';
import { useTheme } from '../../src/theme';
import { sharedApi, Group, Entry, Balances, money, decimalAmount } from '../../src/shared/api';
import { Button, Field, ErrorText, Chip, layout } from '../../src/shared/ui';

type Mode = 'equal' | 'ratio' | 'percentage' | 'exact';
export default function SharedGroup() {
  const { id } = useLocalSearchParams<{ id: string }>(); const router = useRouter(); const { user } = useAuth();
  const { colors } = useTheme(); const insets = useSafeAreaInsets();
  const [group, setGroup] = useState<Group | null>(null); const [balances, setBalances] = useState<Balances | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<'expense' | 'settlement' | null>(null);
  const [description, setDescription] = useState(''); const [amount, setAmount] = useState(''); const [payer, setPayer] = useState(user?.user_id || '');
  const [selected, setSelected] = useState<string[]>([]); const [mode, setMode] = useState<Mode>('equal');
  const [values, setValues] = useState<Record<string, string>>({}); const [expenseDate, setExpenseDate] = useState('');
  const [other, setOther] = useState(''); const [direction, setDirection] = useState<'paid' | 'received'>('paid');
  const [invite, setInvite] = useState<{ code: string; expires_at: string } | null>(null);
  const [correction, setCorrection] = useState<string | null>(null); const [reason, setReason] = useState('');
  const [formVersion, setFormVersion] = useState(0);
  const requestId = useMemo(() => Crypto.randomUUID(), [formVersion, description, amount, payer, selected, mode, values, expenseDate, other, direction]);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const [g, b, e] = await Promise.all([sharedApi.group(id), sharedApi.balances(id), sharedApi.entries(id)]);
      setGroup(g); setBalances(b); setEntries(e.items); setCursor(e.next_cursor);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const active = group?.members.filter(m => m.active) || [];
  const name = (uid: string) => uid === user?.user_id ? 'You' : group?.members.find(m => m.user_id === uid)?.name || 'Member';
  const isOwner = active.some(m => m.user_id === user?.user_id && m.role === 'owner');
  const currency = group?.currency || 'USD'; const net = balances?.net[user?.user_id || ''] || 0;
  const openForm = (next: 'expense' | 'settlement') => {
    setError(null); setForm(next); setAmount(''); setDescription(''); setMode('equal'); setValues({}); setExpenseDate('');
    setPayer(user?.user_id || ''); setSelected(active.map(m => m.user_id)); setDirection('paid');
    setOther(active.find(m => m.user_id !== user?.user_id)?.user_id || ''); setFormVersion(v => v + 1);
  };
  const save = async () => {
    if (busy || !user) return; setBusy(true); setError(null);
    try {
      if (form === 'expense') await sharedApi.expense(id, { request_id: requestId, description: description.trim(), amount,
        paid_by: payer, participants: selected, split_mode: mode,
        values: mode === 'equal' ? {} : Object.fromEntries(selected.map(uid => [uid, values[uid] || (mode === 'ratio' ? '1' : '')])),
        expense_date: expenseDate || null });
      else await sharedApi.settlement(id, { request_id: requestId, amount, note: description,
        paid_by: direction === 'paid' ? user.user_id : other, paid_to: direction === 'paid' ? other : user.user_id });
      setForm(null); await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const inviteMembers = async () => {
    setBusy(true); setError(null);
    try { setInvite(await sharedApi.invite(id)); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const revoke = async () => {
    setBusy(true); setError(null); try { await sharedApi.revoke(id); setInvite(null); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const correct = async () => {
    if (!correction) return; setBusy(true); setError(null);
    try { await sharedApi.void(id, correction, reason.trim()); setCorrection(null); setReason(''); await load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const more = async () => {
    if (!cursor) return; setBusy(true);
    try { const e = await sharedApi.entries(id, cursor); setEntries(old => [...old, ...e.items]); setCursor(e.next_cursor); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const card = [layout.card, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }];
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" style={{ paddingTop: insets.top }} contentContainerStyle={[layout.content, { paddingBottom: insets.bottom + 48 }]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} testID="shared-group-detail">
      <Pressable accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/together')}
        style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.brand, fontWeight: '700' }}>← Groups</Text></Pressable>
      <Text style={[layout.title, { color: colors.onSurface }]}>{group?.name || 'Shared group'}</Text>
      <ErrorText message={error} />
      {!group && loading ? <ActivityIndicator color={colors.brand} /> : null}
      {group ? <>
        <Text style={{ color: colors.onSurfaceSecondary }}>{active.length} members · {currency} · shared with this group only</Text>
        <View style={card}><Text style={{ color: colors.onSurfaceSecondary }}>{net > 0 ? 'You are owed' : net < 0 ? 'You owe' : 'Your balance'}</Text>
          <Text style={{ color: net < 0 ? colors.warning : colors.brand, fontSize: 36, fontWeight: '800' }}>{money(Math.abs(net), currency)}</Text>
          <Text style={{ color: colors.onSurfaceSecondary }}>Group spending {money(balances?.total_expenses_minor || 0, currency)}</Text></View>
        {!form ? <View style={{ gap: 10 }}><Button title="Add shared expense" onPress={() => openForm('expense')} testID="add-shared-expense" />
          <Button title="Record a payment" onPress={() => openForm('settlement')} secondary disabled={active.length < 2} /></View> :
        <View style={card} testID="shared-entry-form">
          <Text style={[layout.subtitle, { color: colors.onSurface }]}>{form === 'expense' ? 'New shared expense' : 'Record a payment'}</Text>
          <Field label={`Amount (${currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" testID="shared-amount" />
          <Field label={form === 'expense' ? 'Description' : 'Note (optional)'} value={description} onChangeText={setDescription} maxLength={200} testID="shared-description" />
          {form === 'expense' ? <>
            <Text style={{ color: colors.onSurface, fontWeight: '700' }}>Who paid?</Text>
            <View style={layout.row}>{active.map(m => <Chip key={m.user_id} text={name(m.user_id)} selected={payer === m.user_id} onPress={() => setPayer(m.user_id)} />)}</View>
            <Text style={{ color: colors.onSurface, fontWeight: '700' }}>Who shares this expense?</Text>
            <View style={layout.row}>{active.map(m => <Chip key={m.user_id} text={name(m.user_id)} selected={selected.includes(m.user_id)}
              onPress={() => setSelected(ids => ids.includes(m.user_id) ? ids.filter(uid => uid !== m.user_id) : [...ids, m.user_id])} />)}</View>
            <View style={layout.row}>{(['equal', 'exact', 'percentage', 'ratio'] as Mode[]).map(m => <Chip key={m} text={{ equal: 'Equal', exact: 'Amounts', percentage: 'Percentages', ratio: 'Ratios' }[m]}
              selected={mode === m} onPress={() => setMode(m)} />)}</View>
            {mode !== 'equal' ? selected.map(uid => <Field key={uid} label={`${name(uid)} ${mode === 'percentage' ? '(%)' : mode === 'exact' ? `(${currency})` : '(weight)'}`}
              value={values[uid] ?? (mode === 'ratio' ? '1' : '')} onChangeText={v => setValues(old => ({ ...old, [uid]: v }))} keyboardType="decimal-pad" />) :
              <Text style={{ color: colors.onSurfaceSecondary }}>Split across {selected.length} people. Any remaining smallest currency units are allocated consistently.</Text>}
            <Field label="Date (YYYY-MM-DD, optional)" value={expenseDate} onChangeText={setExpenseDate} placeholder="Leave blank for today" maxLength={10} />
          </> : <>
            <View style={layout.row}><Chip text="I paid" selected={direction === 'paid'} onPress={() => setDirection('paid')} />
              <Chip text="I received" selected={direction === 'received'} onPress={() => setDirection('received')} /></View>
            <Text style={{ color: colors.onSurface }}>Other member</Text>
            <View style={layout.row}>{active.filter(m => m.user_id !== user?.user_id).map(m => <Chip key={m.user_id} text={m.name} selected={other === m.user_id} onPress={() => setOther(m.user_id)} />)}</View>
            <Text style={{ color: colors.onSurfaceSecondary }}>This records a payment already made. Montra does not transfer money.</Text>
          </>}
          <Button title={form === 'expense' ? 'Save shared expense' : 'Record payment'} onPress={save} busy={busy}
            disabled={!amount || (form === 'expense' ? !description.trim() || !selected.length : !other)} testID="save-shared-entry" />
          <Button title="Cancel" onPress={() => setForm(null)} secondary disabled={busy} />
        </View>}
        <Text style={[layout.subtitle, { color: colors.onSurface }]}>Members & balances</Text>
        {group.members.map(m => <View key={m.user_id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <Text style={{ flex: 1, color: colors.onSurface }}>{name(m.user_id)}{m.role === 'owner' ? ' · owner' : ''}{!m.active ? ' · inactive' : ''}</Text>
          <Text style={{ color: (balances?.net[m.user_id] || 0) < 0 ? colors.warning : colors.brand }}>{money(balances?.net[m.user_id] || 0, currency)}</Text>
        </View>)}
        <Text style={{ color: colors.onSurfaceTertiary }}>Positive: owed money. Negative: owes money.</Text>
        {isOwner ? <><Button title="Create invitation code" onPress={inviteMembers} busy={busy} secondary />
          <Text style={{ color: colors.onSurfaceTertiary }}>Anyone with the code can join for 7 days. Creating a new code replaces the previous one.</Text>
          <Button title="Revoke invitation code" onPress={revoke} disabled={busy} secondary /></> : null}
        {invite ? <View style={card}><Text style={{ color: colors.onSurface }}>Invitation code · expires {new Date(invite.expires_at).toLocaleDateString()}</Text>
          <Text selectable style={{ color: colors.brand, fontSize: 17 }}>{invite.code}</Text>
          <Button title="Share invitation" secondary onPress={() => { Share.share({ message: `Join ${group.name} in Montra. Open Together → Join with code, then paste: ${invite.code}` }).catch(e => setError(e.message)); }} /></View> : null}
        {(balances?.suggestions.length || 0) > 0 ? <><Text style={[layout.subtitle, { color: colors.onSurface }]}>Suggested repayments</Text>
          <Text style={{ color: colors.onSurfaceSecondary }}>Suggestions simplify the group’s net balances. Record only payments that actually happened.</Text>
          {balances!.suggestions.map((s, i) => <View style={card} key={i}>
            <Text style={{ color: colors.onSurface }}>{name(s.paid_by)} → {name(s.paid_to)} · {money(s.amount_minor, currency)}</Text>
            {active.some(m => m.user_id === s.paid_by) && active.some(m => m.user_id === s.paid_to) && [s.paid_by, s.paid_to].includes(user?.user_id || '') ?
              <Button title="Record this payment" secondary onPress={() => { openForm('settlement'); setAmount(decimalAmount(s.amount_minor, currency));
                setDirection(s.paid_by === user?.user_id ? 'paid' : 'received'); setOther(s.paid_by === user?.user_id ? s.paid_to : s.paid_by); }} /> : null}
          </View>)}</> : null}
        <Text style={[layout.subtitle, { color: colors.onSurface }]}>Shared activity</Text>
        {!entries.length ? <Text style={{ color: colors.onSurfaceSecondary }}>No shared transactions yet. Add the first expense above.</Text> : null}
        {entries.map(e => <View key={e.entry_id} style={card} testID={`shared-entry-${e.entry_id}`}>
          <Text style={[layout.subtitle, { color: colors.onSurface, textDecorationLine: e.voided ? 'line-through' : 'none' }]}>{e.description} · {money(e.amount_minor, currency)}</Text>
          <Text style={{ color: colors.onSurfaceSecondary }}>{name(e.paid_by)} paid{e.paid_to ? ` ${name(e.paid_to)}` : ''} · {e.expense_date || new Date(e.created_at).toLocaleDateString()}</Text>
          {e.allocations ? <Text style={{ color: colors.onSurfaceSecondary }}>{Object.entries(e.allocations).map(([uid, value]) => `${name(uid)} ${money(value, currency)}`).join(' · ')}</Text> : null}
          <Text style={{ color: colors.onSurfaceTertiary }}>Recorded by {name(e.created_by)}</Text>
          {e.voided ? <Text style={{ color: colors.warning }}>Removed from balances: {e.void_reason}</Text> :
            isOwner || e.created_by === user?.user_id ? <Button title="Correct this entry" secondary onPress={() => { setCorrection(e.entry_id); setReason(''); }} /> : null}
          {correction === e.entry_id ? <><Field label="Reason for correction" value={reason} onChangeText={setReason} maxLength={200} />
            <Text style={{ color: colors.onSurfaceSecondary }}>The entry stays in history but is removed from balances. Add a new expense above with the corrected details.</Text>
            <Button title="Remove from balances" onPress={correct} busy={busy} disabled={!reason.trim()} />
            <Button title="Keep entry" secondary onPress={() => setCorrection(null)} disabled={busy} /></> : null}
        </View>)}
        {cursor ? <Button title="Load older activity" secondary onPress={more} busy={busy} /> : null}
      </> : null}
    </ScrollView>
  </KeyboardAvoidingView>;
}
