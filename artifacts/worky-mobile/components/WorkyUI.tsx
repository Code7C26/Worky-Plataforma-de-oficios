import React, { useEffect, useRef } from 'react';
import { Image as ExpoImage } from 'expo-image';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type ScrollViewProps,
  type TextInputProps,
  type TextProps,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
type PressableStyleCallback = Extract<PressableProps['style'], (...args: any[]) => any>;
type PressableState = Parameters<PressableStyleCallback>[0];

type TextVariant = 'body' | 'label' | 'caption' | 'title' | 'heading';
type AppTextProps = TextProps & { variant?: TextVariant; onDark?: boolean };

const typeStyles = StyleSheet.create({
  body: { fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 22 },
  label: { fontFamily: 'DMSans_700Bold', fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17 },
  title: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 25, lineHeight: 31, letterSpacing: -0.6 },
  heading: { fontFamily: 'DMSans_700Bold', fontSize: 18, lineHeight: 24 },
});

export function AppText({
  variant = 'body',
  style,
  onDark = false,
  ...props
}: AppTextProps) {
  const colors = useColors();
  return (
    <Text
      {...props}
      style={[typeStyles[variant], { color: onDark ? colors.secondaryForeground : colors.foreground }, style]}
    />
  );
}

export function LiveStatusText({
  role = 'status',
  ...props
}: AppTextProps) {
  const isAlert = role === 'alert';
  const liveRegionProps = Platform.OS === 'web'
    ? { 'aria-live': isAlert ? 'assertive' as const : 'polite' as const }
    : { accessibilityLiveRegion: isAlert ? 'assertive' as const : 'polite' as const };

  return <AppText {...props} role={role} {...liveRegionProps} />;
}

export function ErrorNotice({
  message,
  testID,
}: {
  message: string;
  testID?: string;
}) {
  const colors = useColors();
  const announcedMessage = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'ios' && message && announcedMessage.current !== message) {
      announcedMessage.current = message;
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [message]);

  if (!message) return null;

  return (
    <AppText
      variant="caption"
      {...(Platform.OS === 'web'
        ? { role: 'alert' as const }
        : Platform.OS === 'android'
          ? { accessibilityLiveRegion: 'polite' as const }
          : {})}
      testID={testID}
      style={{ color: colors.destructive }}
    >
      {message}
    </AppText>
  );
}

