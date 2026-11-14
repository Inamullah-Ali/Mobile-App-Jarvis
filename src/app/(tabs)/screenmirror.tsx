import { useAuthStore } from '@/store/useauthstore'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  updateDoc,
} from 'firebase/firestore'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  ActivityIndicator,
  GestureResponderEvent,
  LayoutChangeEvent,
  NativeTouchEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import {
  MediaStream,
  MediaStreamTrack,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  RTCView,
} from 'react-native-webrtc'
import { db } from '../../../lib/firebase'
import TouchpadScreen from './touchpad'

type PeerConnectionEvents = {
  addEventListener(type: 'track', listener: (event: { streams: MediaStream[]; track: MediaStreamTrack | null }) => void): void
  addEventListener(type: 'connectionstatechange', listener: () => void): void
  addEventListener(type: 'icecandidate', listener: (event: { candidate: RTCIceCandidate | null }) => void): void
}

type IncomingVideoReport = {
  type?: string
  kind?: string
  mediaType?: string
  bytesReceived?: number
  framesReceived?: number
  framesDecoded?: number
}

type IncomingVideoStats = {
  framesReceived: number
  framesDecoded: number
  bytesReceived: number
}

type IceConnectionStat = {
  type?: string
  state?: string
  nominated?: boolean
  selected?: boolean
  localCandidateId?: string
  remoteCandidateId?: string
  selectedCandidatePairId?: string
  candidateType?: string
  protocol?: string
}

type ConnectionType = 'local' | 'cloud'
type IceServerConfig = {
  urls: string | string[]
  username?: string
  credential?: string
  credentialType?: 'password' | 'oauth'
}

type ScreenPoint = { x: number; y: number }
type ScreenGesture = {
  start: ScreenPoint
  last: ScreenPoint
  lastMoveAt: number
  touchCount: number
  mode: 'scroll' | 'select'
  lastScrollY: number | null
  dragging: boolean
  scrolling: boolean
  longPressed: boolean
}

const SCREEN_GESTURE_THRESHOLD = 12
const LONG_PRESS_DURATION_MS = 550
const DOUBLE_TAP_WINDOW_MS = 300
const MOVE_SEND_INTERVAL_MS = 70
const SCROLL_SENSITIVITY = 3

async function getIceDiagnostics(peerConnection: RTCPeerConnection) {
  const stats = await peerConnection.getStats() as Map<string, IceConnectionStat>
  const statsById = new Map<string, IceConnectionStat>()
  stats.forEach((stat, id) => statsById.set(id, stat))

  const candidates = Array.from(stats.values()).filter(
    (stat) => stat.type === 'local-candidate' || stat.type === 'remote-candidate',
  )
  const countCandidates = (type: string) => candidates.filter((candidate) =>
    candidate.type === type && candidate.candidateType,
  ).reduce<Record<string, number>>((counts, candidate) => {
    const candidateType = candidate.candidateType ?? 'unknown'
    counts[candidateType] = (counts[candidateType] ?? 0) + 1
    return counts
  }, {})
  const formatCounts = (counts: Record<string, number>) =>
    Object.entries(counts).map(([type, count]) => `${type}:${count}`).join(',') || 'none'

  const selectedPairId = Array.from(stats.values()).find(
    (stat) => stat.type === 'transport' && stat.selectedCandidatePairId,
  )?.selectedCandidatePairId
  const pair = selectedPairId
    ? statsById.get(selectedPairId)
    : Array.from(stats.values()).find(
      (stat) => stat.type === 'candidate-pair' && (stat.selected || (stat.nominated && stat.state === 'succeeded')),
    )
  const localCandidate = pair?.localCandidateId ? statsById.get(pair.localCandidateId) : undefined
  const remoteCandidate = pair?.remoteCandidateId ? statsById.get(pair.remoteCandidateId) : undefined
  const pairSummary = pair
    ? `${pair.state ?? 'unknown'} ${localCandidate?.candidateType ?? '?'}-${remoteCandidate?.candidateType ?? '?'} ${pair.protocol ?? ''}`.trim()
    : 'none'

  return `ICE diagnostics: gathering=${peerConnection.iceGatheringState}; candidates local[${formatCounts(countCandidates('local-candidate'))}] remote[${formatCounts(countCandidates('remote-candidate'))}]; selected-pair=${pairSummary}`
}

function getConnectionType(stats: Map<string, IceConnectionStat>): ConnectionType | null {
  const statsById = new Map<string, IceConnectionStat>()
  stats.forEach((stat, id) => statsById.set(id, stat))

  const selectedPairId = Array.from(stats.values()).find(
    (stat) => stat.type === 'transport' && stat.selectedCandidatePairId,
  )?.selectedCandidatePairId
  const selectedPair = selectedPairId
    ? statsById.get(selectedPairId)
    : Array.from(stats.values()).find(
      (stat) =>
        stat.type === 'candidate-pair'
        && (stat.selected || (stat.nominated && stat.state === 'succeeded')),
    )

  if (!selectedPair?.localCandidateId || !selectedPair.remoteCandidateId) return null

  const localCandidate = statsById.get(selectedPair.localCandidateId)
  const remoteCandidate = statsById.get(selectedPair.remoteCandidateId)
  if (!localCandidate?.candidateType || !remoteCandidate?.candidateType) return null

  return localCandidate.candidateType === 'host' && remoteCandidate.candidateType === 'host'
    ? 'local'
    : 'cloud'
}

