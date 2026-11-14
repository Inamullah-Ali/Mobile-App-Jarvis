import Ionicons from '@react-native-vector-icons/ionicons'
import { useAuthStore } from '@/store/useauthstore'
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { db } from '../../../lib/firebase'

type NotificationFilter = 'all' | 'unread' | 'read'

interface AppNotification {
  id: string
  title?: string
  body?: string
  read?: boolean
  pushStatus?: string
  pushError?: string | null
  type?: string
  progress?: number
  received?: number
  total?: number | null
  downloadState?: string
  fileName?: string
  createdAt?: { toDate?: () => Date } | number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let size = bytes / 1024
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`
}

export default function NotificationsScreen() {
  const user = useAuthStore((state) => state.user)
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [filter, setFilter] = useState<NotificationFilter>('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.uid) return

    const notificationsQuery = query(
      collection(db, 'users', user.uid, 'notifications'),
      orderBy('createdAt', 'desc'),
      limit(100),
    )
    return onSnapshot(
      notificationsQuery,
      (snapshot) => {
        setNotifications(snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        } as AppNotification)))
        setLoadError(null)
        setLoading(false)
      },
      (error) => {
        console.error('[Mobile] Could not load notifications:', error)
        setLoadError('Notifications could not be loaded. Check your connection and try again.')
        setLoading(false)
      },
    )
  }, [user?.uid])

  const visibleNotifications = useMemo(
    () => notifications.filter((item) => (
      filter === 'all'
      || (filter === 'unread' && !item.read)
      || (filter === 'read' && item.read)
    )),
    [filter, notifications],
  )

  const markAsRead = async (notification: AppNotification) => {
    if (!user?.uid || notification.read) return
    try {
      await updateDoc(doc(db, 'users', user.uid, 'notifications', notification.id), { read: true })
    } catch (error) {
      console.error('[Mobile] Could not mark notification as read:', error)
      Alert.alert('Update failed', 'Could not mark this notification as read. Please try again.')
    }
  }

  const renderNotification = ({ item }: { item: AppNotification }) => {
    const progress = typeof item.progress === 'number'
      ? Math.min(100, Math.max(0, item.progress))
      : null
    const createdAt = item.createdAt && typeof item.createdAt === 'object' && item.createdAt.toDate
      ? item.createdAt.toDate()
      : typeof item.createdAt === 'number'
        ? new Date(item.createdAt)
        : null

    return (
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => { void markAsRead(item) }}
        style={[styles.notificationCard, !item.read && styles.unreadCard]}
      >
        <View style={styles.notificationHeader}>
          <Text style={styles.notificationTitle}>{item.title || 'Desktop activity'}</Text>
          {!item.read && <View style={styles.unreadDot} />}
        </View>
        <Text style={styles.notificationBody}>{item.body || item.fileName || 'Desktop activity update'}</Text>
        {item.pushStatus && item.pushStatus !== 'accepted' && (
          <Text style={styles.pushStatus}>
            {item.pushStatus === 'disabled'
              ? 'Phone push notifications are switched off.'
              : item.pushStatus === 'missing_token'
                ? 'Push not set up: allow notifications in the app.'
                : `Push failed: ${item.pushError || item.pushStatus}`}
          </Text>
        )}
        {(progress !== null || (typeof item.received === 'number' && item.received > 0)) && (
          <View style={styles.progressSection}>
            {progress !== null ? (
              <>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressBar, { width: `${progress}%` }]} />
                </View>
                <Text style={styles.progressText}>
                  {item.downloadState === 'complete' ? 'Complete' : `${progress}%`}
                </Text>
              </>
            ) : (
              <Text style={styles.progressText}>
                {formatBytes(item.received || 0)} downloaded
              </Text>
            )}
          </View>
        )}
        <View style={styles.notificationFooter}>
          {createdAt && <Text style={styles.timestamp}>{createdAt.toLocaleString()}</Text>}
          <Text style={styles.readState}>{item.read ? 'Read' : 'Unread'}</Text>
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <Ionicons name="notifications" size={24} color="#4a90d9" />
        <Text style={styles.title}>Notifications</Text>
      </View>
      <View style={styles.filters}>
        {(['all', 'unread', 'read'] as const).map((value) => (
          <TouchableOpacity
            key={value}
            onPress={() => setFilter(value)}
            style={[styles.filterButton, filter === value && styles.activeFilter]}
          >
            <Text style={[styles.filterText, filter === value && styles.activeFilterText]}>
              {value === 'all' ? `All (${notifications.length})` : value === 'unread' ? 'Unread' : 'Read'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loader} size="large" color="#4a90d9" />
      ) : loadError ? (
        <Text style={styles.emptyText}>{loadError}</Text>
      ) : visibleNotifications.length === 0 ? (
        <Text style={styles.emptyText}>No {filter === 'all' ? '' : `${filter} `}notifications yet.</Text>
      ) : (
        <FlatList
          data={visibleNotifications}
          keyExtractor={(item) => item.id}
          renderItem={renderNotification}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', paddingHorizontal: 18, paddingTop: 52 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  title: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  filters: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  filterButton: { paddingVertical: 8, paddingHorizontal: 13, borderRadius: 18, backgroundColor: '#1e1e1e' },
  activeFilter: { backgroundColor: '#2768a8' },
  filterText: { color: '#aaa', fontSize: 13, textTransform: 'capitalize' },
  activeFilterText: { color: '#fff', fontWeight: '600' },
  list: { paddingBottom: 20 },
  notificationCard: { padding: 15, marginBottom: 10, borderRadius: 10, backgroundColor: '#1e1e1e', borderWidth: 1, borderColor: '#292929' },
  unreadCard: { borderColor: '#2768a8' },
  notificationHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  notificationTitle: { color: '#fff', fontWeight: '700', fontSize: 15, flex: 1 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4a90d9', marginLeft: 10 },
  notificationBody: { color: '#bbb', fontSize: 14, marginTop: 7 },
  pushStatus: { color: '#ffb74d', fontSize: 12, marginTop: 8 },
  progressSection: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  progressTrack: { height: 6, flex: 1, borderRadius: 3, backgroundColor: '#383838', overflow: 'hidden' },
  progressBar: { height: '100%', backgroundColor: '#4a90d9' },
  progressText: { color: '#aaa', fontSize: 12, minWidth: 48, textAlign: 'right' },
  notificationFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 11 },
  timestamp: { color: '#777', fontSize: 11 },
  readState: { color: '#777', fontSize: 11 },
  loader: { marginTop: 50 },
  emptyText: { color: '#888', textAlign: 'center', marginTop: 42, lineHeight: 22 },
})
