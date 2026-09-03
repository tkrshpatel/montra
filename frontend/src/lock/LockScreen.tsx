import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@react-native-vector-icons/feather';
import { useEffect, useMemo, useState } from 'react';
import { useTheme } from '@/src/theme/ThemeContext';
import { SPACING, RADIUS, FONT } from '@/src/theme';
import { useLock } from '@/src/lock/LockContext';

export default function LockScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { unlock } = useLock();
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  const attempt = async () => {
    setBusy(true);
    try { await unlock(); setTried(true); } finally { setBusy(false); }
  };

  // Auto-prompt on mount
  useEffect(() => { attempt(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top + SPACING.xxxl, paddingBottom: insets.bottom + SPACING.xl }]} testID="lock-screen">
      <View style={{ flex: 1 }} />
      <View style={styles.center}>
        <View style={styles.iconWrap}>
          <Feather name="lock" size={44} color={colors.brand} />
        </View>
        <Text style={styles.title}>SplitSync is locked</Text>
        <Text style={styles.sub}>
          {tried ? 'Try again to unlock' : 'Use biometrics to unlock'}
        </Text>
      </View>
      <Pressable
        onPress={attempt}
        disabled={busy}
        style={[styles.btn, busy && { opacity: 0.6 }]}
        testID="unlock-button"
      >
        {busy ? <ActivityIndicator color={colors.onBrand} /> : (
          <>
            <Feather name="unlock" size={18} color={colors.onBrand} />
            <Text style={styles.btnText}>Unlock</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: SPACING.xl },
  center: { alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.xxxl },
  iconWrap: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandTertiary },
  title: { fontSize: FONT.size.xxl, fontWeight: '800', color: colors.onSurface, marginTop: SPACING.md, letterSpacing: -0.5 },
  sub: { fontSize: FONT.size.base, color: colors.onSurfaceTertiary },
  btn: { height: 56, borderRadius: RADIUS.pill, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm },
  btnText: { color: colors.onBrand, fontSize: FONT.size.lg, fontWeight: '700' },
});