async function getIceServers(): Promise<RTCIceServer[]> {
  const meteredAppName = process.env.EXPO_PUBLIC_METERED_APP_NAME?.trim()
  const meteredApiKey = process.env.EXPO_PUBLIC_METERED_TURN_API_KEY?.trim()
  if (meteredAppName || meteredApiKey) {
    if (!meteredAppName || !meteredApiKey) {
      throw new Error('Metered TURN requires both EXPO_PUBLIC_METERED_APP_NAME and EXPO_PUBLIC_METERED_TURN_API_KEY.')
    }

    const response = await fetch(
      `https://${meteredAppName}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(meteredApiKey)}`,
    )
    if (!response.ok) {
      throw new Error(`Metered TURN credentials could not be fetched (HTTP ${response.status}).`)
    }

    const result: unknown = await response.json()
    if (!Array.isArray(result)) {
      throw new Error('Metered TURN returned an invalid ICE server list.')
    }
    const iceServers = result.filter((server): server is IceServerConfig =>
      typeof server === 'object'
      && server !== null
      && (typeof server.urls === 'string'
        || (Array.isArray(server.urls) && server.urls.every((url: unknown) => typeof url === 'string'))),
    )
    if (!iceServers.some((server) =>
      (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url: string) => url.startsWith('turn:') || url.startsWith('turns:')),
    )) {
      throw new Error('Metered TURN returned no relay servers.')
    }
    return iceServers
  }

  const turnUrls = process.env.EXPO_PUBLIC_TURN_URLS?.split(',').map((url: string) => url.trim()).filter(Boolean) ?? []
  const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

  if (turnUrls.length > 0) {
    const username = process.env.EXPO_PUBLIC_TURN_USERNAME
    const credential = process.env.EXPO_PUBLIC_TURN_CREDENTIAL
    if (!username || !credential) {
      throw new Error('TURN server URLs are set, but TURN username or credential is missing.')
    }
    iceServers.push({ urls: turnUrls, username, credential })
  }

  return iceServers
}

async function deleteSignalSession(session: ReturnType<typeof doc>) {
  const [mobileCandidates, desktopCandidates] = await Promise.all([
    getDocs(collection(session, 'mobileCandidates')),
    getDocs(collection(session, 'desktopCandidates')),
  ])
  await Promise.all([
    ...mobileCandidates.docs.map((candidate) => deleteDoc(candidate.ref)),
    ...desktopCandidates.docs.map((candidate) => deleteDoc(candidate.ref)),
  ])
  await deleteDoc(session)
}

async function stopSignalSession(session: ReturnType<typeof doc>) {
  await updateDoc(session, { status: 'stopped' })
  await deleteSignalSession(session)
}

