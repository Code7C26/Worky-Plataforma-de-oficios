import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { Tabs } from 'expo-router';
import { getListNotificationsQueryKey, useListConversations, useListNotifications } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { getConversationInboxQuery, getUnreadConversationCount } from '@/lib/conversation-inbox';

type WorkyTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

const icons = {
  index: 'search',
  activity: 'activity',
  jobs: 'briefcase',
  conversations: 'message-circle',
  profile: 'user',
} as const;

function AnimatedTabIcon({
  name,
  size,
  color,
  focused,
}: {
  name: React.ComponentProps<typeof Feather>['name'];
  size: number;
  color: string;
  focused: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const wasFocused = React.useRef(focused);

  React.useEffect(() => {
    if (reduceMotion) {
      scale.value = 1;
    } else if (focused && !wasFocused.current) {
      scale.value = withSequence(
        withTiming(0.88, { duration: 70 }),
        withSpring(1, { damping: 14, stiffness: 300 }),
      );
    }
    wasFocused.current = focused;
  }, [focused, reduceMotion, scale]);

  const motionStyle = useAnimatedStyle(() => ({
    transform: [{ scale: reduceMotion ? 1 : scale.value }],
  }), [reduceMotion]);

  return (
    <Animated.View style={motionStyle}>
      <Feather name={name} size={size} color={color} />
    </Animated.View>
  );
}

function WorkyTabBar({ state, descriptors, navigation }: WorkyTabBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { account } = useAuth();
  const role = account?.rol === 'profesional' ? 'profesional' : 'cliente';
  const inboxQuery = getConversationInboxQuery(role);
  const notifications = useListNotifications({
    query: {
      queryKey: getListNotificationsQueryKey(),
      enabled: Boolean(account),
      staleTime: 15_000,
    },
  });
  const conversations = useListConversations(
    inboxQuery.params,
    {
      query: {
        ...inboxQuery.query,
        enabled: Boolean(account),
        staleTime: 15_000,
      },
    },
  );
  const unreadMessages = getUnreadConversationCount(conversations.data);
  const bottomInset = Platform.OS === 'web' ? 0 : insets.bottom;
  const labels = role === 'profesional'
    ? { index: 'Inicio', activity: 'Panel', jobs: 'Changas', conversations: 'Mensajes', profile: 'Más' }
    : { index: 'Buscar', activity: 'Actividad', jobs: 'Trabajos', conversations: 'Mensajes', profile: 'Perfil' };

  return (
    <View style={[styles.shell, { paddingBottom: bottomInset + 8 }]}>
      <View style={[styles.bar, { backgroundColor: colors.card, borderColor: colors.border, shadowColor: colors.foreground }]}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const center = route.name === 'jobs';
          const label = labels[route.name as keyof typeof labels];
          const unread = route.name === 'activity'
            ? notifications.data?.unread ?? 0
            : route.name === 'conversations'
              ? unreadMessages
              : 0;
          const color = focused ? colors.primary : colors.mutedForeground;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="tab"
              accessibilityLabel={descriptors[route.key].options.tabBarAccessibilityLabel ?? label}
              accessibilityState={{ selected: focused }}
              testID={`tab-${route.name}`}
              style={({ pressed }) => [styles.item, center && styles.centerItem, { opacity: pressed ? 0.76 : 1 }]}
            >
              <View
                style={[
                  center ? styles.centerButton : styles.iconButton,
                  {
                    backgroundColor: center
                      ? focused ? colors.primary : colors.secondary
                      : focused ? colors.muted : 'transparent',
                    borderColor: center ? colors.card : 'transparent',
                    shadowColor: center ? colors.foreground : 'transparent',
                  },
                ]}
              >
                <AnimatedTabIcon
                  name={route.name === 'index' && role === 'profesional' ? 'home' : icons[route.name as keyof typeof icons]}
                  size={center ? 22 : 20}
                  color={center ? colors.secondaryForeground : color}
                  focused={focused}
                />
                {unread > 0 ? (
                  <View style={[styles.badge, { backgroundColor: colors.destructive, borderColor: colors.card }]}>
                    <Text style={[styles.badgeText, { color: colors.destructiveForeground }]}>
                      {unread > 9 ? '9+' : unread}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.label, { color: center ? colors.secondary : color }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabLayout() {
  const { account } = useAuth();
  const partner = account?.rol === 'profesional';
  return (
    <Tabs
      tabBar={(props) => <WorkyTabBar {...props} />}
      screenOptions={{ headerShown: false, tabBarHideOnKeyboard: true }}
    >
      <Tabs.Screen name="index" options={{ title: 'Buscar' }} />
      <Tabs.Screen name="activity" options={{ title: partner ? 'Panel' : 'Actividad' }} />
      <Tabs.Screen name="jobs" options={{ title: partner ? 'Changas' : 'Trabajos' }} />
      <Tabs.Screen name="conversations" options={{ title: 'Mensajes' }} />
      <Tabs.Screen name="profile" options={{ title: partner ? 'Más' : 'Perfil' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  shell: { position: 'absolute', left: 12, right: 12, bottom: 0 },
  bar: {
    minHeight: 70,
    borderWidth: 1,
    borderRadius: 25,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  item: { flex: 1, minHeight: 66, alignItems: 'center', justifyContent: 'center', gap: 2 },
  centerItem: { marginTop: -22 },
  iconButton: { width: 34, height: 31, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  centerButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 7,
  },
  label: { fontFamily: 'DMSans_600SemiBold', fontSize: 10, lineHeight: 14 },
  badge: {
    position: 'absolute',
    top: -3,
    right: -5,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 3,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  badgeText: { fontFamily: 'DMSans_700Bold', fontSize: 9 },
});