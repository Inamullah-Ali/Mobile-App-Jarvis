import { useAuthStore } from '@/store/useauthstore'
import { addDoc, collection, doc, onSnapshot } from 'firebase/firestore'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
    GestureResponderEvent,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native'
import { db } from '../../../lib/firebase'

const SENSITIVITY = 1.5
const SCROLL_SENSITIVITY = 1.5
const TAP_THRESHOLD_MS = 240
const LONG_PRESS_MS = 550
const GESTURE_DISTANCE_THRESHOLD = 18

function getAverageTouchY(event: GestureResponderEvent) {
  const touches = event.nativeEvent.touches
  if (touches.length === 0) return null
  return touches.reduce((sum, touch) => sum + touch.pageY, 0) / touches.length
}

export default function TouchpadScreen({ embedded = false }: { embedded?: boolean }) {
  const user = useAuthStore((s) => s.user)
  const [textToType, setTextToType] = useState('')
  const [isLocal, setIsLocal] = useState(false)
  const [desktopStatus, setDesktopStatus] = useState<{ userId: string | null; online: boolean; localIps: string[] }>({
    userId: null,
    online: false,
    localIps: [],
  })
  const [commandError, setCommandError] = useState<string | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const lastMoveRef = useRef({ x: 0, y: 0 })
  const pointerStartRef = useRef({ x: 0, y: 0, time: 0 })
  const multiTouchRef = useRef(false)
  const multiTouchStartRef = useRef({ time: 0, distance: 0 })
  const lastScrollYRef = useRef<number | null>(null)
  const selectingRef = useRef(false)
  const localIpsRef = useRef<{ userId: string; ips: string[] } | null>(null)
  const desktopOnline = desktopStatus.userId === user?.uid && desktopStatus.online
  const localIpsKey = desktopStatus.userId === user?.uid ? desktopStatus.localIps.join(',') : ''

  useEffect(() => {
    if (!user?.uid) return

    return onSnapshot(
      doc(db, 'devices', user.uid),
      (snapshot) => {
        const data = snapshot.data()
        const lastSeen = data?.lastSeen?.toDate?.()
        const online = data?.status === 'online'
          && lastSeen instanceof Date
          && Date.now() - lastSeen.getTime() <= 30_000
        const localIps = Array.isArray(data?.localIps)
          ? data.localIps.filter((ip: unknown): ip is string => typeof ip === 'string')
          : []
        if (
          localIpsRef.current?.userId === user.uid
          && localIpsRef.current.ips.join(',') !== localIps.join(',')
        ) {
          setIsLocal(false)
        }
        localIpsRef.current = { userId: user.uid, ips: localIps }
        setDesktopStatus({ userId: user.uid, online, localIps })
        if (online) setCommandError(null)
      },
      (error) => {
        console.error('[Touchpad] Could not check desktop availability:', error)
        localIpsRef.current = { userId: user.uid, ips: [] }
        setIsLocal(false)
        setDesktopStatus({ userId: user.uid, online: false, localIps: [] })
        setCommandError('Could not check whether the desktop is online.')
      },
    )
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid || localIpsKey.length === 0) return

    const localIps = localIpsKey.split(',')
    let cancelled = false
    let currentSocket: WebSocket | null = null
    let connectionTimeout: ReturnType<typeof setTimeout> | null = null

    const tryAddress = (index: number) => {
      if (cancelled) return
      if (index >= localIps.length) {
        setIsLocal(false)
        return
      }

      const socket = new WebSocket(`ws://${localIps[index]}:8080`)
      currentSocket = socket
      wsRef.current = socket
      let settled = false

      const tryNextAddress = () => {
        if (settled || cancelled) return
        settled = true
        if (connectionTimeout) clearTimeout(connectionTimeout)
        socket.onopen = null
        socket.onerror = null
        socket.onclose = null
        socket.close()
        tryAddress(index + 1)
      }

      connectionTimeout = setTimeout(tryNextAddress, 2500)
      socket.onopen = () => {
        if (cancelled) {
          socket.close()
          return
        }
        settled = true
        if (connectionTimeout) clearTimeout(connectionTimeout)
        setIsLocal(true)
      }
      socket.onerror = tryNextAddress
      socket.onclose = () => {
        if (settled && !cancelled) setIsLocal(false)
      }
    }

    tryAddress(0)

    return () => {
      cancelled = true
      if (connectionTimeout) clearTimeout(connectionTimeout)
      if (currentSocket) {
        currentSocket.onopen = null
        currentSocket.onerror = null
        currentSocket.onclose = null
        currentSocket.close()
        if (wsRef.current === currentSocket) wsRef.current = null
      }
    }
  }, [localIpsKey, user?.uid])

  const sendCommand = useCallback(
    async (type: string, data: Record<string, unknown>): Promise<boolean> => {
      if (!user?.uid) return false

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type, ...data }))
        return true
      }

      if (!desktopOnline) {
        setCommandError('Desktop is offline. Mouse and keyboard commands are not queued.')
        return false
      }

      try {
        await addDoc(collection(db, 'commands'), {
          userId: user.uid,
          type,
          ...data,
          processed: false,
          timestamp: Date.now(),
        })
        setCommandError(null)
        return true
      } catch (error) {
        console.error('[Touchpad] Failed to send command', error)
        setCommandError('Could not send the mouse or keyboard command.')
        return false
      }
    },
    [desktopOnline, user],
  )

  const handleTouchStart = useCallback((event: GestureResponderEvent) => {
    const { locationX, locationY, touches } = event.nativeEvent
    const now = Date.now()

    lastMoveRef.current = { x: locationX, y: locationY }
    pointerStartRef.current = { x: locationX, y: locationY, time: now }
    multiTouchRef.current = touches.length > 1
    multiTouchStartRef.current = { time: now, distance: 0 }
    lastScrollYRef.current = getAverageTouchY(event)
  }, [])

  const handleTouchMove = useCallback(
    (event: GestureResponderEvent) => {
      const { locationX, locationY, touches } = event.nativeEvent

      if (touches.length > 1) {
        const currentY = getAverageTouchY(event)
        if (currentY === null) return

        if (!multiTouchRef.current) {
          multiTouchRef.current = true
          multiTouchStartRef.current = { time: Date.now(), distance: 0 }
          lastScrollYRef.current = currentY
          return
        }

        const previousY = lastScrollYRef.current
        lastScrollYRef.current = currentY
        if (previousY === null) return

        const deltaY = currentY - previousY
        multiTouchStartRef.current.distance += Math.abs(deltaY)
        if (Math.abs(deltaY) >= 1) {
          void sendCommand('scroll', { dy: Math.round(-deltaY * SCROLL_SENSITIVITY) })
        }
        return
      }

      if (multiTouchRef.current) return

      const previous = lastMoveRef.current
      const dx = (locationX - previous.x) * SENSITIVITY
      const dy = (locationY - previous.y) * SENSITIVITY
      lastMoveRef.current = { x: locationX, y: locationY }

      if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
        void sendCommand('mouse_move', { dx, dy })
      }
    },
    [sendCommand],
  )

  const handleTouchEnd = useCallback(
    (event: GestureResponderEvent) => {
      if (event.nativeEvent.touches.length > 0) {
        lastScrollYRef.current = getAverageTouchY(event)
        return
      }

      if (multiTouchRef.current) {
        const elapsed = Date.now() - multiTouchStartRef.current.time
        if (
          elapsed <= TAP_THRESHOLD_MS &&
          multiTouchStartRef.current.distance < GESTURE_DISTANCE_THRESHOLD
        ) {
          void sendCommand('click', { button: 'middle' })
        }
      } else if (!selectingRef.current) {
        const elapsed = Date.now() - pointerStartRef.current.time
        const distance = Math.hypot(
          lastMoveRef.current.x - pointerStartRef.current.x,
          lastMoveRef.current.y - pointerStartRef.current.y,
        )

        if (elapsed >= LONG_PRESS_MS && distance < GESTURE_DISTANCE_THRESHOLD) {
          void sendCommand('click', { button: 'right' })
        } else if (elapsed <= TAP_THRESHOLD_MS && distance < GESTURE_DISTANCE_THRESHOLD) {
          void sendCommand('click', { button: 'left' })
        }
      }

      multiTouchRef.current = false
      lastScrollYRef.current = null
      lastMoveRef.current = { x: 0, y: 0 }
      pointerStartRef.current = { x: 0, y: 0, time: 0 }
    },
    [sendCommand],
  )

  const handleTouchCancel = useCallback(() => {
    multiTouchRef.current = false
    lastScrollYRef.current = null
    lastMoveRef.current = { x: 0, y: 0 }
    pointerStartRef.current = { x: 0, y: 0, time: 0 }
  }, [])

  const toggleSelection = useCallback(() => {
    const nextSelecting = !selectingRef.current
    selectingRef.current = nextSelecting
    setIsSelecting(nextSelecting)
    void sendCommand(nextSelecting ? 'mouse_down' : 'mouse_up', { button: 'left' })
  }, [sendCommand])

  const sendText = useCallback(async () => {
    if (textToType.length === 0) return

    const sent = await sendCommand('type', { text: textToType })
    if (!sent) return
    setTextToType('')
    await sendCommand('key', { key: 'ENTER' })
  }, [sendCommand, textToType])

  return (
    <View style={[styles.container, embedded && styles.embeddedContainer]}>
      <Text style={[styles.title, embedded && styles.embeddedTitle]}>Remote Touchpad</Text>
      <Text style={{ color: isLocal ? '#4caf50' : desktopOnline ? '#58d68d' : '#f44336', textAlign: 'center', marginBottom: 10 }}>
        {isLocal ? 'Local connection (fast)' : desktopOnline ? 'Cloud connection' : 'Desktop offline'}
      </Text>
      {commandError ? <Text style={styles.commandError}>{commandError}</Text> : null}
      <Text style={styles.gestureHint}>One finger: move / tap · Two fingers: scroll / middle click</Text>

      <View
        style={[styles.touchpad, embedded && styles.embeddedTouchpad, isSelecting && styles.touchpadSelecting]}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={handleTouchStart}
        onResponderMove={handleTouchMove}
        onResponderRelease={handleTouchEnd}
        onResponderTerminate={handleTouchCancel}
      >
        <Text style={styles.touchpadText}>
          {isSelecting ? 'Selection active — move to select text' : 'Move finger here'}
        </Text>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.clickBtn}
          onPress={() => void sendCommand('click', { button: 'left' })}
        >
          <Text style={styles.btnText}>Left click</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.clickBtn}
          onPress={() => void sendCommand('click', { button: 'middle' })}
        >
          <Text style={styles.btnText}>Middle click</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.clickBtn}
          onPress={() => void sendCommand('click', { button: 'right' })}
        >
          <Text style={styles.btnText}>Right click</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ selected: isSelecting }}
        style={[styles.selectBtn, isSelecting && styles.selectBtnActive]}
        onPress={toggleSelection}
      >
        <Text style={styles.btnText}>{isSelecting ? 'End text selection' : 'Hold to select text'}</Text>
      </TouchableOpacity>

      <View style={styles.keyboardBox}>
        <TextInput
          style={styles.input}
          placeholder="Type with your mobile keyboard..."
          placeholderTextColor="#888"
          value={textToType}
          onChangeText={setTextToType}
          onSubmitEditing={() => void sendText()}
          returnKeyType="send"
          blurOnSubmit={false}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={() => void sendText()}>
          <Text style={styles.btnText}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', padding: 20 },
  embeddedContainer: { flex: 0, backgroundColor: 'transparent', padding: 0, marginTop: 20 },
  title: {
    fontSize: 24,
    color: '#4a90d9',
    fontWeight: 'bold',
    marginBottom: 14,
    textAlign: 'center',
    marginTop: 40,
  },
  embeddedTitle: { fontSize: 20, marginTop: 0, marginBottom: 8 },
  commandError: { color: '#ff8a80', textAlign: 'center', marginBottom: 8, fontSize: 12 },
  gestureHint: { color: '#aaa', textAlign: 'center', marginBottom: 10, fontSize: 12 },
  touchpad: {
    flex: 1,
    backgroundColor: '#1e1e1e',
    borderRadius: 15,
    borderWidth: 2,
    borderColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
  },
  embeddedTouchpad: { flex: 0, height: 140 },
  touchpadSelecting: { borderColor: '#28a745' },
  touchpadText: { color: '#aaa', textAlign: 'center' },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  clickBtn: {
    flex: 1,
    backgroundColor: '#4a90d9',
    paddingVertical: 13,
    borderRadius: 10,
    marginHorizontal: 3,
    alignItems: 'center',
  },
  selectBtn: {
    backgroundColor: '#3d3d3d',
    padding: 13,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  selectBtnActive: { backgroundColor: '#a04444' },
  keyboardBox: { flexDirection: 'row', alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: '#222',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 15,
    marginRight: 10,
    minHeight: 48,
  },
  sendBtn: { backgroundColor: '#28a745', padding: 15, borderRadius: 10, justifyContent: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
})
