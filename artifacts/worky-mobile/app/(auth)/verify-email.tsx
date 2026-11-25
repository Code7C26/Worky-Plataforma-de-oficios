import React, { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { AppText, BrandHeader, Button, ErrorNotice, LiveStatusText, TextField } from '@/components/WorkyUI';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function VerifyEmailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { requestRegistrationCode, confirmRegistrationCode } = useAuth();
  const params = useLocalSearchParams<{ email?: string | string[]; codeSent?: string | string[]; message?: string | string[] }>();
  const emailParam = Array.isArray(params.email) ? params.email[0] : params.email;
  const sentParam = Array.isArray(params.codeSent) ? params.codeSent[0] : params.codeSent;
  const initialMessage = Array.isArray(params.message) ? params.message[0] : params.message;
  const email = (emailParam ?? '').trim().toLowerCase();
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(sentParam === '1');
  const [error, setError] = useState(sentParam === '0' ? initialMessage ?? '' : '');
  const [notice, setNotice] = useState(sentParam === '1' ? initialMessage ?? 'Te enviamos un código. Revisá tu email.' : '');
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const sendCode = async () => {
    if (!email) {
      setError('No encontramos el email de tu cuenta. Volvé al registro e intentá nuevamente.');
      return;
    }
    setSending(true);
    setError('');
    setNotice('');
    try {
      await requestRegistrationCode(email);
      setCodeSent(true);
      setNotice('Te enviamos un nuevo código. Revisá tu email.');
    } catch (reason) {
      setError(getSafeError(reason, 'No pudimos enviar el código. Intentá nuevamente.'));
    } finally {
      setSending(false);
    }
  };

  const confirmCode = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError('Ingresá el código de 6 dígitos que recibiste por email.');
      return;
    }
    setConfirming(true);
    setError('');
    setNotice('');
    try {
      await confirmRegistrationCode(email, code);
      router.replace('/(tabs)');
    } catch (reason) {
      setError(getSafeError(reason, 'No pudimos verificar el código. Revisalo e intentá nuevamente.'));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.secondary }]}>
      <KeyboardAwareScrollViewCompat
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + 22,
          paddingBottom: insets.bottom + 28,
          paddingHorizontal: 24,
          flexGrow: 1,
        }}
        bottomOffset={48}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={Keyboard.dismiss} style={{ flex: 1 }}>
          <BrandHeader onDark />
          <View style={styles.hero}>
            <View style={[styles.mailMark, { backgroundColor: colors.authField, borderColor: colors.authBorder }]}>
              <Feather name="mail" size={23} color={colors.primary} />
            </View>
            <AppText variant="title" onDark>Confirmá tu email.</AppText>
            <AppText onDark style={{ color: colors.authMuted }}>
              {email
                ? <>{codeSent ? 'Enviamos un código a ' : 'Necesitás un código para seguir. Podés pedirlo a '}<AppText onDark variant="label">{email}</AppText>. Ingresalo para seguir usando Worky.</>
                : 'Ingresá el código que recibiste para continuar.'}
            </AppText>
          </View>

          <View style={styles.form}>
            <TextField
              label="Código de verificación"
              inverse
              value={code}
              onChangeText={(value) => {
                setCode(value.replace(/\D/g, '').slice(0, 6));
                if (error) setError('');
              }}
              placeholder="000000"
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={() => void confirmCode()}
              accessibilityLabel="Código de verificación de seis dígitos"
              testID="input-verification-code"
              style={styles.codeInput}
            />
            <AppText variant="caption" onDark style={{ color: colors.authMuted }}>
              El código tiene exactamente 6 dígitos.
            </AppText>
            <ErrorNotice message={error} testID="error-verification" />
            {notice ? (
              <LiveStatusText
                variant="caption"
                testID="status-verification"
                style={{ color: colors.authMuted }}
              >
                {notice}
              </LiveStatusText>
            ) : null}
            <Button
              label="Verificar email"
              icon="arrow-right"
              loading={confirming}
              disabled={!email || code.length !== 6}
              onPress={() => void confirmCode()}
              testID="button-confirm-verification"
            />
            <Button
              label={codeSent ? 'Reenviar código' : 'Enviar código'}
              tone="secondary"
              icon="send"
              loading={sending}
              disabled={!email || confirming}
              onPress={() => void sendCode()}
              testID="button-resend-verification"
            />
          </View>

          <View style={styles.footer}>
            <AppText onDark style={{ color: colors.authMuted }}>¿Necesitás usar otro email?</AppText>
            <Pressable
              onPress={() => router.replace('/(auth)/register')}
              accessibilityRole="button"
              testID="link-back-register"
            >
              <AppText variant="label" style={{ color: colors.primary }}>Volver</AppText>
            </Pressable>
          </View>
        </Pressable>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

function getSafeError(reason: unknown, fallback: string) {
  if (reason && typeof reason === 'object') {
    const data = (reason as { data?: unknown }).data;
    if (data && typeof data === 'object') {
      const message = (data as { error?: unknown }).error;
      if (typeof message === 'string' && message.trim()) return message;
    }
    if (reason instanceof Error && reason.message) return reason.message;
  }
  return fallback;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { gap: 12, marginTop: 36, marginBottom: 30 },
  mailMark: {
    width: 54,
    height: 54,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  form: { gap: 14 },
  codeInput: {
    fontFamily: 'SpaceGrotesk_600SemiBold',
    fontSize: 24,
    letterSpacing: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
    marginTop: 28,
    paddingBottom: 14,
  },
});
