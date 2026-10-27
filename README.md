# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Screen mirroring

1. Keep the Jarvis desktop app open and signed in.
2. Sign in to the mobile app with the same account.
3. Open the **Screen** tab and tap **Start**. Firebase signals the request, so no PC IP address is needed. Direct connections may work without both devices sharing Wi-Fi; configure TURN below for reliable connections across separate networks.

The **Screen** tab also contains the mouse and keyboard controls below the video. The desktop publishes its private LAN IPv4 addresses to the signed-in user's device status, and the mobile app tries those addresses for the local mouse connection; if none is reachable, mouse commands use Firebase while the desktop is online. Chat messages can wait for the desktop to come online; mouse, keyboard, and screen-sharing requests are not queued or replayed while the desktop is offline.

For connections across different networks, configure a TURN service on both apps: set `EXPO_PUBLIC_TURN_URLS`, `EXPO_PUBLIC_TURN_USERNAME`, and `EXPO_PUBLIC_TURN_CREDENTIAL` in the mobile app's `.env`, and the matching `VITE_TURN_URLS`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL` in the desktop app's `.env`. `*_TURN_URLS` accepts comma-separated TURN URLs. Use temporary TURN credentials from your provider; app-bundled credentials are visible to app users. Without TURN, WebRTC can connect where direct network routes are available, but restrictive NATs or firewalls may prevent cross-network video.

The mobile screen reports **Local connection** when WebRTC selects a direct host-to-host route, and **Cloud connection** when it selects an internet-reflexive or TURN-relay route. This label reflects the selected WebRTC route; Firebase is used for signaling in both cases.

Merge these matches inside the existing `match /databases/{database}/documents` block in Firebase Firestore Security Rules; do not replace the project's other rules:

```text
match /screen_mirror_sessions/{sessionId} {
  function isOwner() {
    return request.auth != null && request.auth.uid == resource.data.userId;
  }

  allow create: if request.auth != null
    && request.auth.uid == request.resource.data.userId;
  allow read, delete: if isOwner();
  allow update: if isOwner()
    && request.resource.data.userId == resource.data.userId;

  match /{candidateCollection}/{candidateId} {
    function ownsParentSession() {
      return request.auth != null
        && request.auth.uid == get(
          /databases/$(database)/documents/screen_mirror_sessions/$(sessionId)
        ).data.userId;
    }

    allow read, write: if ownsParentSession()
      && candidateCollection in ['mobileCandidates', 'desktopCandidates'];
  }
}
```

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
