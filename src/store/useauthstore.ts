// src/store/useauthstore.ts
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  GoogleAuthProvider,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import {
  GoogleSignin,
  isSuccessResponse,
} from '@react-native-google-signin/google-signin'
import { Platform } from 'react-native'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { auth, db } from '../../lib/firebase'
import {
  allowExpoPushTokenRegistration,
  associateExpoPushToken,
  clearExpoPushToken,
} from '../../lib/pushTokens'

interface User {
  uid: string
  name: string
  email: string
  phone?: string
}

class JarvisAccountNotFoundError extends Error {}

interface AuthState {
  isLoggedIn: boolean
  user: User | null
  login: (email: string, password: string) => Promise<void>
  loginWithGoogle: () => Promise<boolean>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist<AuthState>(
    (set) => ({
      isLoggedIn: false,
      user: null,

      login: async (email: string, password: string) => {
        const previousFirebaseUser = auth.currentUser
        let previousToken: string | null = null
        try {
          if (previousFirebaseUser) {
            try {
              previousToken = await clearExpoPushToken(previousFirebaseUser.uid)
            } catch (error) {
              allowExpoPushTokenRegistration(previousFirebaseUser.uid)
              throw error
            }
          }

          const result = await signInWithEmailAndPassword(auth, email, password)
          const userDoc = await getDoc(doc(db, 'users', result.user.uid))
          const userData = userDoc.exists() ? (userDoc.data() as User) : null
          set({
            isLoggedIn: true,
            user: userData ? { ...userData, uid: result.user.uid } : null
          })
        } catch (error) {
          if (previousFirebaseUser && auth.currentUser?.uid === previousFirebaseUser.uid) {
            allowExpoPushTokenRegistration(previousFirebaseUser.uid)
            if (previousToken) {
              try {
                await associateExpoPushToken(
                  previousFirebaseUser.uid,
                  previousToken,
                  null,
                  () => auth.currentUser?.uid === previousFirebaseUser.uid,
                )
              } catch (restoreError) {
                console.error('[Push] Could not restore the previous device token:', restoreError)
              }
            }
          }
          console.error("Login failed:", error)
          set({ isLoggedIn: false, user: null })
          throw error
        }
      },

      loginWithGoogle: async () => {
        if (Platform.OS !== 'android') {
          throw new Error('Google sign-in is available in the Android app.')
        }

        const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
        if (!webClientId) {
          throw new Error('Google sign-in is not configured. Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and rebuild the mobile app.')
        }

        GoogleSignin.configure({ webClientId })
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })
        await GoogleSignin.signOut()
        const response = await GoogleSignin.signIn()
        if (!isSuccessResponse(response)) return false

        const idToken = response.data.idToken
        if (!idToken) throw new Error('Google did not return an ID token. Check the mobile OAuth client configuration.')

        const previousFirebaseUser = auth.currentUser
        let previousToken: string | null = null
        try {
          if (previousFirebaseUser) {
            try {
              previousToken = await clearExpoPushToken(previousFirebaseUser.uid)
            } catch (error) {
              allowExpoPushTokenRegistration(previousFirebaseUser.uid)
              throw error
            }
          }

          const result = await signInWithCredential(
            auth,
            GoogleAuthProvider.credential(idToken),
          )
          const userRef = doc(db, 'users', result.user.uid)
          const userDoc = await getDoc(userRef)
          if (!userDoc.exists()) {
            await signOut(auth)
            set({ isLoggedIn: false, user: null })
            throw new JarvisAccountNotFoundError(
              'This Google account is not registered in Jarvis yet. First sign up in the desktop app, then try again on mobile.',
            )
          }

          const existingUser = userDoc.data() as User
          const userData: User = {
            uid: result.user.uid,
            name: existingUser?.name || result.user.displayName || 'Google User',
            email: result.user.email || existingUser?.email || '',
            ...(existingUser?.phone || result.user.phoneNumber
              ? { phone: existingUser?.phone || result.user.phoneNumber || undefined }
              : {}),
          }

          set({ isLoggedIn: true, user: userData })
          return true
        } catch (error) {
          if (previousFirebaseUser && auth.currentUser?.uid === previousFirebaseUser.uid) {
            allowExpoPushTokenRegistration(previousFirebaseUser.uid)
            if (previousToken) {
              try {
                await associateExpoPushToken(
                  previousFirebaseUser.uid,
                  previousToken,
                  null,
                  () => auth.currentUser?.uid === previousFirebaseUser.uid,
                )
              } catch (restoreError) {
                console.error('[Push] Could not restore the previous device token:', restoreError)
              }
            }
          }
          if (!(error instanceof JarvisAccountNotFoundError)) {
            console.error('Google login failed:', error)
          }
          throw error
        }
      },

      logout: async () => {
        const currentUserId = auth.currentUser?.uid
        let removedToken: string | null = null
        try {
          if (currentUserId) {
            try {
              removedToken = await clearExpoPushToken(currentUserId)
            } catch (error) {
              console.error('[Push] Could not unregister the current device token:', error)
              allowExpoPushTokenRegistration(currentUserId)
              throw error
            }
          }

          await signOut(auth)
          set({ isLoggedIn: false, user: null })
        } catch (error) {
          if (currentUserId && auth.currentUser?.uid === currentUserId) {
            allowExpoPushTokenRegistration(currentUserId)
            if (removedToken) {
              try {
                await associateExpoPushToken(
                  currentUserId,
                  removedToken,
                  null,
                  () => auth.currentUser?.uid === currentUserId,
                )
              } catch (restoreError) {
                console.error('[Push] Could not restore the current device token:', restoreError)
              }
            }
          }
          console.error("Logout failed:", error)
          throw error
        }
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
)