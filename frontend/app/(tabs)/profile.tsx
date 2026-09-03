import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@react-native-vector-icons/feather';
import * as Haptics from 'expo-haptics';
import { useState , useMemo} from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/auth/AuthContext';
import { useTheme } from '../../src/theme/ThemeContext';
import { useLock } from '../../src/lock/LockContext';
import { api } from '../../src/api';
import { SPACING, RADIUS, FONT } from '../../src/theme'

export default function Profile() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut, refresh } = useAuth();
  const { mode, setMode } = useTheme();
  const lock = useLock();
  const [busy, setBusy] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);

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

      <Text style={styles.section}>Appearance</Text>
      <View style={styles.currencyRow}>
        {(['system','light','dark'] as const).map(m => (
          <Pressable
            key={m}
            onPress={() => setMode(m)}
            style={[styles.currencyChip, mode === m && styles.currencyChipActive]}
            testID={`theme-${m}`}
          >
            <Feather
              name={m === 'system' ? 'smartphone' : (m === 'light' ? 'sun' : 'moon')}
              size={16}
              color={mode === m ? colors.brand : colors.onSurfaceSecondary}
            />
            <Text style={[styles.currencyText, mode === m && styles.currencyTextActive, { marginTop: 4 }]}>
              {m === 'system' ? 'System' : (m === 'light' ? 'Light' : 'Dark')}
            </Text>
          </Pressable>
        ))}
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

      <Text style={styles.section}>Security</Text>
      <Pressable
        onPress={async () => {
          if (lockBusy) return;
          if (!lock.available) return;
          setLockBusy(true);
          try { await lock.setEnabled(!lock.enabled); } finally { setLockBusy(false); }
        }}
        style={styles.linkRow}
        testID="biometric-lock-toggle"
      >
        <View style={styles.rowIcon}><Feather name="lock" size={18} color={colors.brand} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Biometric lock</Text>
          <Text style={styles.rowSub}>
            {!lock.available
              ? (lock.supported ? 'No biometrics enrolled on this device' : 'Not supported on this device')
              : lock.enabled ? 'On — requires Face ID / fingerprint' : 'Off — anyone with your phone can open the app'}
          </Text>
        </View>
        {lockBusy ? (
          <ActivityIndicator color={colors.brand} />
        ) : (
          <View style={[styles.switchTrack, lock.enabled && lock.available && styles.switchTrackOn, !lock.available && { opacity: 0.4 }]}>
            <View style={[styles.switchThumb, lock.enabled && lock.available && styles.switchThumbOn]} />
          </View>
        )}
      </Pressable>

      <Text style={styles.section}>Automation</Text>
      <Pressable
        onPress={() => router.push('/recurring')}
        style={styles.linkRow}
        testID="open-recurring-button"
      >
        <View style={styles.rowIcon}><Feather name="repeat" size={18} color={colors.brand} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Recurring expenses</Text>
          <Text style={styles.rowSub}>Auto-log rent, subscriptions and more</Text>
        </View>
        <Feather name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
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
        <Feather name="log-out" size={18} color={colors.error} />
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({ icon, label }: { icon: any; label: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}><Feather name={icon} size={18} color={colors.brand} /></View>
      <Text style={styles.rowLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { fontSize: FONT.size.xxxl, fontWeight: '800', color: colors.onSurface, paddingHorizontal: SPACING.lg, letterSpacing: -0.5 },
  userCard: {
    margin: SPACING.lg, padding: SPACING.lg, borderRadius: RADIUS.lg,
    backgroundColor: colors.surfaceSecondary,
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
  },
  userAvatar: { width: 56, height: 56, borderRadius: 28 },
  avatarFallback: { backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#FFF', fontWeight: '700', fontSize: FONT.size.xl },
  userName: { fontSize: FONT.size.xl, fontWeight: '700', color: colors.onSurface },
  userEmail: { fontSize: FONT.size.base, color: colors.onSurfaceTertiary, marginTop: 2 },
  section: { fontSize: FONT.size.base, fontWeight: '700', color: colors.onSurfaceTertiary, paddingHorizontal: SPACING.lg, marginTop: SPACING.md, marginBottom: SPACING.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  currencyRow: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.lg, flexWrap: 'wrap' },
  currencyChip: { minWidth: 60, paddingHorizontal: SPACING.md, height: 48, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  currencyChipActive: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  currencyText: { fontSize: FONT.size.lg, fontWeight: '700', color: colors.onSurfaceSecondary },
  currencyTextActive: { color: colors.brand },
  list: { marginHorizontal: SPACING.lg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md, marginHorizontal: SPACING.lg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  switchTrack: { width: 44, height: 26, borderRadius: 13, backgroundColor: colors.surfaceTertiary, padding: 2, justifyContent: 'center' },
  switchTrackOn: { backgroundColor: colors.brand },
  switchThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFF' },
  switchThumbOn: { transform: [{ translateX: 18 }] },
  rowSub: { fontSize: FONT.size.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowIcon: { width: 32, height: 32, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandTertiary },
  rowLabel: { fontSize: FONT.size.base, color: colors.onSurface, flex: 1 },
  signOut: { margin: SPACING.lg, marginTop: SPACING.xl, padding: SPACING.lg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.error + '33', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm },
  signOutText: { color: colors.error, fontWeight: '700', fontSize: FONT.size.lg },
});
