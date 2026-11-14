import { useAuthStore } from '@/store/useauthstore'
import { GoogleSigninButton } from '@react-native-google-signin/google-signin'
import { useRouter } from 'expo-router'
import { Controller, useForm } from 'react-hook-form'
import { useState } from 'react'
import { Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'

type LoginValues = { email: string; password: string }

export default function LoginPage() {
  const { control, handleSubmit, formState: { errors } } = useForm<LoginValues>()
  const login = useAuthStore((s) => s.login)
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle)
  const router = useRouter()
  const [googleLoading, setGoogleLoading] = useState(false)

  // ✅ 1. Email/Password Login
  const onSubmit = async (data: LoginValues) => {
    try {
      await login(data.email, data.password)
      router.replace('/')
    } catch (error) {
      Alert.alert('Login Failed', error instanceof Error ? error.message : String(error))
    }
  }

  const onGoogleLogin = async () => {
    setGoogleLoading(true)
    try {
      const signedIn = await loginWithGoogle()
      if (signedIn) router.replace('/')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('DEVELOPER_ERROR')) {
        Alert.alert(
          'Google Sign-In Setup Required',
          'Firebase is missing the Android signing SHA-1 or matching OAuth client. Add this app build’s SHA-1 in Firebase Console, download the updated google-services.json, and rebuild the Android app.',
        )
      } else {
        Alert.alert('Google Login Failed', message)
      }
    } finally {
      setGoogleLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>JARVIS</Text>
      
      {/* Email Input */}
      <Controller
        control={control}
        rules={{ required: 'Email zaroori hai' }}
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput style={styles.input} placeholder="Email" onBlur={onBlur} onChangeText={onChange} value={value} autoCapitalize="none" />
        )}
        name="email"
      />
      {errors.email && <Text style={styles.error}>{String(errors.email.message)}</Text>}

      {/* Password Input */}
      <Controller
        control={control}
        rules={{ required: 'Password zaroori hai' }}
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput style={styles.input} placeholder="Password" onBlur={onBlur} onChangeText={onChange} value={value} secureTextEntry />
        )}
        name="password"
      />
      {errors.password && <Text style={styles.error}>{String(errors.password.message)}</Text>}

      {/* Login Button */}
      <TouchableOpacity style={styles.button} onPress={handleSubmit(onSubmit)}>
        <Text style={styles.buttonText}>Login</Text>
      </TouchableOpacity>

      {Platform.OS === 'android' && (
        <>
          <Text style={styles.orText}>OR</Text>
          <GoogleSigninButton
            size={GoogleSigninButton.Size.Wide}
            color={GoogleSigninButton.Color.Dark}
            onPress={() => void onGoogleLogin()}
            disabled={googleLoading}
            style={styles.googleButton}
          />
          {googleLoading && <Text style={styles.loadingText}>Signing in with Google…</Text>}
        </>
      )}

    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#121212' },
  title: { fontSize: 32, color: '#4a90d9', textAlign: 'center', marginBottom: 40, fontWeight: 'bold' },
  input: { backgroundColor: '#222', color: '#fff', padding: 15, borderRadius: 8, marginBottom: 10 },
  error: { color: 'red', fontSize: 12, marginBottom: 10 },
  button: { backgroundColor: '#4a90d9', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  orText: { color: '#888', textAlign: 'center', marginVertical: 16 },
  googleButton: { width: '100%', height: 48, alignSelf: 'center' },
  loadingText: { color: '#aaa', textAlign: 'center', marginTop: 10 },
})