import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useState , useMemo} from 'react';
import Feather from '@react-native-vector-icons/feather';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { setPendingReceipt } from '../src/pendingReceipt';
import { api } from '../src/api';
import { SPACING, RADIUS, FONT } from '../src/theme'
import { useTheme } from '../src/theme/ThemeContext';

export default function Scan() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (source: 'camera' | 'gallery') => {
    setError(null);
    setResult(null);
    let perm;
    if (source === 'camera') {
      perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { setError('Camera permission required'); return; }
    } else {
      perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setError('Photo library permission required'); return; }
    }
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: 'images',
      quality: 0.7,
      base64: true,
      allowsEditing: false,
    };
    const res = source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    setImageUri(asset.uri);
    setBase64(asset.base64 || null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  };

  const runScan = async () => {
    if (!base64) return;
    setScanning(true);
    setError(null);
    try {
      const r = await api.scan(base64, 'image/jpeg');
      setResult(r);
    } catch (e: any) {
      setError('Could not extract details. Try again.');
    } finally {
      setScanning(false);
    }
  };

  const useResult = () => {
    if (!result) return;
    if (base64) setPendingReceipt(base64, 'image/jpeg');
    router.replace({
      pathname: '/add-expense',
      params: {
        amount: result.amount ? String(result.amount) : '',
        merchant: result.merchant || '',
        category: result.category || 'Other',
        currency: (result.currency === 'INR' || result.currency === 'USD') ? result.currency : '',
      },
    });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="scan-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="close-scan">
          <Feather name="x" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Scan receipt</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxxl }}>
        <View style={styles.preview}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <View style={styles.placeholder}>
              <Feather name="camera" size={40} color={colors.onSurfaceTertiary} />
              <Text style={styles.placeholderText}>Take or upload a receipt photo</Text>
            </View>
          )}
          {scanning && (
            <View style={styles.overlay}>
              <ActivityIndicator color="#FFF" size="large" />
              <Text style={styles.overlayText}>Extracting details with AI...</Text>
            </View>
          )}
        </View>

        <View style={styles.actionsRow}>
          <Pressable onPress={() => pick('camera')} style={styles.actionBtn} testID="scan-camera">
            <Feather name="camera" size={18} color={colors.onSurface} />
            <Text style={styles.actionText}>Camera</Text>
          </Pressable>
          <Pressable onPress={() => pick('gallery')} style={styles.actionBtn} testID="scan-gallery">
            <Feather name="image" size={18} color={colors.onSurface} />
            <Text style={styles.actionText}>Gallery</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.error} testID="scan-error">{error}</Text> : null}

        {result && (
          <View style={styles.resultCard} testID="scan-result">
            <Text style={styles.resultTitle}>Extracted details</Text>
            <Row label="Merchant" value={result.merchant || '—'} />
            <Row label="Amount" value={result.amount != null ? `${result.currency || ''} ${result.amount}` : '—'} />
            <Row label="Date" value={result.date || '—'} />
            <Row label="Category" value={result.category || '—'} />
            <Pressable onPress={useResult} style={styles.useBtn} testID="use-scan-result">
              <Text style={styles.useBtnText}>Use these details</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {imageUri && !result && (
        <View style={[styles.bar, { paddingBottom: insets.bottom + SPACING.md }]}>
          <Pressable onPress={runScan} disabled={scanning} style={[styles.scanBtn, scanning && { opacity: 0.5 }]} testID="run-scan-button">
            {scanning ? <ActivityIndicator color="#FFF" /> : <Text style={styles.scanBtnText}>Extract with AI</Text>}
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.rrow}>
      <Text style={styles.rlabel}>{label}</Text>
      <Text style={styles.rvalue}>{value}</Text>
    </View>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.border, paddingTop: SPACING.sm },
  title: { fontSize: FONT.size.lg, fontWeight: '700', color: colors.onSurface },
  preview: { height: 320, borderRadius: RADIUS.lg, overflow: 'hidden', backgroundColor: colors.surfaceSecondary },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.sm },
  placeholderText: { color: colors.onSurfaceTertiary, fontSize: FONT.size.base },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', gap: SPACING.md },
  overlayText: { color: '#FFF', fontWeight: '600' },
  actionsRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.lg },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, height: 48, borderRadius: RADIUS.md, backgroundColor: colors.surfaceSecondary },
  actionText: { fontWeight: '600', color: colors.onSurface },
  error: { marginTop: SPACING.md, color: colors.error, fontSize: FONT.size.base },
  resultCard: { marginTop: SPACING.lg, padding: SPACING.lg, borderRadius: RADIUS.md, backgroundColor: colors.brandTertiary, gap: SPACING.sm },
  resultTitle: { fontSize: FONT.size.lg, fontWeight: '700', color: colors.brand, marginBottom: SPACING.sm },
  rrow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  rlabel: { color: colors.onSurfaceSecondary, fontWeight: '600' },
  rvalue: { color: colors.onSurface, fontWeight: '700' },
  useBtn: { marginTop: SPACING.md, backgroundColor: colors.brand, height: 48, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  useBtnText: { color: '#FFF', fontWeight: '700', fontSize: FONT.size.base },
  bar: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  scanBtn: { backgroundColor: colors.brand, height: 54, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  scanBtnText: { color: '#FFF', fontSize: FONT.size.lg, fontWeight: '700' },
});
