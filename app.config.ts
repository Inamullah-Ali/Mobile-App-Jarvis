import type { ConfigContext, ExpoConfig } from 'expo/config'

export default ({ config }: ConfigContext): ExpoConfig => {
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || config.extra?.eas?.projectId

  return {
    ...config,
    name: config.name || 'jarvis',
    slug: config.slug || 'jarvis',
    extra: {
      ...config.extra,
      eas: {
        ...config.extra?.eas,
        projectId,
      },
    },
    plugins: [...(config.plugins ?? []), '@react-native-google-signin/google-signin'],
  }
}
