import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { AppText, BrandHeader, Button, TextField } from '@/components/WorkyUI';
import { useColors } from '@/hooks/useColors';
import { useRequestPasswordRecovery } from '@workspace/api-client-react';

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const recovery = useRequestPasswordRecovery();

  const submit = async () => {
    if (!email.trim()) return;
    try {
      await recovery.mutateAsync({ data: { email: email.trim() } });
      setSent(true);
    } catch {
      // Keep the form available so the user can retry.
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.secondary }]}>
      <KeyboardAwareScrollViewCompat
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: insets.top + 22, paddingBottom: insets.bottom + 24, paddingHorizontal: 24, flexGrow: 1 }}
        bottomOffset={32}
        keyboardShouldPersistTaps="handled"
      >
        <BrandHeader onDark />
        <View style={{ gap: 10, marginTop: 42, marginBottom: 26 }}>
          <AppText variant="title" onDark>Recuperá tu acceso</AppText>
          <AppText onDark style={{ color: colors.authMuted }}>
            Te enviaremos instrucciones al email asociado a tu cuenta.
          </AppText>
        </View>
        {sent ? (
          <View style={[styles.success, { backgroundColor: colors.authField, borderColor: colors.authBorder, borderWidth: 1 }]}>
            <AppText variant="heading" onDark>Revisá tu correo</AppText>
            <AppText onDark style={{ color: colors.authMuted }}>
              Si existe una cuenta con ese email, vas a recibir un enlace para restablecer la contraseña.
            </AppText>
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            <TextField label="Email" inverse value={email} onChangeText={setEmail} placeholder="nombre@email.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
            {recovery.isError ? <AppText variant="caption" style={{ color: colors.destructive }}>No pudimos enviar el correo. Intentá de nuevo.</AppText> : null}
            <Button label="Enviar instrucciones" icon="send" loading={recovery.isPending} onPress={() => void submit()} />
          </View>
        )}
        <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button">
          <AppText variant="label" onDark style={{ color: colors.accent }}>Volver a ingresar</AppText>
        </Pressable>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  success: { borderRadius: 17, padding: 18, gap: 8 },
  back: { alignSelf: 'center', marginTop: 24, padding: 10 },
});