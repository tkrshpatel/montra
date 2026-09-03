import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@react-native-vector-icons/feather';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/auth/AuthContext';
import { api } from '../../src/api';
import { COLORS, SPACING, RADIUS, FONT } from '../../src/theme';

export default function Profile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut, refresh } = useAuth();
  const [busy, setBusy] = useState(false);

  const setCurrency = async (c: string) => {
    if (busy || user?.currency === c) return;
    setBusy(true);
    try {
      Haptics.selectionAsync().catch(() => {});
      await api.setCurrency(c);
      await refresh();
    } catch {} finally { setBusy(false); }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingTop: insets.top + SPACING.lg, paddingBottom: SPACING.xxxl }}
      testID="profile-screen"
    >
      <Text style={styles.header}>Profile</Text>

      <View style={styles.userCard} testID="profile-card">
        {user?.picture ? (
          <Image source={{ uri: user.picture }} style={styles.userAvatar} contentFit="cover" />
        ) : (
          <View style={[styles.userAvatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{(user?.name || '?').slice(0,1).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.userName}>{user?.name}</Text>
          <Text style={styles.userEmail}>{user?.email}</Text>
        </View>
      </View>

      <Text style={styles.section}>Currency</Text>
      <View style={styles.currencyRow}>
        {['USD', 'INR', 'EUR', 'GBP', 'JPY'].map(c => (
          <Pressable
            key={c}
            onPress={() => setCurrency(c)}
            style={[styles.currencyChip, user?.currency === c && styles.currencyChipActive]}
            testID={`currency-${c}`}
          >
            <Text style={[styles.currencyText, user?.currency === c && styles.currencyTextActive]}>{c}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.section}>Automation</Text>
      <Pressable
        onPress={() => router.push('/recurring')}
        style={styles.linkRow}
        testID="open-recurring-button"
      >
        <View style={styles.rowIcon}><Feather name="repeat" size={18} color={COLORS.brand} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Recurring expenses</Text>
          <Text style={styles.rowSub}>Auto-log rent, subscriptions and more</Text>
        </View>
        <Feather name="chevron-right" size={20} color={COLORS.onSurfaceTertiary} />
      </Pressable>

      <Text style={styles.section}>Account</Text>
      <View style={styles.list}>
        <Row icon="mail" label={user?.email || ''} />
        <Row icon="shield" label="Sessions expire in 7 days" />
      </View>

      <Pressable
        onPress={signOut}
        style={styles.signOut}
        testID="signout-button"
      >
        <Feather name="log-out" size={18} color={COLORS.error} />
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({ icon, label }: { icon: any; label: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}><Feather name={icon} size={18} color={COLORS.brand} /></View>
      <Text style={styles.rowLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  header: { fontSize: FONT.size.xxxl, fontWeight: '800', color: COLORS.onSurface, paddingHorizontal: SPACING.lg, letterSpacing: -0.5 },
  userCard: {
    margin: SPACING.lg, padding: SPACING.lg, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surfaceSecondary,
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
  },
  userAvatar: { width: 56, height: 56, borderRadius: 28 },
  avatarFallback: { backgroundColor: COLORS.brand, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#FFF', fontWeight: '700', fontSize: FONT.size.xl },
  userName: { fontSize: FONT.size.xl, fontWeight: '700', color: COLORS.onSurface },
  userEmail: { fontSize: FONT.size.base, color: COLORS.onSurfaceTertiary, marginTop: 2 },
  section: { fontSize: FONT.size.base, fontWeight: '700', color: COLORS.onSurfaceTertiary, paddingHorizontal: SPACING.lg, marginTop: SPACING.md, marginBottom: SPACING.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  currencyRow: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.lg, flexWrap: 'wrap' },
  currencyChip: { minWidth: 60, paddingHorizontal: SPACING.md, height: 48, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  currencyChipActive: { borderColor: COLORS.brand, backgroundColor: COLORS.brandTertiary },
  currencyText: { fontSize: FONT.size.lg, fontWeight: '700', color: COLORS.onSurfaceSecondary },
  currencyTextActive: { color: COLORS.brand },
  list: { marginHorizontal: SPACING.lg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md, marginHorizontal: SPACING.lg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  rowSub: { fontSize: FONT.size.sm, color: COLORS.onSurfaceTertiary, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  rowIcon: { width: 32, height: 32, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.brandTertiary },
  rowLabel: { fontSize: FONT.size.base, color: COLORS.onSurface, flex: 1 },
  signOut: { margin: SPACING.lg, marginTop: SPACING.xl, padding: SPACING.lg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.error + '33', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm },
  signOutText: { color: COLORS.error, fontWeight: '700', fontSize: FONT.size.lg },
});
