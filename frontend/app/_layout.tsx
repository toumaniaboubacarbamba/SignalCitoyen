import { Stack, useRouter } from 'expo-router';
import { AuthProvider } from '@/src/contexts/AuthContext';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Asset } from 'expo-asset';
import { Image, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';

// Prewarm icon assets for Android Expo Go
const iconAssets = [
  require('@/assets/images/icon.png'),
  require('@/assets/images/favicon.png'),
];

function cacheImages(images: any[]) {
  return images.map((image: any) => {
    if (typeof image === 'string') {
      return Image.prefetch(image);
    } else {
      return Asset.fromModule(image).downloadAsync();
    }
  });
}

// Push notification handlers - MODULE SCOPE
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
  });
}

export default function RootLayout() {
  const router = useRouter();
  const [appIsReady, setAppIsReady] = React.useState(false);

  React.useEffect(() => {
    async function loadResourcesAndDataAsync() {
      try {
        await Promise.all(cacheImages(iconAssets));
      } catch (e) {
        console.warn(e);
      } finally {
        setAppIsReady(true);
      }
    }

    loadResourcesAndDataAsync();
  }, []);

  // Push notification tap handlers
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data || {};
      const url = (data as any).deeplink || (data as any).action_url;
      if (!url) return;
      if (typeof url === 'string') {
        url.startsWith('http') ? Linking.openURL(url) : router.push(url as any);
      }
    });

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data || {};
      const url = (data as any).deeplink || (data as any).action_url;
      if (url && typeof url === 'string') {
        url.startsWith('http') ? Linking.openURL(url) : router.push(url as any);
      }
    });

    return () => {
      tapSub.remove();
    };
  }, []);

  if (!appIsReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="auth/login" />
          <Stack.Screen name="auth/register" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
