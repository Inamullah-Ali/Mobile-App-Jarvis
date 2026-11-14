// src/app/_layout.tsx
import { useAuthStore } from '@/store/useauthstore'
import { UseHydrated } from '@/store/usehydratestore'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { onAuthStateChanged } from 'firebase/auth'
import { useEffect } from 'react'
import { ActivityIndicator, Platform, View } from 'react-native'
import { allowExpoPushTokenRegistration, associateExpoPushToken } from '../../lib/pushTokens'
import { auth } from '../../lib/firebase'

// ✅ Jab app khuli ho to notification kaise dikhe
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

export default function RootLayout() {
  const router = useRouter()
  const hydrated = UseHydrated()
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)

  useEffect(() => {
    if (!hydrated) return

    const registrationsInProgress = new Set<string>()

    async function registerForPushNotificationsAsync(
      currentUserId: string,
      requestPermission: boolean,
    ) {
      if (registrationsInProgress.has(currentUserId)) return
      registrationsInProgress.add(currentUserId)

      try {
        if (!Device.isDevice) {
          console.log('[Push] Must use physical device for Push Notifications')
          return
        }

        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF231F7C',
          })
        }

        const { status: existingStatus } = await Notifications.getPermissionsAsync()
        let finalStatus = existingStatus
        if (existingStatus !== 'granted' && requestPermission) {
          const { status } = await Notifications.requestPermissionsAsync()
          finalStatus = status
        }
        if (finalStatus !== 'granted') {
          console.error(`[Push] Notification permission is ${finalStatus}; enable it in Android app settings`)
          return
        }

        const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId
        if (!projectId) {
          console.error('[Push] Set EXPO_PUBLIC_EAS_PROJECT_ID to enable remote push notifications')
          return
        }

        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data
        const currentState = useAuthStore.getState()
        if (
          !currentState.isLoggedIn
          || currentState.user?.uid !== currentUserId
          || auth.currentUser?.uid !== currentUserId
        ) return

        const registered = await associateExpoPushToken(
          currentUserId,
          token,
          null,
          () => {
            const latestState = useAuthStore.getState()
            return latestState.isLoggedIn
              && latestState.user?.uid === currentUserId
              && auth.currentUser?.uid === currentUserId
          },
        )
        if (registered) console.info('[Push] Push token registered')
      } catch (error) {
        console.error('[Push] Token registration or saving failed:', error)
      } finally {
        registrationsInProgress.delete(currentUserId)
      }
    }

    const registerForCurrentAccount = (requestPermission: boolean) => {
      const state = useAuthStore.getState()
      const currentUserId = auth.currentUser?.uid
      if (!currentUserId || !state.isLoggedIn || !state.user?.uid) return
      if (state.user.uid !== currentUserId) {
        console.error('[Push] Current app account does not match Firebase Auth; no token was registered.')
        return
      }
      allowExpoPushTokenRegistration(currentUserId)
      void registerForPushNotificationsAsync(currentUserId, requestPermission)
    }

    const unsubscribeAuth = onAuthStateChanged(
      auth,
      () => registerForCurrentAccount(true),
      (error) => console.error('[Auth] Could not observe the Firebase session:', error),
    )
    const unsubscribeStore = useAuthStore.subscribe(() => registerForCurrentAccount(true))
    const tokenSubscription = Notifications.addPushTokenListener(() => registerForCurrentAccount(false))
    registerForCurrentAccount(true)

    return () => {
      unsubscribeAuth()
      unsubscribeStore()
      tokenSubscription.remove()
    }
  }, [hydrated])

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(() => {
      router.push('/notifications')
    })
    return () => subscription.remove()
  }, [router])

  if (!hydrated) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#121212' }}>
        <ActivityIndicator size="large" color="#4a90d9" />
      </View>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!isLoggedIn}>
          <Stack.Screen name="(auth)/loginpage" />
        </Stack.Protected>
        <Stack.Protected guard={isLoggedIn}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
      </Stack>
      <StatusBar style="auto" />
    </View>
  )
}