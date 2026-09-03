import { View, Text, StyleSheet, Pressable, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import Feather from '@react-native-vector-icons/feather';
import { api } from '../src/api';
import { COLORS, SPACING, RADIUS, FONT } from '../src/theme';

export default function AddFriend() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.createFriend({ name: name.trim(), email: email.trim() || null });
      router.back();
    } catch (e) { console.warn(e); }
    finally { setSaving(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.surface }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="close-add-friend">
          <Feather name="x" size={24} color={COLORS.onSurface} />
        </Pressable>
        <Text style={styles.title}>Add friend</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={{ padding: SPACING.lg, flex: 1 }}>
        <Text style={styles.label}>Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="John Doe"
          placeholderTextColor={COLORS.onSurfaceTertiary}
          style={styles.input}
          testID="friend-name-input"
          autoFocus
        />
        <Text style={styles.label}>Email (optional)</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="john@example.com"
          placeholderTextColor={COLORS.onSurfaceTertiary}
          style={styles.input}
          keyboardType="email-address"
          autoCapitalize="none"
          testID="friend-email-input"
        />
      </View>

      <View style={[styles.bar, { paddingBottom: insets.bottom + SPACING.md }]}>
        <Pressable onPress={save} disabled={saving || !name.trim()} style={[styles.saveBtn, (!name.trim() || saving) && { opacity: 0.5 }]} testID="save-friend-button">
          {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveText}>Add friend</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  title: { fontSize: FONT.size.lg, fontWeight: '700', color: COLORS.onSurface },
  label: { fontSize: FONT.size.sm, fontWeight: '700', color: COLORS.onSurfaceTertiary, textTransform: 'uppercase', marginBottom: SPACING.sm, marginTop: SPACING.md, letterSpacing: 0.5 },
  input: { backgroundColor: COLORS.surfaceSecondary, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, height: 52, fontSize: FONT.size.lg, color: COLORS.onSurface },
  bar: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  saveBtn: { backgroundColor: COLORS.brand, height: 54, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#FFF', fontSize: FONT.size.lg, fontWeight: '700' },
});
