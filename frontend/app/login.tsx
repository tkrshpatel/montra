import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Platform } from 'react-native';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthContext';
import { useTheme } from '../src/theme/ThemeContext';
import { SPACING, RADIUS, FONT } from '../src/theme';
import Feather from '@react-native-vector-icons/feather';

export default function Login() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { signIn, signInApple, authError } = useAuth();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [appleBusy, setAppleBusy] = useState(false);

  const handle = async () => {
    setBusy(true);
    setError(null);
    try { await signIn(); } catch (e: any) { setError(e.message || "Could not sign in"); } finally { setBusy(false); }
  };

  const handleApple = async () => {
    setAppleBusy(true);
    setError(null);
    try { await signInApple(); } catch (e: any) { setError(e.message || "Could not sign in"); } finally { setAppleBusy(false); }
  };

  const features = [
    { icon: 'zap', title: 'Log expenses in seconds', sub: 'Quick. Simple. Effortless.' },
    { icon: 'camera', title: 'AI-scan any receipt', sub: 'Smart scanning. No typing.' },
    { icon: 'users', title: 'Split bills fairly', sub: 'Everyone pays their share.' },
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.tintedBg }}
      contentContainerStyle={[
        styles.root,
        { paddingTop: insets.top + SPACING.xl, paddingBottom: insets.bottom + SPACING.xl },
      ]}
      showsVerticalScrollIndicator={false}
      testID="login-screen"
    >
      {/* Brand block */}
      <View style={styles.logoWrap} testID="login-logo">
        <Image source={require('../assets/images/icon.png')} style={{ width: 64, height: 64, borderRadius: 18 }} accessibilityLabel="Montra" />
      </View>

      <Text style={styles.brand}>Montra</Text>
      <Text style={styles.tag}>Money Mantra — track expenses, scan{'\n'}receipts and split with friends.</Text>

      {/* Feature cards */}
      <View style={styles.featureList}>
        {features.map((f, idx) => (
          <View key={f.icon} style={styles.featureCard} testID={`feature-${idx}`}>
            <View style={styles.featureIcon}>
              <Feather name={f.icon as any} size={20} color={colors.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.featureTitle}>{f.title}</Text>
              <Text style={styles.featureSub}>{f.sub}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.onSurfaceTertiary} />
          </View>
        ))}
      </View>

      {/* CTA */}
      <Pressable
        onPress={handle}
        disabled={busy}
        style={({ pressed }) => [styles.googleBtn, pressed && { opacity: 0.9 }]}
        testID="google-signin-button"
      >
        {busy ? (
          <ActivityIndicator color={colors.onBrand} />
        ) : (
          <>
            <Text style={styles.googleText}>Continue with Google</Text>
          </>
        )}
      </Pressable>
      {Platform.OS === 'ios' ? (
        <Pressable
          onPress={handleApple}
          disabled={appleBusy}
          style={({ pressed }) => [styles.appleBtn, pressed && { opacity: 0.9 }]}
          testID="apple-signin-button"
        >
          {appleBusy ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Feather name="chrome" size={20} color="#FFF" />
              <Text style={styles.appleText}>Continue with Apple</Text>
            </>
          )}
        </Pressable>
      ) : null}
      {(error || authError) ? <Text accessibilityRole="alert" style={[styles.small, { color: colors.error }]}>{error || authError}</Text> : null}
      <Text style={styles.small}>Your spending. Your people. Your Montra.</Text>
    </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  root: { paddingHorizontal: SPACING.xl },
  logoWrap: {
    width: 64, height: 64, borderRadius: RADIUS.lg,
    backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center',
    marginBottom: SPACING.xl,
  },
  brand: { fontSize: 44, fontWeight: '800', color: colors.onSurface, letterSpacing: -1.2 },
  tag: { marginTop: SPACING.sm, marginBottom: SPACING.xl, fontSize: FONT.size.lg, color: colors.onSurfaceSecondary, lineHeight: 24, fontWeight: '500' },

  featureList: { gap: SPACING.md, marginTop: SPACING.md },
  featureCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    backgroundColor: colors.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md + 2,
    shadowColor: colors.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 12, elevation: 2,
  },
  featureIcon: {
    width: 48, height: 48, borderRadius: RADIUS.md,
    backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center',
  },
  featureTitle: { fontSize: FONT.size.lg, color: colors.onSurface, fontWeight: '700' },
  featureSub: { fontSize: FONT.size.sm, color: colors.onSurfaceTertiary, marginTop: 2, fontWeight: '500' },

  googleBtn: {
    marginTop: SPACING.xxl,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: SPACING.md,
    width: '100%',
    height: 60,
    borderRadius: RADIUS.pill,
    backgroundColor: colors.brand,
  },
  gCircle: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFF',
    alignItems: 'center', justifyContent: 'center',
  },
  gIcon: { width: 20, height: 20 },
  googleText: { fontSize: FONT.size.lg, fontWeight: '700', color: colors.onBrand },
  appleBtn: {
    marginTop: SPACING.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: SPACING.md,
    width: '100%',
    height: 60,
    borderRadius: RADIUS.pill,
    backgroundColor: '#000',
  },
  appleText: { fontSize: FONT.size.lg, fontWeight: '700', color: '#FFF' },
  small: { fontSize: FONT.size.sm, color: colors.onSurfaceTertiary, textAlign: 'center', marginTop: SPACING.md, fontWeight: '500' },
});