export function Screen({
  children,
  scroll = true,
  contentStyle,
  ...props
}: ScrollViewProps & { scroll?: boolean; contentStyle?: ViewProps['style'] }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const top = insets.top || (typeof window !== 'undefined' ? 67 : 0);
  const bottom = insets.bottom || (typeof window !== 'undefined' ? 34 : 0);
  const layout = [
    styles.screenContent,
    { paddingTop: top + 14, paddingBottom: bottom + 112 },
    contentStyle,
  ];

  if (!scroll) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={layout}>{children}</View>
      </View>
    );
  }

  return (
    <ScrollView
      {...props}
      style={[styles.screen, { backgroundColor: colors.background }, props.style]}
      contentContainerStyle={[layout, props.contentContainerStyle]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Surface({ children, style, ...props }: ViewProps) {
  const colors = useColors();
  return (
    <View
      {...props}
      style={[
        styles.surface,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          shadowColor: colors.foreground,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

type ButtonProps = PressableProps & {
  label: string;
  tone?: 'primary' | 'secondary' | 'quiet' | 'danger';
  icon?: React.ComponentProps<typeof Feather>['name'];
  loading?: boolean;
  feedback?: boolean;
};

export function Button({
  label,
  tone = 'primary',
  icon,
  loading = false,
  feedback = false,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const colors = useColors();
  const palette = {
    primary: [colors.primary, colors.primaryForeground],
    secondary: [colors.secondary, colors.secondaryForeground],
    quiet: [colors.muted, colors.foreground],
    danger: [colors.destructive, colors.destructiveForeground],
  }[tone];
  const unavailable = Boolean(disabled || loading);

  const buttonStyle: PressableProps['style'] = ({ pressed }) => StyleSheet.flatten([
    styles.button,
    { backgroundColor: palette[0], opacity: unavailable ? 0.52 : pressed ? 0.78 : 1 },
    typeof style === 'function' ? style({ pressed } as Parameters<NonNullable<typeof style>>[0]) : style,
  ]) as ViewStyle;
  const content = (
    <>
      {loading ? (
        <ActivityIndicator size="small" color={palette[1]} />
      ) : icon ? (
        <Feather name={icon} size={17} color={palette[1]} />
      ) : null}
      <AppText variant="label" style={{ color: palette[1] }}>{label}</AppText>
    </>
  );
  const pressableProps = {
    ...props,
    accessibilityRole: 'button' as const,
    disabled: unavailable,
    style: buttonStyle,
  };

  return feedback ? (
    <FeedbackPressable {...pressableProps}>{content}</FeedbackPressable>
  ) : (
    <Pressable {...pressableProps}>{content}</Pressable>
  );
}

export function FeedbackPressable({ style, onPressIn, onPressOut, children, ...props }: PressableProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const scaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: reduceMotion ? 1 : scale.value }],
  }), [reduceMotion]);

  return (
    <AnimatedPressable
      {...props}
      onPressIn={(event) => {
        if (!reduceMotion) scale.value = withSpring(0.965, { damping: 17, stiffness: 280 });
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        if (!reduceMotion) scale.value = withSpring(1, { damping: 17, stiffness: 280 });
        onPressOut?.(event);
      }}
      style={(state: PressableState) => [
        typeof style === 'function' ? style(state) : style,
        scaleStyle,
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}

export function SuccessNotice({
  message,
  onDismiss,
  testID,
}: {
  message: string;
  onDismiss: () => void;
  testID?: string;
}) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!message) return;

    progress.value = reduceMotion ? 1 : withSpring(1, { damping: 17, stiffness: 240 });
    let dismissTimer: ReturnType<typeof setTimeout> | undefined;
    const hideTimer = setTimeout(() => {
      progress.value = reduceMotion ? 0 : withTiming(0, { duration: 160 });
      dismissTimer = setTimeout(() => dismissRef.current(), reduceMotion ? 0 : 180);
    }, 1400);

    return () => {
      clearTimeout(hideTimer);
      if (dismissTimer) clearTimeout(dismissTimer);
      progress.value = 0;
    };
  }, [message, progress, reduceMotion]);

  const noticeStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? (message ? 1 : 0) : progress.value,
    transform: [
      { translateY: reduceMotion ? 0 : (1 - progress.value) * 5 },
      { scale: reduceMotion ? 1 : 0.98 + progress.value * 0.02 },
    ],
  }), [message, reduceMotion]);

  if (!message) return null;

  return (
    <Animated.View
      testID={testID}
      role="status"
      {...(Platform.OS === 'web'
        ? { 'aria-live': 'polite' as const }
        : { accessibilityLiveRegion: 'polite' as const })}
      style={[
        styles.successNotice,
        { backgroundColor: colors.muted, borderColor: colors.border },
        noticeStyle,
      ]}
    >
      <Feather name="check-circle" size={16} color={colors.secondary} />
      <AppText variant="caption" style={{ color: colors.foreground, flex: 1 }}>{message}</AppText>
    </Animated.View>
  );
}

export function TextField({
  label,
  inverse = false,
  style,
  ...props
}: TextInputProps & { label: string; inverse?: boolean }) {
  const colors = useColors();
  return (
    <View style={styles.fieldWrap}>
      <AppText variant="label" onDark={inverse} style={styles.fieldLabel}>{label}</AppText>
      <TextInput
        {...props}
        placeholderTextColor={inverse ? colors.authPlaceholder : colors.mutedForeground}
        style={[
          styles.input,
          {
            backgroundColor: inverse ? colors.authField : colors.card,
            borderColor: inverse ? colors.authBorder : colors.border,
            borderRadius: Math.min(colors.radius, 14),
            color: inverse ? colors.secondaryForeground : colors.foreground,
          },
          style,
        ]}
      />
    </View>
  );
}

