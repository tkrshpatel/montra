import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useState , useMemo} from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthContext';
import { SPACING, RADIUS, FONT } from '../src/theme'
import { useTheme } from '../src/theme/ThemeContext';
import Feather from '@react-native-vector-icons/feather';

export default function Login() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    setBusy(true);
    try { await signIn(); } finally { setBusy(false); }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + SPACING.xl }]} testID="login-screen">
      <View style={styles.hero}>
        <View style={styles.logoWrap} testID="login-logo">
          <Feather name="pie-chart" size={44} color={colors.brand} />
        </View>
        <Text style={styles.brand}>SplitSync</Text>
        <Text style={styles.tag}>Track expenses. Scan receipts. Split with friends.</Text>
      </View>

      <View style={styles.features}>
        {[
          { icon: 'plus-circle', text: 'Log expenses in seconds' },
          { icon: 'camera', text: 'AI-scan any receipt' },
          { icon: 'users', text: 'Split bills fairly with friends' },
        ].map((f) => (
          <View key={f.icon} style={styles.featureRow}>
            <View style={styles.featureIcon}>
              <Feather name={f.icon as any} size={18} color={colors.brand} />
            </View>
            <Text style={styles.featureText}>{f.text}</Text>
          </View>
        ))}
      </View>

      <View style={styles.ctaWrap}>
        <Pressable
          onPress={handle}
          disabled={busy}
          style={({ pressed }) => [styles.googleBtn, pressed && { opacity: 0.85 }]}
          testID="google-signin-button"
        >
          {busy ? (
            <ActivityIndicator color={colors.onSurface} />
          ) : (
            <>
              <Image
                source={{ uri: 'https://www.gstatic.com/marketing-cms/assets/images/d5/dc/cfe9ce8b4425b410b49b7f2dd3f3/g.webp=s96-fcrop64=1,00000000ffffffff-rw' }}
                style={styles.gIcon}
                contentFit="contain"
              />
              <Text style={styles.googleText}>Continue with Google</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.small}>Powered by Emergent Auth. Sessions last 7 days.</Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: SPACING.xl, justifyContent: 'space-between' },
  hero: { alignItems: 'flex-start', marginTop: SPACING.xxxl },
  logoWrap: {
    width: 80, height: 80, borderRadius: RADIUS.lg,
    backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  brand: { fontSize: FONT.size.hero, fontWeight: '800', color: colors.onSurface, letterSpacing: -0.5 },
  tag: { marginTop: SPACING.sm, fontSize: FONT.size.lg, color: colors.onSurfaceSecondary, lineHeight: 22 },
  features: { gap: SPACING.md },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  featureIcon: {
    width: 36, height: 36, borderRadius: RADIUS.md,
    backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center',
  },
  featureText: { fontSize: FONT.size.lg, color: colors.onSurface, fontWeight: '500' },
  ctaWrap: { gap: SPACING.md, alignItems: 'center' },
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: SPACING.md,
    width: '100%',
    height: 56,
    borderRadius: RADIUS.pill,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  gIcon: { width: 22, height: 22 },
  googleText: { fontSize: FONT.size.lg, fontWeight: '600', color: colors.onSurface },
  small: { fontSize: FONT.size.sm, color: colors.onSurfaceTertiary },
});