export default function ScreenMirrorScreen({ interactive = false }: { interactive?: boolean } = {}) {
  const user = useAuthStore((s) => s.user)
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'failed'>('idle')
  const [desktopStatus, setDesktopStatus] = useState<{
    userId: string | null
    online: boolean
    localIps: string[]
    localControlToken: string | null
  }>({
    userId: null,
    online: false,
    localIps: [],
    localControlToken: null,
  })
  const [isLocalControl, setIsLocalControl] = useState(false)
  const [desktopStatusError, setDesktopStatusError] = useState<string | null>(null)
  const [streamURL, setStreamURL] = useState<string | null>(null)
  const [videoDimensions, setVideoDimensions] = useState<string | null>(null)
  const [incomingVideoStats, setIncomingVideoStats] = useState<IncomingVideoStats | null>(null)
  const [connectionType, setConnectionType] = useState<ConnectionType | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [touchMessage, setTouchMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [gestureMode, setGestureMode] = useState<'scroll' | 'select'>('scroll')
  const [gestureHint, setGestureHint] = useState('Tap: click · Double tap: double-click · Hold: right-click · One finger: scroll')

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionRef = useRef<ReturnType<typeof doc> | null>(null)
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([])
  const receivedCandidateKeysRef = useRef<Set<string>>(new Set())
  const unsubscribeSessionRef = useRef<(() => void) | null>(null)
  const unsubscribeDesktopCandidatesRef = useRef<(() => void) | null>(null)
  const requestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const videoContainerSizeRef = useRef({ width: 0, height: 0 })
  const commandSocketRef = useRef<WebSocket | null>(null)
  const localIpsRef = useRef<{ userId: string; ips: string[]; token: string | null } | null>(null)
  const gestureRef = useRef<ScreenGesture | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const singleTapPointRef = useRef<ScreenPoint | null>(null)
  const commandQueueRef = useRef<Promise<void>>(Promise.resolve())
  const desktopOnline = desktopStatus.userId === user?.uid && desktopStatus.online
  const localIpsKey = desktopStatus.userId === user?.uid ? desktopStatus.localIps.join(',') : ''
  const localControlToken = desktopStatus.userId === user?.uid ? desktopStatus.localControlToken : null
  const directControlConnected = isLocalControl && localIpsKey.length > 0

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
        const localControlToken = typeof data?.localControlToken === 'string'
          ? data.localControlToken
          : null
        if (
          localIpsRef.current?.userId !== user.uid
          || localIpsRef.current.ips.join(',') !== localIps.join(',')
          || localIpsRef.current.token !== localControlToken
        ) {
          setIsLocalControl(false)
        }
        localIpsRef.current = { userId: user.uid, ips: localIps, token: localControlToken }
        setDesktopStatus({ userId: user.uid, online, localIps, localControlToken })
        setDesktopStatusError(null)
      },
      (error) => {
        console.error('[ScreenMirror] Could not check desktop availability:', error)
        localIpsRef.current = { userId: user.uid, ips: [], token: null }
        setIsLocalControl(false)
        setDesktopStatus({ userId: user.uid, online: false, localIps: [], localControlToken: null })
        setDesktopStatusError('Could not check whether the desktop is online.')
      },
    )
  }, [user?.uid])

  useEffect(() => {
    if (!interactive || !user?.uid || localIpsKey.length === 0 || !localControlToken) {
      return
    }

    const localIps = localIpsKey.split(',')
    let cancelled = false
    let currentSocket: WebSocket | null = null
    let connectionTimeout: ReturnType<typeof setTimeout> | null = null

    const tryAddress = (index: number) => {
      if (cancelled) return
      if (index >= localIps.length) {
        setIsLocalControl(false)
        commandSocketRef.current = null
        return
      }

      const socket = new WebSocket(`ws://${localIps[index]}:8080`)
      currentSocket = socket
      commandSocketRef.current = socket
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
        socket.send(JSON.stringify({ type: 'authenticate', token: localControlToken }))
      }
      socket.onmessage = (event) => {
        let response: unknown
        try {
          response = JSON.parse(String(event.data))
        } catch {
          return
        }
        if (
          typeof response !== 'object'
          || response === null
          || !('type' in response)
          || response.type !== 'authenticated'
          || settled
          || cancelled
        ) return
        settled = true
        if (connectionTimeout) clearTimeout(connectionTimeout)
        setIsLocalControl(true)
      }
      socket.onerror = tryNextAddress
      socket.onclose = () => {
        if (settled) setIsLocalControl(false)
      }
    }

    tryAddress(0)

    return () => {
      cancelled = true
      if (connectionTimeout) clearTimeout(connectionTimeout)
      if (currentSocket) {
        currentSocket.onopen = null
        currentSocket.onerror = null
        currentSocket.close()
        if (commandSocketRef.current === currentSocket) commandSocketRef.current = null
      }
    }
  }, [interactive, localControlToken, localIpsKey, user?.uid])

  const closeConnection = useCallback(() => {
    if (requestTimeoutRef.current) clearTimeout(requestTimeoutRef.current)
    requestTimeoutRef.current = null
    if (statsIntervalRef.current) clearInterval(statsIntervalRef.current)
    statsIntervalRef.current = null
    unsubscribeSessionRef.current?.()
    unsubscribeSessionRef.current = null
    unsubscribeDesktopCandidatesRef.current?.()
    unsubscribeDesktopCandidatesRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    sessionRef.current = null
    pendingCandidatesRef.current = []
    receivedCandidateKeysRef.current.clear()
  }, [])

  const failConnection = (message: string) => {
    console.error(`[ScreenMirror] ${message}`)
    const session = sessionRef.current
    closeConnection()
    if (session) {
      void updateDoc(session, { status: 'failed', error: message })
        .then(() => deleteSignalSession(session))
        .catch((error: unknown) => {
          console.error('[ScreenMirror] Could not notify the desktop about the failure:', error)
        })
    }
    setStreamURL(null)
    setVideoDimensions(null)
    setErrorMessage(message)
    setIncomingVideoStats(null)
    setConnectionType(null)
    setStatsError(null)
    setStatus('failed')
  }

  const startMirroring = async () => {
    if (pcRef.current) return
    if (!user?.uid) {
      setErrorMessage('Sign in on your phone and desktop with the same account to start screen mirroring.')
      setStatus('failed')
      return
    }
    if (!desktopOnline) {
      setErrorMessage('Desktop is offline. Screen-sharing requests are not queued.')
      return
    }

    setStatus('connecting')
    setErrorMessage(null)
    setStreamURL(null)
    setVideoDimensions(null)
    setIncomingVideoStats(null)
    setConnectionType(null)
    setStatsError(null)
    pendingCandidatesRef.current = []
    let startingPeerConnection: RTCPeerConnection | null = null

    try {
      const peerConnection = new RTCPeerConnection({ iceServers: await getIceServers() })
      startingPeerConnection = peerConnection
      pcRef.current = peerConnection
      const pcEvents = peerConnection as RTCPeerConnection & PeerConnectionEvents
      peerConnection.addTransceiver('video', { direction: 'recvonly' })
      let statsCheckInProgress = false
      statsIntervalRef.current = setInterval(async () => {
        if (pcRef.current !== peerConnection || statsCheckInProgress) return
        const videoReceivers = peerConnection.getReceivers().filter((receiver) => receiver.track?.kind === 'video')

        statsCheckInProgress = true
        try {
          if (videoReceivers.length > 0) {
            const reports = await Promise.all(
              videoReceivers.map((receiver) => receiver.getStats() as Promise<Map<string, IncomingVideoReport>>),
            )
            if (pcRef.current !== peerConnection) return

            const totals = { framesReceived: 0, framesDecoded: 0, bytesReceived: 0 }
            reports.forEach((report) => {
              report.forEach((stat) => {
                if (stat.type !== 'inbound-rtp' || (stat.kind !== 'video' && stat.mediaType !== 'video')) return
                totals.framesReceived += stat.framesReceived ?? stat.framesDecoded ?? 0
                totals.framesDecoded += stat.framesDecoded ?? 0
                totals.bytesReceived += stat.bytesReceived ?? 0
              })
            })
            setIncomingVideoStats(totals)
            setStatsError(null)
          }

          try {
            const connectionStats = await peerConnection.getStats() as Map<string, IceConnectionStat>
            if (pcRef.current !== peerConnection) return
            const type = getConnectionType(connectionStats)
            if (type) setConnectionType(type)
          } catch (error) {
            if (pcRef.current !== peerConnection) return
            console.error('[ScreenMirror] Could not determine the WebRTC network route:', error)
            setStatsError('Could not determine the network connection type.')
          }
        } catch (error) {
          if (pcRef.current !== peerConnection) return
          console.error('[ScreenMirror] Could not read incoming video frame stats:', error)
          setStatsError('Could not read incoming video frame stats.')
        } finally {
          statsCheckInProgress = false
        }
      }, 1000)

      const session = await addDoc(collection(db, 'screen_mirror_sessions'), {
        userId: user.uid,
        status: 'starting',
        createdAt: Date.now(),
      })
      if (pcRef.current !== peerConnection) {
        await stopSignalSession(session)
        return
      }
      sessionRef.current = session
      unsubscribeDesktopCandidatesRef.current = onSnapshot(
        collection(session, 'desktopCandidates'),
        (snapshot) => {
          if (pcRef.current !== peerConnection) return
          snapshot.docChanges().forEach((change) => {
            if (change.type !== 'added') return
            const candidate = change.doc.data() as RTCIceCandidateInit
            const candidateKey = JSON.stringify(candidate)
            if (receivedCandidateKeysRef.current.has(candidateKey)) return
            receivedCandidateKeysRef.current.add(candidateKey)
            if (!peerConnection.remoteDescription) {
              pendingCandidatesRef.current.push(candidate)
              return
            }
            void peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch((error: unknown) => {
              failConnection(`Could not apply a desktop network candidate: ${String(error)}`)
            })
          })
        },
        (error) => failConnection(`Could not receive desktop network candidates: ${error.message}`),
      )

      pcEvents.addEventListener('track', (event) => {
        if (pcRef.current !== peerConnection) return
        const stream = event.streams.find((remoteStream) => remoteStream.getVideoTracks().length > 0)
          ?? (event.track?.kind === 'video' ? new MediaStream([event.track]) : null)
        if (stream) {
          console.log(
            '[ScreenMirror] Received remote video track:',
            stream.getVideoTracks().map((track) => ({ id: track.id, state: track.readyState, enabled: track.enabled })),
          )
          setStreamURL(stream.toURL())
        } else {
          console.error('[ScreenMirror] Received a track event without a video stream or video track.')
        }
      })

      pcEvents.addEventListener('connectionstatechange', () => {
        if (pcRef.current !== peerConnection) return
        if (peerConnection.connectionState === 'connected') {
          setErrorMessage(null)
          setStatus('connected')
        } else if (peerConnection.connectionState === 'failed') {
          const iceState = peerConnection.iceConnectionState
          const message = `The video connection failed (ICE: ${iceState}; peer: ${peerConnection.connectionState}). `
            + 'Wi-Fi hotspots can NAT or isolate the phone and connected laptop, so sharing the same hotspot does not guarantee a direct video route. Configure TURN in both apps for hotspot networks; for router Wi-Fi, also allow Jarvis through Windows Firewall.'
          void getIceDiagnostics(peerConnection)
            .then((diagnostics) => failConnection(`${message} ${diagnostics}`))
            .catch((error: unknown) => {
              console.error('[ScreenMirror] Could not collect ICE diagnostics:', error)
              failConnection(message)
            })
        } else if (peerConnection.connectionState === 'disconnected') {
          setConnectionType(null)
          setStatus('connecting')
        }
      })

      pcEvents.addEventListener('icecandidate', (event) => {
        if (pcRef.current !== peerConnection || !event.candidate || !sessionRef.current) return
        void addDoc(collection(session, 'mobileCandidates'), event.candidate.toJSON()).catch((error: unknown) => {
          failConnection(`Could not signal a mobile network candidate: ${String(error)}`)
        })
      })

      let applyingAnswer = false
      unsubscribeSessionRef.current = onSnapshot(
        session,
        async (snapshot) => {
          if (!snapshot.exists() || pcRef.current !== peerConnection) return
          const data = snapshot.data()
          if (data.status === 'failed') {
            failConnection(data.error || 'The desktop could not start screen sharing.')
            return
          }
          if (data.status === 'stopped') {
            const session = sessionRef.current
            closeConnection()
            setStreamURL(null)
            setVideoDimensions(null)
            setIncomingVideoStats(null)
            setConnectionType(null)
            setStatsError(null)
            setStatus('idle')
            if (session) {
              void deleteSignalSession(session).catch((error: unknown) => {
                console.error('[ScreenMirror] Could not clean up the stopped session:', error)
              })
            }
            return
          }
          if (!data.answer || peerConnection.remoteDescription || applyingAnswer) return
          applyingAnswer = true
          try {
            if (requestTimeoutRef.current) clearTimeout(requestTimeoutRef.current)
            requestTimeoutRef.current = null
            if (peerConnection.signalingState !== 'have-local-offer') {
              throw new Error(`Unexpected signaling state before applying answer: ${peerConnection.signalingState}`)
            }
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer))
            for (const candidate of pendingCandidatesRef.current) {
              await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
            }
            pendingCandidatesRef.current = []
          } catch (error) {
            failConnection(`Could not apply the desktop's WebRTC answer: ${String(error)}`)
          }
        },
        (error) => failConnection(`Firebase signaling failed: ${error.message}`),
      )

      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)
      if (pcRef.current !== peerConnection) return
      requestTimeoutRef.current = setTimeout(() => {
        failConnection('No desktop answered the request. Keep Jarvis open on the desktop and signed in to the same account.')
      }, 90_000)
      await updateDoc(session, {
        offer: peerConnection.localDescription?.toJSON(),
        status: 'waiting',
      })
      if (pcRef.current !== peerConnection) {
        await stopSignalSession(session)
        return
      }
    } catch (error) {
      if (startingPeerConnection && pcRef.current !== startingPeerConnection) return
      console.error('[ScreenMirror] Could not connect to desktop:', error)
      failConnection(`Could not start screen mirroring: ${String(error)}`)
    }
  }

  const stopMirroring = () => {
    const session = sessionRef.current
    closeConnection()
    if (session) {
      void (async () => {
        try {
          await updateDoc(session, { status: 'stopped' })
          await deleteSignalSession(session)
        } catch (error) {
          console.error('[ScreenMirror] Could not clean up the signaling session:', error)
          setErrorMessage('Mirroring stopped, but the Firebase session could not be cleaned up.')
        }
      })()
    }
    setStreamURL(null)
    setVideoDimensions(null)
    setIncomingVideoStats(null)
    setConnectionType(null)
    setStatsError(null)
    setStatus('idle')
  }

  const getScreenPoint = (locationX: number, locationY: number): ScreenPoint | null => {
    const dimensions = videoDimensions?.split(' × ').map(Number) ?? []
    const [videoWidth, videoHeight] = dimensions
    const { width: containerWidth, height: containerHeight } = videoContainerSizeRef.current
    if (
      !videoWidth || !videoHeight || !containerWidth || !containerHeight
      || !Number.isFinite(videoWidth) || !Number.isFinite(videoHeight)
    ) {
      return null
    }

    const aspectRatio = videoWidth / videoHeight
    let renderedWidth = containerWidth
    let renderedHeight = containerHeight
    if (containerWidth / containerHeight > aspectRatio) {
      renderedWidth = containerHeight * aspectRatio
    } else {
      renderedHeight = containerWidth / aspectRatio
    }

    const offsetX = (containerWidth - renderedWidth) / 2
    const offsetY = (containerHeight - renderedHeight) / 2
    const x = (locationX - offsetX) / renderedWidth
    const y = (locationY - offsetY) / renderedHeight
    if (x < 0 || x > 1 || y < 0 || y > 1) return null
    return { x, y }
  }

  const sendScreenControl = useCallback((
    action: string,
    point: ScreenPoint,
    dy?: number,
  ): Promise<boolean> => {
    const userId = user?.uid
    if (!userId || !desktopOnline) {
      setTouchMessage({ text: 'Desktop is offline. The gesture was not sent.', error: true })
      return Promise.resolve(false)
    }

    const command = {
      type: 'screen_control',
      action,
      x: point.x,
      y: point.y,
      ...(dy === undefined ? {} : { dy }),
    }

    if (commandSocketRef.current?.readyState === WebSocket.OPEN) {
      try {
        commandSocketRef.current.send(JSON.stringify(command))
        return Promise.resolve(true)
      } catch (error) {
        console.error('[RemoteScreenControl] Could not send a direct screen gesture:', error)
        setTouchMessage({ text: 'Gesture could not be sent to the desktop.', error: true })
        return Promise.resolve(false)
      }
    }

    const queuedCommand = commandQueueRef.current.then(async () => {
      await addDoc(collection(db, 'commands'), {
        userId,
        ...command,
        processed: false,
        timestamp: Date.now(),
      })
    })
    commandQueueRef.current = queuedCommand.then(() => undefined, () => undefined)
    return queuedCommand.then(() => true).catch((error: unknown) => {
      console.error('[RemoteScreenControl] Could not queue a screen gesture:', error)
      setTouchMessage({ text: 'Gesture could not be sent. Check the connection and try again.', error: true })
      return false
    })
  }, [desktopOnline, user])

  const sendGestureWithFeedback = useCallback((
    action: string,
    point: ScreenPoint,
    message: string,
    dy?: number,
  ) => {
    void sendScreenControl(action, point, dy).then((sent) => {
      if (sent) setTouchMessage({ text: message, error: false })
    })
  }, [sendScreenControl])

  const getAverageTouchY = (touches: NativeTouchEvent[]) => {
    if (touches.length === 0) return null
    return touches.reduce((sum, touch) => sum + touch.pageY, 0) / touches.length
  }

  const handleScreenTouchStart = (event: GestureResponderEvent) => {
    if (!interactive || status !== 'connected' || !streamURL) return
    const point = getScreenPoint(event.nativeEvent.locationX, event.nativeEvent.locationY)
    if (!point) {
      setTouchMessage({ text: 'Waiting for the desktop screen dimensions.', error: true })
      return
    }

    const touchCount = Math.max(1, event.nativeEvent.touches.length)
    const gesture: ScreenGesture = {
      start: point,
      last: point,
      lastMoveAt: 0,
      touchCount,
      mode: gestureMode,
      lastScrollY: touchCount > 1 ? getAverageTouchY(event.nativeEvent.touches) : null,
      dragging: false,
      scrolling: false,
      longPressed: false,
    }
    gestureRef.current = gesture
    setTouchMessage(null)
    if (touchCount > 1) setGestureHint('Two-finger scroll')
    else if (gestureMode === 'scroll') setGestureHint('One finger: scroll · Tap: click · Double tap: double-click · Hold: right-click')
    else setGestureHint('Drag: select text · Double tap: select a word · Hold: right-click')

    if (touchCount === 1) {
      gesture.lastScrollY = event.nativeEvent.pageY
      longPressTimerRef.current = setTimeout(() => {
        if (gestureRef.current !== gesture || gesture.dragging) return
        gesture.longPressed = true
        setGestureHint('Long press: right-click sent')
        sendGestureWithFeedback('right_click', gesture.start, 'Right-click sent to desktop.')
      }, LONG_PRESS_DURATION_MS)
    }
  }

  const handleScreenTouchMove = (event: GestureResponderEvent) => {
    const gesture = gestureRef.current
    if (!gesture) return

    const touches = event.nativeEvent.touches
    if (touches.length > 1 || (gesture.mode === 'scroll' && gesture.touchCount === 1)) {
      if (touches.length > 1) {
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
        gesture.touchCount = touches.length
        gesture.lastScrollY ??= getAverageTouchY(touches)
      }

      const currentY = touches.length > 1
        ? getAverageTouchY(touches)
        : event.nativeEvent.pageY
      if (currentY === null || gesture.lastScrollY === null) return

      const point = getScreenPoint(event.nativeEvent.locationX, event.nativeEvent.locationY)
      if (!point) return
      const movementDistance = Math.hypot(
        (point.x - gesture.start.x) * videoContainerSizeRef.current.width,
        (point.y - gesture.start.y) * videoContainerSizeRef.current.height,
      )
      if (movementDistance >= SCREEN_GESTURE_THRESHOLD) {
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
        if (gesture.mode === 'scroll' || touches.length > 1) gesture.scrolling = true
      }

      const deltaY = currentY - gesture.lastScrollY
      gesture.lastScrollY = currentY
      if (
        movementDistance < SCREEN_GESTURE_THRESHOLD
        || Math.abs(deltaY) < 2
        || Date.now() - gesture.lastMoveAt < MOVE_SEND_INTERVAL_MS
      ) return
      gesture.scrolling = true
      gesture.lastMoveAt = Date.now()
      void sendScreenControl('scroll', point, Math.max(-1200, Math.min(1200, Math.round(-deltaY * SCROLL_SENSITIVITY))))
      return
    }

    if (gesture.touchCount > 1 || gesture.longPressed) return
    const point = getScreenPoint(event.nativeEvent.locationX, event.nativeEvent.locationY)
    if (!point) return

    const distance = Math.hypot(
      (point.x - gesture.start.x) * videoContainerSizeRef.current.width,
      (point.y - gesture.start.y) * videoContainerSizeRef.current.height,
    )
    if (!gesture.dragging && distance >= SCREEN_GESTURE_THRESHOLD) {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
      gesture.dragging = true
      setGestureHint('Dragging to select text')
      void sendScreenControl('mouse_down', gesture.start)
    }

    if (gesture.dragging && Date.now() - gesture.lastMoveAt >= MOVE_SEND_INTERVAL_MS) {
      gesture.lastMoveAt = Date.now()
      gesture.last = point
      void sendScreenControl('move', point)
    }
  }

  const finishScreenGesture = (event: GestureResponderEvent, cancelled = false) => {
    const gesture = gestureRef.current
    if (!gesture) return
    gestureRef.current = null
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = null

    if (gesture.dragging) {
      const point = getScreenPoint(event.nativeEvent.locationX, event.nativeEvent.locationY) ?? gesture.last
      void sendScreenControl('mouse_up', point)
      setGestureHint('Text selection released')
      return
    }
    if (cancelled || gesture.longPressed || gesture.scrolling || gesture.touchCount > 1) return

    const point = getScreenPoint(event.nativeEvent.locationX, event.nativeEvent.locationY) ?? gesture.start
    const previousTap = singleTapPointRef.current
    if (singleTapTimerRef.current && previousTap) {
      const tapDistance = Math.hypot(
        (point.x - previousTap.x) * videoContainerSizeRef.current.width,
        (point.y - previousTap.y) * videoContainerSizeRef.current.height,
      )
      if (tapDistance <= 36) {
        clearTimeout(singleTapTimerRef.current)
        singleTapTimerRef.current = null
        singleTapPointRef.current = null
        setGestureHint('Double-click sent')
        sendGestureWithFeedback('double_click', point, 'Double-click sent to desktop.')
        return
      }

      clearTimeout(singleTapTimerRef.current)
      singleTapTimerRef.current = null
      singleTapPointRef.current = null
      sendGestureWithFeedback('click', previousTap, 'Click sent to desktop.')
    }

    singleTapPointRef.current = point
    singleTapTimerRef.current = setTimeout(() => {
      singleTapTimerRef.current = null
      singleTapPointRef.current = null
      setGestureHint('Click sent')
      sendGestureWithFeedback('click', point, 'Click sent to desktop.')
    }, DOUBLE_TAP_WINDOW_MS)
  }

  const handleVideoLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    videoContainerSizeRef.current = { width, height }
  }

  useFocusEffect(
    useCallback(() => () => {
      const gesture = gestureRef.current
      if (gesture?.dragging) void sendScreenControl('mouse_up', gesture.last)
      gestureRef.current = null
      if (singleTapTimerRef.current && singleTapPointRef.current) {
        sendGestureWithFeedback('click', singleTapPointRef.current, 'Click sent to desktop.')
      }
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current)
      longPressTimerRef.current = null
      singleTapTimerRef.current = null
      singleTapPointRef.current = null

      const session = sessionRef.current
      closeConnection()
      setStreamURL(null)
      setVideoDimensions(null)
      setIncomingVideoStats(null)
      setConnectionType(null)
      setStatsError(null)
      setTouchMessage(null)
      setStatus('idle')
      if (session) {
        void stopSignalSession(session).catch((error: unknown) => {
          console.error('[ScreenMirror] Could not stop the Firebase session during cleanup:', error)
        })
      }
    }, [closeConnection, sendGestureWithFeedback, sendScreenControl]),
  )

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{interactive ? 'Touchscreen Control' : 'Screen Mirroring'}</Text>
      <Text style={styles.status}>
        Status: {status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting...' : status === 'failed' ? 'Failed' : 'Idle'}
      </Text>
      {desktopStatusError ? <Text style={styles.error}>{desktopStatusError}</Text> : null}
      {!desktopStatusError && !desktopOnline && status === 'idle' ? (
        <Text style={styles.hint}>Desktop offline — screen-sharing requests are not queued.</Text>
      ) : null}
      {status === 'connected' ? (
        <Text style={styles.connectionType}>
          {connectionType === 'local'
            ? 'Local connection'
            : connectionType === 'cloud'
              ? 'Cloud connection'
              : 'Checking connection type...'}
        </Text>
      ) : null}
      {interactive && status === 'connected' ? (
        <Text style={directControlConnected ? styles.touchSuccess : styles.hint}>
          {directControlConnected ? 'Direct desktop control connected' : 'Direct control unavailable; gestures use the cloud queue'}
        </Text>
      ) : null}
      {status === 'connected' && incomingVideoStats ? (
        <Text style={styles.frameStats}>
          {incomingVideoStats.framesReceived > 0
            ? `Receiving: ${incomingVideoStats.framesReceived} frames${incomingVideoStats.framesDecoded > 0 ? ` (${incomingVideoStats.framesDecoded} decoded)` : ''} · ${
              incomingVideoStats.bytesReceived < 1024 * 1024
                ? `${(incomingVideoStats.bytesReceived / 1024).toFixed(0)} KB`
                : `${(incomingVideoStats.bytesReceived / (1024 * 1024)).toFixed(1)} MB`
            } received`
            : 'Connected, but no video frames received yet'}
        </Text>
      ) : null}
      {statsError ? <Text style={styles.error}>{statsError}</Text> : null}
      {status === 'connected' && !videoDimensions ? (
        <Text style={styles.hint}>Connection is live; waiting for the phone to render the first video frame.</Text>
      ) : null}
      {videoDimensions ? <Text style={styles.hint}>Live video: {videoDimensions}</Text> : null}
      {interactive ? <Text style={styles.hint}>{gestureHint}</Text> : null}
      <Text style={styles.hint}>Keep Jarvis open on your desktop and sign in with the same account.</Text>

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      {touchMessage ? (
        <Text style={touchMessage.error ? styles.error : styles.touchSuccess}>{touchMessage.text}</Text>
      ) : null}
      {interactive ? (
        <View style={styles.gestureModes}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ selected: gestureMode === 'scroll' }}
            style={[styles.gestureModeButton, gestureMode === 'scroll' && styles.gestureModeButtonActive]}
            onPress={() => {
              setGestureMode('scroll')
              setGestureHint('One finger: scroll · Tap: click · Double tap: double-click · Hold: right-click')
            }}
          >
            <Text style={styles.btnText}>Scroll</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ selected: gestureMode === 'select' }}
            style={[styles.gestureModeButton, gestureMode === 'select' && styles.gestureModeButtonActive]}
            onPress={() => {
              setGestureMode('select')
              setGestureHint('Drag: select text · Double tap: select a word · Hold: right-click')
            }}
          >
            <Text style={styles.btnText}>Select text</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {streamURL ? (
        <View style={styles.videoContainer} onLayout={handleVideoLayout}>
          <RTCView
            streamURL={streamURL}
            style={styles.video}
            objectFit="contain"
            zOrder={0}
            onDimensionsChange={({ nativeEvent }) => {
              setVideoDimensions(`${nativeEvent.width} × ${nativeEvent.height}`)
            }}
          />
          {interactive && status === 'connected' ? (
            <View
              style={styles.touchSurface}
              accessibilityRole="button"
              accessibilityLabel="Control the desktop screen with taps, double taps, long press, drag selection, and two-finger scrolling"
              onStartShouldSetResponder={() => interactive && status === 'connected'}
              onMoveShouldSetResponder={() => interactive && status === 'connected'}
              onResponderTerminationRequest={() => false}
              onResponderGrant={handleScreenTouchStart}
              onResponderMove={handleScreenTouchMove}
              onResponderRelease={(event) => finishScreenGesture(event)}
              onResponderTerminate={(event) => finishScreenGesture(event, true)}
            />
          ) : null}
        </View>
      ) : (
        <View style={styles.placeholder}>
          {status === 'connecting'
            ? <ActivityIndicator size="large" color="#4a90d9" />
            : <Text style={styles.placeholderText}>Tap Start to request your desktop screen</Text>}
        </View>
      )}

      <View style={styles.controls}>
        {status === 'connecting' || status === 'connected' ? (
          <TouchableOpacity style={styles.stopBtn} onPress={stopMirroring}>
            <Text style={styles.btnText}>Stop</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.startBtn} onPress={startMirroring}>
            <Text style={styles.btnText}>Start</Text>
          </TouchableOpacity>
        )}
      </View>
      {!interactive ? <TouchpadScreen embedded /> : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  content: { padding: 20, paddingBottom: 32 },
  title: { fontSize: 24, color: '#4a90d9', fontWeight: 'bold', marginTop: 20, marginBottom: 8, textAlign: 'center' },
  status: { color: '#fff', textAlign: 'center', marginBottom: 18, fontSize: 14 },
  connectionType: { color: '#58d68d', textAlign: 'center', marginTop: -12, marginBottom: 12, fontSize: 13, fontWeight: '600' },
  frameStats: { color: '#58d68d', textAlign: 'center', marginBottom: 12, fontSize: 13, fontWeight: '600' },
  hint: { color: '#aaa', fontSize: 12, textAlign: 'center', marginBottom: 12 },
  error: { color: '#ff8a80', fontSize: 13, marginBottom: 10 },
  touchSuccess: { color: '#58d68d', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  gestureModes: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  gestureModeButton: {
    flex: 1,
    backgroundColor: '#333',
    paddingVertical: 11,
    borderRadius: 9,
    alignItems: 'center',
  },
  gestureModeButtonActive: { backgroundColor: '#2768a8' },
  videoContainer: { height: 240, marginBottom: 15, backgroundColor: '#000', position: 'relative' },
  video: { flex: 1, width: '100%', height: '100%' },
  touchSurface: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 1 },
  placeholder: { height: 240, backgroundColor: '#1e1e1e', borderRadius: 10, marginBottom: 15, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#333', borderStyle: 'dashed' },
  placeholderText: { color: '#888', textAlign: 'center', paddingHorizontal: 20 },
  controls: { flexDirection: 'row', justifyContent: 'center' },
  startBtn: { backgroundColor: '#28a745', padding: 15, borderRadius: 10, paddingHorizontal: 30 },
  stopBtn: { backgroundColor: '#c62828', padding: 15, borderRadius: 10, paddingHorizontal: 30 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
})
