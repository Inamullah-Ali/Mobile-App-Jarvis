// mobile-app/firebase.ts (ya jahan aapki firebase config hai)
import AsyncStorage from '@react-native-async-storage/async-storage'
import { initializeApp } from 'firebase/app'
// Firebase 13 exposes this through its React Native runtime export only.
// @ts-expect-error
import { getAuth, getReactNativePersistence, initializeAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { Platform } from 'react-native'

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID
}

const app = initializeApp(firebaseConfig)

export const auth = Platform.OS === 'web'
  ? getAuth(app)
  : initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })

export const db = getFirestore(app)