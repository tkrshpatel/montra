import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { COLORS } from '../src/theme';

// Root gate handles navigation. Show a loader here.
export default function Index() {
  return (
    <View style={styles.container} testID="root-index">
      <ActivityIndicator size="large" color={COLORS.brand} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
});
