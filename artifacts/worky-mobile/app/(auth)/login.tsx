import React, { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { AppText, BrandHeader, Button, TextField } from '@/components/WorkyUI';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Ingresá tu email y contraseña.');
      return;
    }
    setPending(true);
    setError('');
    try {
      await signIn(email, password);
      router.replace('/(tabs)');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No pudimos iniciar sesión.');
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.secondary }]}>
      <KeyboardAwareScrollViewCompat
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: insets.top + 22, paddingBottom: insets.bottom + 28, paddingHorizontal: 24, flexGrow: 1 }}
        bottomOffset={40}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={Keyboard.dismiss} style={{ flex: 1 }}>
          <BrandHeader onDark />
          <View style={styles.hero}>
            <AppText variant="title" onDark>Hola de nuevo.</AppText>
            <AppText onDark style={{ color: colors.authMuted }}>
              Ingresá para seguir con tus changas.
            </AppText>
          </View>

          <View style={styles.form}>
            <TextField
              label="Email"
              inverse
              value={email}
              onChangeText={setEmail}
              placeholder="nombre@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              testID="input-login-email"
            />
            <TextField
              label="Contraseña"
              inverse
              value={password}
              onChangeText={setPassword}
              placeholder="Tu contraseña"
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              onSubmitEditing={() => void submit()}
              testID="input-login-password"
            />
            <Pressable
              onPress={() => router.push('/(auth)/forgot-password')}
              style={{ alignSelf: 'flex-end', paddingVertical: 4 }}
              accessibilityRole="button"
            >
              <AppText variant="label" onDark style={{ color: colors.accent }}>¿Olvidaste tu contraseña?</AppText>
            </Pressable>
            {error ? <AppText variant="caption" style={{ color: colors.destructive }}>{error}</AppText> : null}
            <Button label="Ingresar" icon="arrow-right" loading={pending} onPress={() => void submit()} testID="button-login" />
          </View>

          <View style={styles.footer}>
            <AppText onDark style={{ color: colors.authMuted }}>¿Todavía no tenés cuenta?</AppText>
            <Pressable onPress={() => router.push('/(auth)/register')} accessibilityRole="button">
              <AppText variant="label" style={{ color: colors.primary }}>Crear cuenta</AppText>
            </Pressable>
          </View>
        </Pressable>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { gap: 12, marginTop: 36, marginBottom: 28 },
  form: { gap: 16 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 26, paddingBottom: 14 },
});