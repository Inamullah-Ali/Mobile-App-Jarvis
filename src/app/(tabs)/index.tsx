// src/app/(tabs)/index.tsx
import { useAuthStore } from '@/store/useauthstore'
import { useRouter } from 'expo-router'
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native'
import { db } from '../../../lib/firebase'; // Apna path check karein

export default function HomeScreen() {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  
  const [laptopStatus, setLaptopStatus] = useState<'online' | 'offline'>('offline')
  const [lastSeen, setLastSeen] = useState<string>('Never')
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [savingNotificationSetting, setSavingNotificationSetting] = useState(false)

  // ✅ Laptop Status Check (Har 10 second)
  useEffect(() => {
    if (!user?.uid) return

    const checkStatus = async () => {
      try {
        const deviceRef = doc(db, 'devices', user.uid)
        const snap = await getDoc(deviceRef)

        if (snap.exists()) {
          const data = snap.data()
          
          if (data.lastSeen) {
            const lastSeenTime = data.lastSeen.toDate()
            const now = new Date()
            const diffSeconds = (now.getTime() - lastSeenTime.getTime()) / 1000

            // ✅ Agar lastSeen 60 second se purana hai, to Offline
            if (diffSeconds > 10) {
              setLaptopStatus('offline')
            } else {
              setLaptopStatus('online')
            }
            setLastSeen(lastSeenTime.toLocaleString())
          }
        }
      } catch (e) {
        console.log('[Mobile] Status check failed:', e)
      }
    }

    checkStatus() // Pehli baar
    const interval = setInterval(checkStatus, 3000) // Har 10 sec
    return () => clearInterval(interval)
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid) return
    return onSnapshot(
      doc(db, 'users', user.uid),
      (snapshot) => setNotificationsEnabled(snapshot.data()?.notificationsEnabled !== false),
      (error) => console.error('[Mobile] Could not load notification settings:', error),
    )
  }, [user?.uid])

  const toggleNotifications = async (enabled: boolean) => {
    if (!user?.uid) return
    setNotificationsEnabled(enabled)
    setSavingNotificationSetting(true)
    try {
      await setDoc(doc(db, 'users', user.uid), { notificationsEnabled: enabled }, { merge: true })
    } catch (error) {
      setNotificationsEnabled(!enabled)
      console.error('[Mobile] Could not update notification settings:', error)
      Alert.alert('Settings not saved', 'Could not update push notification settings. Please try again.')
    } finally {
      setSavingNotificationSetting(false)
    }
  }

  const handleLogout = async () => {
    Alert.alert('Logout', 'Kya aap waqai logout karna chahte hain?', [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Logout', style: 'destructive', 
        onPress: async () => {
          try {
            await logout()
            router.replace('/(auth)/loginpage')
          } catch (error) {
            console.error('[Mobile] Logout failed:', error)
            Alert.alert('Logout failed', "Could not safely remove this device's push token. Check your connection and try again.")
          }
        }
      }
    ])
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Welcome, {user?.name || 'User'}!</Text>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>
      
      
      <View style={styles.statusBox}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: laptopStatus === 'online' ? '#4caf50' : '#f44336' }} />
        <Text style={{ color: '#fff', marginLeft: 10, fontSize: 14 }}>
          Laptop: {laptopStatus === 'online' ? 'Online (Active)' : `Offline (Last seen: ${lastSeen})`}
        </Text>
      </View>
      
        <Text style={styles.title}>Welcome, {user?.email || 'User'}!</Text>

      <Text style={styles.subtitle}>JARVIS is ready to help you.</Text>
      
      <TouchableOpacity style={styles.button} onPress={() => router.push('/(tabs)/chat')}>
        <Text style={styles.buttonText}>💬 Open Chat</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={() => router.push('/notifications')}>
        <Text style={styles.secondaryButtonText}>🔔 Notifications</Text>
      </TouchableOpacity>

      <View style={styles.notificationSetting}>
        <View style={styles.notificationSettingCopy}>
          <Text style={styles.notificationSettingTitle}>Desktop push notifications</Text>
          <Text style={styles.notificationSettingDescription}>
            {notificationsEnabled ? 'Download updates are enabled' : 'Push notifications are paused'}
          </Text>
        </View>
        <Switch
          value={notificationsEnabled}
          onValueChange={toggleNotifications}
          disabled={savingNotificationSetting}
          trackColor={{ false: '#555', true: '#2768a8' }}
          thumbColor={notificationsEnabled ? '#4a90d9' : '#bbb'}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, marginBottom: 30 },
  title: { fontSize: 22, color: '#4a90d9', fontWeight: 'bold' },
  logoutBtn: { backgroundColor: '#c62828', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 6 },
  logoutText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  statusBox: { flexDirection: 'row', alignItems: 'center', marginBottom: 30, backgroundColor: '#1e1e1e', padding: 15, borderRadius: 10 },
  subtitle: { fontSize: 16, color: '#aaa', marginBottom: 40, textAlign: 'center' },
  button: { backgroundColor: '#4a90d9', padding: 15, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  secondaryButton: { backgroundColor: '#1e1e1e', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: '#333' },
  secondaryButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  notificationSetting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 28, padding: 16, borderRadius: 10, backgroundColor: '#1e1e1e' },
  notificationSettingCopy: { flex: 1, paddingRight: 12 },
  notificationSettingTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  notificationSettingDescription: { color: '#aaa', fontSize: 13, marginTop: 5 },
})