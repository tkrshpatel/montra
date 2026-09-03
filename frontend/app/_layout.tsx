import { Stack, useRouter, useSegments } from 'expo-router';
import { LogBox, View, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { FxProvider } from '../src/fx/FxContext';
import { COLORS } from '../src/theme';

LogBox.ignoreAllLogs(true);

function AuthGate() {
  const { loading, user } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;
    const first = segments[0] as string | undefined;
    const inAuthArea = first === 'login';
    if (!user && !inAuthArea) {
      router.replace('/login');
    } else if (user && inAuthArea) {
      router.replace('/(tabs)/dashboard');
    } else if (user && !first) {
      router.replace('/(tabs)/dashboard');
    }
  }, [loading, user, segments, router]);

  if (loading) {
    return (
      <View style={styles.loader} testID="app-loading">
        <ActivityIndicator size="large" color={COLORS.brand} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.surface } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="add-expense" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="scan" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="add-friend" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="groups" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="recurring" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="settle" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="insights" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="expense/[id]" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <FxProvider>
            <StatusBar style="dark" />
            <AuthGate />
          </FxProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface },
});
