import Entypo from '@expo/vector-icons/Entypo';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: { backgroundColor: '#1a1a1a', borderTopColor: '#333' },
      tabBarActiveTintColor: '#4a90d9',
      tabBarInactiveTintColor: '#888'
    }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Ionicons name="home" size={24} color={color} />
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color }) => <Ionicons name="chatbubble-ellipses" size={24} color={color} />
        }}
      />
      <Tabs.Screen
        name="files"
        options={{
          title: 'Files',
          tabBarIcon: ({ color }) => <Ionicons name="folder" size={24} color={color} />
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Notifications',
          tabBarIcon: ({ color }) => <Ionicons name="notifications" size={24} color={color} />
        }}
      />
      <Tabs.Screen
        name="touchpad"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="screenmirror"
        options={{
          title: 'Screen',
          tabBarIcon: ({ color }) => <Entypo name="tv" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="remotescreencontrol"
        options={{
          title: 'Touch',
          tabBarIcon: ({ color }) => <Ionicons name="hand-left-outline" size={24} color={color} />,
        }}
      />
    </Tabs>
  )
}