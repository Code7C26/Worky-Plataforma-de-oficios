import React, { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { AppText, BrandHeader, Button, LiveStatusText, TextField } from '@/components/WorkyUI';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

type RegistrationRole = 'cliente' | 'profesional';

export default function RegisterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<RegistrationRole>('cliente');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (name.trim().length < 2 || !email.trim() || password.length < 6) {
      setError('Completá nombre, email y una contraseña de al menos 6 caracteres.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Ingresá un email válido.');
      return;
    }
    setPending(true);
    setError('');
    try {
      await signUp({
        nombre: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        ...(phone.trim() ? { telefono: phone.trim() } : {}),
        rol: role,
      });
      router.replace('/(tabs)');
    } catch (reason) {
      setError(getRequestError(reason, 'No pudimos crear tu cuenta. Revisá los datos e intentá nuevamente.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.secondary }]}>
      <KeyboardAwareScrollViewCompat
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: insets.top + 18, paddingBottom: insets.bottom + 26, paddingHorizontal: 24, flexGrow: 1 }}
        bottomOffset={48}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={Keyboard.dismiss} style={{ flex: 1 }}>
          <BrandHeader onDark />
          <View style={{ gap: 8, marginTop: 28, marginBottom: 22 }}>
            <AppText variant="title" onDark>Empecemos cerca.</AppText>
            <AppText onDark style={{ color: colors.authMuted }}>Una cuenta para encontrar, ofrecer y recomendar.</AppText>
          </View>
          <View style={styles.form}>
            <View style={styles.rolePicker}>
              {(['cliente', 'profesional'] as const).map((item) => {
                const selected = role === item;
                return (
                  <Pressable
                    key={item}
                    onPress={() => setRole(item)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[
                      styles.roleButton,
                       { backgroundColor: selected ? colors.primary : colors.authField, borderColor: selected ? colors.primary : colors.authBorder },
                    ]}
                  >
                    <Feather name={item === 'cliente' ? 'search' : 'tool'} size={17} color={selected ? colors.primaryForeground : colors.authMuted} />
                    <AppText variant="label" onDark={!selected} style={{ color: selected ? colors.primaryForeground : colors.secondaryForeground }}>
                      {item === 'cliente' ? 'Busco un oficio' : 'Ofrezco un oficio'}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
            <TextField label="Nombre y apellido" inverse value={name} onChangeText={setName} placeholder="Tu nombre" autoComplete="name" testID="input-register-name" />
            <TextField label="Email" inverse value={email} onChangeText={setEmail} placeholder="nombre@email.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" accessibilityLabel="Email" testID="input-register-email" />
            <TextField label="Teléfono (opcional)" inverse value={phone} onChangeText={setPhone} placeholder="11 5555 5555" keyboardType="phone-pad" autoComplete="tel" testID="input-register-phone" />
            <TextField label="Contraseña" inverse value={password} onChangeText={setPassword} placeholder="Al menos 6 caracteres" secureTextEntry autoComplete="new-password" testID="input-register-password" />
            {error ? <LiveStatusText variant="caption" role="alert" testID="error-register" style={{ color: colors.destructive }}>{error}</LiveStatusText> : null}
            <Button
              label="Crear cuenta"
              icon="arrow-right"
              loading={pending}
              onPress={() => void submit()}
              testID="button-register"
            />
          </View>
          <View style={styles.footer}>
            <AppText onDark style={{ color: colors.authMuted }}>¿Ya tenés una cuenta?</AppText>
            <Pressable onPress={() => router.replace('/(auth)/login')} accessibilityRole="button">
              <AppText variant="label" style={{ color: colors.primary }}>Ingresar</AppText>
            </Pressable>
          </View>
        </Pressable>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

function getRequestError(reason: unknown, fallback: string) {
  if (reason && typeof reason === 'object') {
    const data = (reason as { data?: unknown }).data;
    if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
      return (data as { error: string }).error;
    }
    if (reason instanceof Error && reason.message) return reason.message;
  }
  return fallback;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  form: { gap: 14 },
  rolePicker: { flexDirection: 'row', gap: 10, marginBottom: 2 },
  roleButton: { flex: 1, minHeight: 56, borderWidth: 1, borderRadius: 15, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 22, paddingBottom: 12 },
});