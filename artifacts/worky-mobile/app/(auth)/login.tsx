import React, { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { AppText, BrandHeader, Button, ErrorNotice, TextField } from '@/components/WorkyUI';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { getOrCreateDeviceId } from '@/lib/session';
import { getLoginError } from '@/lib/login-error';
import { Feather } from '@expo/vector-icons';

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const addingAccount = mode === 'add';
  const { signIn, confirmDeviceLogin } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [challengeId, setChallengeId] = useState<number | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');

  const submit = async () => {
    if (!email.trim() || (!challengeId && !password)) {
      setError('Ingresá tu email y contraseña.');
      return;
    }
    if (challengeId && code.length !== 6) {
      setError('Ingresá el código de 6 dígitos que recibiste por email.');
      return;
    }
    setPending(true);
    setError('');
    try {
      const currentDeviceId = deviceId || await getOrCreateDeviceId();
      setDeviceId(currentDeviceId);
      if (challengeId) {
        await confirmDeviceLogin(email.trim().toLowerCase(), currentDeviceId, challengeId, code);
        router.replace('/(tabs)');
      } else {
        const result = await signIn(email.trim().toLowerCase(), password, currentDeviceId);
        if (result.challengeId) {
          setChallengeId(result.challengeId);
          setPassword('');
          setNotice('Este dispositivo es nuevo. Enviamos un código a tu email para confirmar el ingreso.');
        } else {
          router.replace('/(tabs)');
        }
      }
    } catch (reason) {
      const details = getLoginError(reason);
      if (details.code === 'EMAIL_NOT_VERIFIED') {
        router.replace({
          pathname: '/(auth)/verify-email',
          params: { email: email.trim().toLowerCase(), codeSent: '0' },
        });
        return;
      }
      setError(details.message);
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
          {addingAccount ? (
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Volver al perfil"
              testID="button-back-add-account"
              style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 }}
            >
              <Feather name="arrow-left" size={18} color={colors.secondaryForeground} />
              <AppText variant="label" onDark>Volver al perfil</AppText>
            </Pressable>
          ) : null}
          <BrandHeader onDark />
          <View style={styles.hero}>
            <AppText variant="title" onDark>{addingAccount ? 'Agregar otra cuenta.' : 'Hola de nuevo.'}</AppText>
            <AppText onDark style={{ color: colors.authMuted }}>
              {addingAccount ? 'Ingresá con la cuenta que querés sumar a Worky.' : 'Ingresá para seguir con tus changas.'}
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
            {!challengeId ? (
              <TextField
                label="Contraseña"
                inverse
                value={password}
                onChangeText={setPassword}
                placeholder="Tu contraseña"
                secureTextEntry
                showPasswordToggle
                autoComplete="password"
                textContentType="password"
                onSubmitEditing={() => void submit()}
                testID="input-login-password"
              />
            ) : null}
            {challengeId ? (
              <>
                <TextField
                  label="Código de acceso"
                  inverse
                  value={code}
                  onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  maxLength={6}
                  returnKeyType="done"
                  testID="input-device-login-code"
                />
                <AppText onDark style={{ color: colors.authMuted }}>{notice}</AppText>
                <Pressable
                  onPress={() => {
                    setChallengeId(null);
                    setCode('');
                    setNotice('');
                    setPassword('');
                  }}
                  accessibilityRole="button"
                  testID="button-restart-device-login"
                >
                  <AppText variant="label" onDark style={{ color: colors.accent }}>Volver e intentar de nuevo</AppText>
                </Pressable>
              </>
            ) : null}
            {!challengeId ? <Pressable
              onPress={() => router.push('/(auth)/forgot-password')}
              style={{ alignSelf: 'flex-end', paddingVertical: 4 }}
              accessibilityRole="button"
            >
              <AppText variant="label" onDark style={{ color: colors.accent }}>¿Olvidaste tu contraseña?</AppText>
            </Pressable> : null}
            <ErrorNotice message={error} testID="error-login" />
            <Button
              label={challengeId ? 'Verificar e ingresar' : 'Ingresar'}
              icon="arrow-right"
              loading={pending}
              disabled={challengeId !== null && code.length !== 6}
              onPress={() => void submit()}
              testID="button-login"
            />
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