// src/app/(tabs)/chat.tsx
import { useAuthStore } from '@/store/useauthstore'
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition'
import * as Speech from 'expo-speech'
import { collection, doc, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { db } from '../../../lib/firebase'

const pendingVoiceReplyMessageIds = new Set<string>()
const spokenVoiceAcknowledgmentIds = new Set<string>()

export default function ChatScreen() {
  const [messages, setMessages] = useState<any[]>([])
  const [input, setInput] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [chatStatus, setChatStatus] = useState('')
  const user = useAuthStore((s) => s.user)
  const [laptopStatus, setLaptopStatus] = useState<'online' | 'offline'>('offline')

  const sendMessage = async (content = input, inputMode: 'text' | 'voice' = 'text') => {
    const text = content.trim()
    if (!text || !user?.uid) return

    const messageRef = doc(collection(db, 'messages'))
    if (inputMode === 'voice') pendingVoiceReplyMessageIds.add(messageRef.id)
    if (inputMode === 'text') setInput('')
    setChatStatus('')

    try {
      await setDoc(messageRef, {
        userId: user.uid,
        from: 'phone',
        role: 'user',
        content: text,
        timestamp: Date.now(),
        processed: false,
        inputMode,
      })
    } catch (error) {
      pendingVoiceReplyMessageIds.delete(messageRef.id)
      console.error('[Chat] Could not send message:', error)
      setChatStatus('Message could not be sent. Please try again.')
    }
  }

  useSpeechRecognitionEvent('start', () => {
    setIsListening(true)
    setChatStatus('Listening...')
  })

  useSpeechRecognitionEvent('end', () => {
    setIsListening(false)
  })

  useSpeechRecognitionEvent('result', (event) => {
    if (!event.isFinal) return
    const transcript = event.results[0]?.transcript.trim()
    if (!transcript) {
      setChatStatus('No speech was recognized. Please try again.')
      return
    }
    setChatStatus(`Heard: ${transcript}`)
    void sendMessage(transcript, 'voice')
  })

  useSpeechRecognitionEvent('error', (event) => {
    setIsListening(false)
    console.error('[Chat] Speech recognition failed:', event.error, event.message)
    setChatStatus(`Voice input failed: ${event.message}`)
  })

  const toggleVoiceInput = async () => {
    if (isListening) {
      ExpoSpeechRecognitionModule.stop()
      return
    }

    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
      if (!permission.granted) {
        setChatStatus('Microphone permission is required for voice chat.')
        return
      }

      setChatStatus('')
      ExpoSpeechRecognitionModule.start({
        continuous: false,
        interimResults: false,
      })
    } catch (error) {
      console.error('[Chat] Could not start speech recognition:', error)
      setChatStatus('Could not start voice input. Please try again.')
    }
  }

  useEffect(() => {
    if (!user?.uid) return
    const deviceRef = doc(db, 'devices', user.uid)
    const unsub = onSnapshot(deviceRef, (snapshot) => {
      if (snapshot.exists()) {
        setLaptopStatus(snapshot.data().status === 'online' ? 'online' : 'offline')
      }
    })
    return () => unsub()
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid) return
    const q = query(collection(db, 'messages'), where('userId', '==', user.uid))
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs: any[] = []
      snapshot.forEach((messageDoc) => msgs.push({ id: messageDoc.id, ...messageDoc.data() }))
      msgs.sort((a, b) => a.timestamp - b.timestamp)
      setMessages(msgs)

      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') return
        const message = change.doc.data()
        const replyTo = message.replyTo
        if (message.from !== 'desktop' || typeof replyTo !== 'string') return

        const reply = typeof message.content === 'string' ? message.content.trim() : ''
        if (message.kind === 'acknowledgment') {
          if (message.inputMode !== 'voice') return
          if (!pendingVoiceReplyMessageIds.has(replyTo) || spokenVoiceAcknowledgmentIds.has(change.doc.id)) {
            if (message.acknowledged !== true) {
              void updateDoc(change.doc.ref, { acknowledged: true }).catch((error) => {
                console.error('[Chat] Could not confirm stale acknowledgment:', error)
              })
            }
            return
          }
          if (!reply) {
            void updateDoc(change.doc.ref, { acknowledged: true }).catch((error) => {
              console.error('[Chat] Could not confirm acknowledgment:', error)
            })
            return
          }

          spokenVoiceAcknowledgmentIds.add(change.doc.id)
          let confirmed = false
          const confirmAcknowledgment = () => {
            if (confirmed) return
            confirmed = true
            void updateDoc(change.doc.ref, { acknowledged: true }).catch((error) => {
              console.error('[Chat] Could not confirm acknowledgment:', error)
            })
          }
          Speech.speak(reply, {
            onDone: confirmAcknowledgment,
            onStopped: confirmAcknowledgment,
            onError: (error) => {
              console.error('[Chat] Could not speak acknowledgment:', error)
              confirmAcknowledgment()
            },
          })
          return
        }

        if (pendingVoiceReplyMessageIds.delete(replyTo) && reply) {
          Speech.speak(reply, {
            onError: (error) => console.error('[Chat] Could not speak reply:', error),
          })
        }
      })
    })
    return () => unsubscribe()
  }, [user?.uid])

  useEffect(() => {
    for (const message of messages) {
      if (message.kind !== 'acknowledgment' || message.inputMode === 'voice' || message.acknowledged) continue
      void updateDoc(doc(db, 'messages', message.id), { acknowledged: true }).catch((error) => {
        console.error('[Chat] Could not confirm displayed acknowledgment:', error)
      })
    }
  }, [messages])

  useEffect(() => () => {
    ExpoSpeechRecognitionModule.abort()
    void Speech.stop()
  }, [])

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Text style={styles.headerText}>🤖 JARVIS Chat</Text>
        <Text style={{ color: laptopStatus === 'online' ? '#4caf50' : '#f44336', fontSize: 12 }}>
          {laptopStatus === 'online' ? '● Online' : '● Offline'}
        </Text>
      </View>
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={[styles.messageBubble, item.from === 'phone' ? styles.userBubble : styles.assistantBubble]}>
            <Text style={styles.messageText}>{item.content}</Text>
          </View>
        )}
      />
      <View style={styles.inputContainer}>
        <TextInput style={styles.input} value={input} onChangeText={setInput} placeholder="Message likhein..." placeholderTextColor="#888" />
        <TouchableOpacity onPress={() => void sendMessage()} style={styles.sendBtn}>
          <Text style={styles.sendBtnText}>Send</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => void toggleVoiceInput()} style={[styles.voiceBtn, isListening && styles.voiceBtnActive]}>
          <Text style={styles.sendBtnText}>{isListening ? 'Stop' : 'Voice'}</Text>
        </TouchableOpacity>
      </View>
      {chatStatus ? <Text style={styles.statusText}>{chatStatus}</Text> : null}
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  header: { padding: 15, borderBottomWidth: 1, borderBottomColor: '#333', backgroundColor: '#1a1a1a', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerText: { color: '#4a90d9', fontSize: 18, fontWeight: 'bold' },
  listContent: { padding: 15 },
  messageBubble: { padding: 12, borderRadius: 12, marginBottom: 10, maxWidth: '80%' },
  userBubble: { backgroundColor: '#4a90d9', alignSelf: 'flex-end', borderBottomRightRadius: 2 },
  assistantBubble: { backgroundColor: '#222', alignSelf: 'flex-start', borderBottomLeftRadius: 2 },
  messageText: { color: '#fff', fontSize: 15 },
  inputContainer: { flexDirection: 'row', padding: 10, borderTopWidth: 1, borderTopColor: '#333', backgroundColor: '#1a1a1a' },
  input: { flex: 1, backgroundColor: '#222', color: '#fff', borderRadius: 20, paddingHorizontal: 15, paddingVertical: 10, marginRight: 10 },
  sendBtn: { backgroundColor: '#4a90d9', borderRadius: 20, paddingHorizontal: 20, justifyContent: 'center' },
  voiceBtn: { backgroundColor: '#444', borderRadius: 20, paddingHorizontal: 16, justifyContent: 'center' },
  voiceBtnActive: { backgroundColor: '#d9534f' },
  statusText: { color: '#bbb', fontSize: 12, paddingHorizontal: 15, paddingBottom: 8 },
  sendBtnText: { color: '#fff', fontWeight: 'bold' }
})