import AsyncStorage from '@react-native-async-storage/async-storage'
import { deleteField, doc, runTransaction, setDoc } from 'firebase/firestore'
import { db } from './firebase'

const registrationStorageKey = 'expo-push-registration'

interface PushRegistration {
  uid: string
  token: string
}

let operationQueue: Promise<void> = Promise.resolve()
const blockedUserIds = new Set<string>()

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation)
  operationQueue = result.then(() => undefined, () => undefined)
  return result
}

async function getSavedRegistration(): Promise<PushRegistration | null> {
  const value = await AsyncStorage.getItem(registrationStorageKey)
  if (!value) return null

  let registration: unknown
  try {
    registration = JSON.parse(value)
  } catch {
    throw new Error('Stored Expo push registration is invalid.')
  }

  if (
    typeof registration !== 'object'
    || registration === null
    || !('uid' in registration)
    || typeof registration.uid !== 'string'
    || !('token' in registration)
    || typeof registration.token !== 'string'
  ) {
    throw new Error('Stored Expo push registration is invalid.')
  }

  return { uid: registration.uid, token: registration.token }
}

async function removeTokenIfItMatches(uid: string, token: string): Promise<boolean> {
  const userRef = doc(db, 'users', uid)
  return runTransaction(db, async (transaction) => {
    const userSnapshot = await transaction.get(userRef)
    if (userSnapshot.data()?.expoPushToken !== token) return false
    transaction.update(userRef, { expoPushToken: deleteField() })
    return true
  })
}

export function associateExpoPushToken(
  uid: string,
  token: string,
  previousUid: string | null,
  isCurrentUser: () => boolean,
): Promise<boolean> {
  return serialize(async () => {
    if (blockedUserIds.has(uid) || !isCurrentUser()) return false

    const previousRegistration = await getSavedRegistration()
    const oldUid = previousRegistration?.uid ?? previousUid
    const oldToken = previousRegistration?.token ?? token

    if (oldUid && oldUid !== uid) {
      if (blockedUserIds.has(uid) || !isCurrentUser()) return false
      await removeTokenIfItMatches(oldUid, oldToken)
    }

    if (blockedUserIds.has(uid) || !isCurrentUser()) return false
    await AsyncStorage.setItem(registrationStorageKey, JSON.stringify({ uid, token }))
    if (blockedUserIds.has(uid) || !isCurrentUser()) return false
    await setDoc(doc(db, 'users', uid), { expoPushToken: token }, { merge: true })
    return true
  })
}

export function allowExpoPushTokenRegistration(uid: string): void {
  blockedUserIds.delete(uid)
}

export function clearExpoPushToken(uid: string): Promise<string | null> {
  blockedUserIds.add(uid)
  return serialize(async () => {
    const registration = await getSavedRegistration()
    if (!registration || registration.uid !== uid) return null

    const removed = await removeTokenIfItMatches(uid, registration.token)
    await AsyncStorage.removeItem(registrationStorageKey)
    return removed ? registration.token : null
  })
}
