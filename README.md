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

The **Screen** tab also contains the mouse and keyboard controls below the video. The desktop publishes its private LAN IPv4 addresses and an ephemeral, account-scoped control token to the signed-in user's device status. The mobile app authenticates before enabling its local mouse connection; if no authenticated local connection is available, mouse commands use Firebase while the desktop is online. Chat messages can wait for the desktop to come online; mouse, keyboard, and screen-sharing requests are not queued or replayed while the desktop is offline. Screen-sharing offers and answers are stored on the owner's `screen_mirror_sessions` document; ICE candidates are exchanged in its `mobileCandidates` and `desktopCandidates` subcollections.

For connections across different networks, configure a TURN service on both apps: set `EXPO_PUBLIC_TURN_URLS`, `EXPO_PUBLIC_TURN_USERNAME`, and `EXPO_PUBLIC_TURN_CREDENTIAL` in the mobile app's `.env`, and the matching `VITE_TURN_URLS`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL` in the desktop app's `.env`. `*_TURN_URLS` accepts comma-separated TURN URLs. Use temporary TURN credentials from your provider; app-bundled credentials are visible to app users. Without TURN, WebRTC can connect where direct network routes are available, but restrictive NATs or firewalls may prevent cross-network video.

For a no-cost relay option, Metered advertises its Open Relay with a monthly free data allowance (check its current plan and limits before relying on it). Create an account at [Metered Open Relay](https://dashboard.metered.ca/signup?tool=turnserver), then copy the app name and TURN credential API key from its dashboard. Add these values to both apps' root `.env` files:

```env
# Mobile
EXPO_PUBLIC_METERED_APP_NAME=your-metered-app-name
EXPO_PUBLIC_METERED_TURN_API_KEY=your-turn-credential-api-key

# Desktop
VITE_METERED_APP_NAME=your-metered-app-name
VITE_METERED_TURN_API_KEY=your-turn-credential-api-key
```

When these variables are set, each app fetches temporary ICE server credentials from Metered when starting screen mirroring. This takes precedence over the manual `*_TURN_*` settings. Never commit real values. Expo public variables and Vite client variables are bundled into apps and can be extracted; use a restricted/revocable key and monitor the provider quota. Restart the desktop dev app and Expo with `npx expo start -c` after changing `.env`; a standalone APK must be rebuilt.

If screen sharing fails even when both devices use the same Wi-Fi, check that neither device is on a guest network or VPN, that the router does not enable wireless client/AP isolation, and that Jarvis is allowed through Windows Firewall on private networks. Mouse control can still work because it uses a separate control/signaling path and does not prove the WebRTC video path is reachable.

## Google sign-in

The Android login screen supports Firebase Authentication with Google accounts that already have a Jarvis user profile created from the desktop app. Mobile Google sign-in does not create a new Jarvis profile; new users must first sign up in the desktop app. The mobile app clears its saved Google Sign-In session before each attempt so the account chooser appears again; this does not remove Google accounts from the device. Set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in the mobile `.env` to the `client_type: 3` Web OAuth client ID from the same Firebase project's `google-services.json` (it is different from the desktop app's OAuth client ID). In Firebase Console, enable Google under Authentication sign-in providers, add the Android app signing SHA-1 fingerprints, and download the refreshed `google-services.json` to the mobile project root (the path configured in `app.json`). For an existing native Android project, update `android/app/google-services.json` too. The current debug build uses package `com.inam.jarvice` and SHA-1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`; release builds also need their own signing certificate fingerprint. Rebuild the Android app after changing native Google sign-in configuration; it is not supported in Expo Go. iOS Google sign-in needs an iOS OAuth client and `GoogleService-Info.plist` configuration.

## Mobile file management

The **Files** tab browses Jarvis's private app document folder on Android and iOS. It supports creating folders and text files, editing small text files (up to 1 MB), renaming, copying, moving, and deleting items. Copy and move use **Paste** after navigating to the destination folder; deletion asks for confirmation.

This screen does not request broad storage permissions and cannot browse other apps' files, shared storage, or removable drives. Browser builds show a limitation notice because Expo's app-sandbox file APIs are unavailable on Web.

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

  match /mobileCandidates/{candidateId} {
    allow read, create, delete: if request.auth != null
      && request.auth.uid == get(
        /databases/$(database)/documents/screen_mirror_sessions/$(sessionId)
      ).data.userId;
  }

  match /desktopCandidates/{candidateId} {
    allow read, create, delete: if request.auth != null
      && request.auth.uid == get(
        /databases/$(database)/documents/screen_mirror_sessions/$(sessionId)
      ).data.userId;
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
