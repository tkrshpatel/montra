import React from 'react';
import { Pressable, Text, TextInput, View, StyleSheet, ActivityIndicator, TextInputProps } from 'react-native';
import { useTheme } from '../theme';
export function Button({ title, onPress, secondary, disabled, busy, testID }: {
  title: string; onPress: () => void; secondary?: boolean; disabled?: boolean; busy?: boolean; testID?: string;
}) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled || busy} onPress={onPress}
    testID={testID} style={{ minHeight: 48, borderRadius: 14, padding: 13, justifyContent: 'center', alignItems: 'center',
      backgroundColor: secondary ? colors.surfaceSecondary : colors.brand, opacity: disabled || busy ? 0.5 : 1 }}>
    {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={{ color: secondary ? colors.onSurface : colors.onBrand, fontWeight: '700' }}>{title}</Text>}
  </Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const { colors } = useTheme();
  return <View style={{ gap: 6 }}><Text style={{ color: colors.onSurfaceSecondary, fontWeight: '600' }}>{label}</Text>
    <TextInput accessibilityLabel={label} placeholderTextColor={colors.onSurfaceTertiary} {...props}
      style={[{ minWidth: 0, minHeight: 48, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
        backgroundColor: colors.surface, color: colors.onSurface, fontSize: 16 }, props.style]} /></View>;
}
export function ErrorText({ message }: { message: string | null }) {
  const { colors } = useTheme();
  return message ? <Text accessibilityRole="alert" style={{ color: colors.error, lineHeight: 21 }}>{message}</Text> : null;
}
export function Chip({ text, selected, onPress }: { text: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}
    style={{ borderRadius: 24, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center', borderWidth: 1,
      borderColor: selected ? colors.brand : colors.border, backgroundColor: selected ? colors.brandTertiary : colors.surface }}>
    <Text style={{ color: selected ? colors.brand : colors.onSurface, fontWeight: '600' }}>{text}</Text></Pressable>;
}
export const layout = StyleSheet.create({
  content: { padding: 20, gap: 18, paddingBottom: 48 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  card: { padding: 18, borderRadius: 20, gap: 12, borderWidth: 1 },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.7 },
  subtitle: { fontSize: 17, fontWeight: '700' },
});
