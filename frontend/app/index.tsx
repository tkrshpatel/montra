import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '../src/theme';

export default function Index() {
  const { colors } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]} testID="root-index">
      <ActivityIndicator size="large" color={colors.brand} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