export function PageTitle({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.titleWrap}>
      {eyebrow ? (
        <AppText variant="caption" style={{ color: colors.primary, letterSpacing: 1.4, textTransform: 'uppercase' }}>
          {eyebrow}
        </AppText>
      ) : null}
      <AppText variant="title">{title}</AppText>
      {subtitle ? <AppText style={{ color: colors.mutedForeground }}>{subtitle}</AppText> : null}
    </View>
  );
}

export function BrandHeader({ onDark = false }: { onDark?: boolean }) {
  return (
    <View style={styles.brandRow}>
      {onDark ? (
        <Image source={require('../assets/images/worky-logo.png')} style={styles.brandLogo} resizeMode="contain" />
      ) : (
        <Image source={require('../assets/images/worky-logo-light.png')} style={styles.brandLogoLight} resizeMode="contain" />
      )}
    </View>
  );
}

export function StateMessage({
  icon,
  title,
  message,
  action,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  message: string;
  action?: { label: string; onPress: () => void; loading?: boolean; feedback?: boolean };
}) {
  const colors = useColors();
  return (
    <View style={styles.stateMessage}>
      <View style={[styles.stateIcon, { backgroundColor: colors.muted }]}>
        <Feather name={icon} size={22} color={colors.secondary} />
      </View>
      <AppText variant="heading" style={{ textAlign: 'center' }}>{title}</AppText>
      <AppText style={{ color: colors.mutedForeground, textAlign: 'center' }}>{message}</AppText>
      {action ? (
        <Button label={action.label} onPress={action.onPress} loading={action.loading} feedback={action.feedback} style={{ marginTop: 8 }} />
      ) : null}
    </View>
  );
}

function getProfilePhotoUri(objectPath?: string | null) {
  const domain = process.env.EXPO_PUBLIC_DOMAIN
    ?.replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  if (!domain || !objectPath) return null;

  const normalizedPath = objectPath.startsWith('/') ? objectPath : `/${objectPath}`;
  return `https://${domain}/api/v1/storage/public-objects${normalizedPath}`;
}

export function Avatar({
  name,
  size = 46,
  photoObjectPath,
}: {
  name?: string | null;
  size?: number;
  photoObjectPath?: string | null;
}) {
  const colors = useColors();
  const initials = (name || 'W').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const photoUri = getProfilePhotoUri(photoObjectPath);
  const [failedPhotoUri, setFailedPhotoUri] = React.useState<string | null>(null);
  const [loadedPhotoUri, setLoadedPhotoUri] = React.useState<string | null>(null);
  const showPhoto = Boolean(photoUri && failedPhotoUri !== photoUri);
  const showFallback = !photoUri || failedPhotoUri === photoUri || loadedPhotoUri !== photoUri;

  return (
    <View style={{
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: colors.secondary,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    }}>
      {showFallback ? (
        <AppText
          variant="label"
          style={{
            color: colors.secondaryForeground,
            fontSize: size * 0.32,
            textAlign: 'center',
            position: 'absolute',
          }}
        >
          {initials || 'W'}
        </AppText>
      ) : null}
      {showPhoto && photoUri ? (
        <ExpoImage
          key={photoUri}
          source={{ uri: photoUri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={140}
          accessibilityLabel={name ? `Foto de perfil de ${name}` : 'Foto de perfil'}
          onLoad={() => setLoadedPhotoUri(photoUri)}
          onError={() => setFailedPhotoUri(photoUri)}
        />
      ) : null}
    </View>
  );
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatShortDate(value?: string | null) {
  if (!value) return 'Sin actividad';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin actividad';
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(date);
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  screenContent: { flexGrow: 1, paddingHorizontal: 20, gap: 16 },
  surface: {
    borderWidth: 1,
    padding: 16,
    gap: 10,
    shadowOpacity: 0.045,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 1,
  },
  button: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  successNotice: {
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  fieldWrap: { gap: 7 },
  fieldLabel: { marginLeft: 2 },
  input: {
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
  },
  titleWrap: { gap: 6, marginBottom: 2 },
  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  brandLogo: { height: 47, width: 148 },
  brandLogoLight: { width: 112, height: 36 },
  stateMessage: { alignItems: 'center', justifyContent: 'center', paddingVertical: 36, paddingHorizontal: 14, gap: 10 },
  stateIcon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
});