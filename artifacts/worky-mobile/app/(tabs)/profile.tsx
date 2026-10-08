import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Alert, Platform, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import {
  confirmAccountEmailVerification,
  requestAccountEmailVerification,
  useCreateMyProfessionalProfile,
  useChangeMyPassword,
  useGetMyProfessionalProfile,
  useUpdateMyAccount,
  useUpdateMyProfessionalProfile,
  type ProfessionalProfileInput,
} from '@workspace/api-client-react';
import { AppText, Avatar, Button, ErrorNotice, LiveStatusText, Screen, StateMessage, SuccessNotice, Surface, TextField, formatCurrency } from '@/components/WorkyUI';
import { RoleSwitcher, type WorkyRole } from '@/components/RoleSwitcher';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { savePersonalDetails } from '@/lib/personal-details-save';
import { changePasswordWithValidation } from '@/lib/password-change';
import { runProfessionalProfileSave } from '@/lib/professional-profile-save';

function ProfessionalProfileEditor({
  initial,
}: {
  initial: {
    oficio: string;
    categoria: string;
    precioReferencia: number;
    experienciaAnios: number;
    about?: string | null;
    skills: string[];
    disponible: boolean;
  } | null;
}) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const create = useCreateMyProfessionalProfile();
  const update = useUpdateMyProfessionalProfile();
  const [trade, setTrade] = useState(initial?.oficio ?? '');
  const [category, setCategory] = useState(initial?.categoria ?? '');
  const [rate, setRate] = useState(initial ? String(initial.precioReferencia) : '');
  const [experience, setExperience] = useState(initial ? String(initial.experienciaAnios) : '0');
  const [about, setAbout] = useState(initial?.about ?? '');
  const [skills, setSkills] = useState(initial?.skills.join(', ') ?? '');
  const [available, setAvailable] = useState(initial?.disponible ?? true);
  const [error, setError] = useState('');
  const [errorVersion, setErrorVersion] = useState(0);
  const [saved, setSaved] = useState(false);

  const showError = (message: string) => {
    setError(message);
    setErrorVersion((version) => version + 1);
  };

  const save = async () => {
    setError('');
    setSaved(false);
    const price = Number(rate);
    if (trade.trim().length < 2 || !category.trim() || !Number.isFinite(price) || price < 0) {
      showError('Completá oficio, categoría y un precio de referencia válido.');
      return;
    }
    const payload: ProfessionalProfileInput = {
      oficio: trade.trim(),
      categoria: category.trim(),
      precioReferencia: price,
      experienciaAnios: Math.max(0, Number(experience) || 0),
      about: about.trim() || null,
      skills: skills.split(',').map((value) => value.trim()).filter(Boolean),
      disponible: available,
    };
    const result = await runProfessionalProfileSave(
      () => initial ? update.mutateAsync({ data: payload }) : create.mutateAsync({ data: payload }),
      () => queryClient.invalidateQueries(),
    );
    if (result.kind === 'saved') setSaved(true);
    else showError(result.message);
  };

  return (
    <Surface>
      <View style={{ gap: 4 }}>
        <AppText variant="heading">{initial ? 'Perfil profesional' : 'Completá tu perfil profesional'}</AppText>
        <AppText variant="caption" style={{ color: colors.mutedForeground }}>
          {initial ? 'Mantené al día la información que ven los clientes.' : 'Contales qué hacés para que puedan encontrarte.'}
        </AppText>
      </View>
      <TextField label="Oficio" value={trade} onChangeText={setTrade} placeholder="Ej. Electricista" />
      <TextField label="Categoría" value={category} onChangeText={setCategory} placeholder="Ej. Electricidad" />
      <TextField label="Precio de referencia (ARS)" value={rate} onChangeText={setRate} placeholder="15000" keyboardType="decimal-pad" />
      <TextField label="Años de experiencia" value={experience} onChangeText={setExperience} placeholder="0" keyboardType="number-pad" />
      <TextField label="Presentación" value={about} onChangeText={setAbout} placeholder="Contá brevemente tu experiencia" multiline style={{ minHeight: 94, textAlignVertical: 'top' }} />
      <TextField label="Especialidades (separadas por coma)" value={skills} onChangeText={setSkills} placeholder="Instalaciones, reparaciones…" />
      <Pressable
        onPress={() => setAvailable((value) => !value)}
        accessibilityRole="switch"
        accessibilityState={{ checked: available }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}
      >
        <View style={{ width: 42, height: 25, borderRadius: 14, padding: 3, alignItems: available ? 'flex-end' : 'flex-start', justifyContent: 'center', backgroundColor: available ? colors.secondary : colors.muted }}>
          <View style={{ width: 19, height: 19, borderRadius: 10, backgroundColor: available ? colors.secondaryForeground : colors.mutedForeground }} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="label">Disponible para nuevos trabajos</AppText>
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>{available ? 'Tu perfil puede aparecer en búsquedas.' : 'Tu perfil queda pausado por ahora.'}</AppText>
        </View>
      </Pressable>
      <SuccessNotice
        message={saved ? 'Perfil guardado.' : ''}
        onDismiss={() => setSaved(false)}
        testID="notice-professional-profile-saved"
      />
      <ErrorNotice
        key={errorVersion}
        message={error}
        testID="text-professional-profile-save-error"
      />
      <Button label="Guardar perfil" icon="check" loading={create.isPending || update.isPending} feedback onPress={() => void save()} />
    </Surface>
  );
}

function PasswordForm() {
  const colors = useColors();
  const { account, refreshSession } = useAuth();
  const changePassword = useChangeMyPassword();
  const [emailCode, setEmailCode] = useState('');
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [emailVerifiedLocally, setEmailVerifiedLocally] = useState(false);
  const [emailMessage, setEmailMessage] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailPending, setEmailPending] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [resultVersion, setResultVersion] = useState(0);
  const announcement = saved ? 'Contraseña actualizada.' : error;

  useEffect(() => {
    if (Platform.OS !== 'ios' || !announcement) return;
    AccessibilityInfo.announceForAccessibilityWithOptions(announcement, {
      queue: true,
      priority: 'low',
    });
  }, [announcement, resultVersion]);

  const submit = async () => {
    setError('');
    setSaved(false);
    const result = await changePasswordWithValidation({
      currentPassword,
      newPassword,
      confirmation,
    }, () => changePassword.mutateAsync({ data: { currentPassword, newPassword } }));
    if (result.kind === 'saved') {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setSaved(true);
    } else setError(result.message);
    setResultVersion((version) => version + 1);
  };

  const requestEmailCode = async () => {
    setEmailPending(true);
    setEmailError('');
    setEmailMessage('');
    try {
      const result = await requestAccountEmailVerification();
      setEmailCodeSent(true);
      setEmailMessage(result.message);
    } catch (reason) {
      setEmailError(getRequestError(reason, 'No pudimos enviar el código.'));
    } finally {
      setEmailPending(false);
    }
  };

  const confirmEmailCode = async () => {
    setEmailError('');
    setEmailMessage('');
    if (!/^\d{6}$/.test(emailCode)) {
      setEmailError('Ingresá el código de 6 dígitos.');
      return;
    }
    setEmailPending(true);
    try {
      const result = await confirmAccountEmailVerification({ code: emailCode });
      if (!result.verified) {
        setEmailError('No pudimos verificar el código. Revisalo o pedí uno nuevo.');
        return;
      }
      setEmailVerifiedLocally(true);
      setEmailCodeSent(false);
      setEmailCode('');
      setEmailMessage('Tu email quedó verificado.');
      await refreshSession();
    } catch (reason) {
      setEmailError(getRequestError(reason, 'No pudimos verificar el código.'));
    } finally {
      setEmailPending(false);
    }
  };

  const emailIsVerified = emailVerifiedLocally || Boolean(account?.emailVerifiedAt);

  return (
    <Surface>
      <View style={{ gap: 4 }}>
        <AppText variant="heading">Seguridad</AppText>
        <AppText variant="caption" style={{ color: colors.mutedForeground }}>Actualizá tu contraseña para proteger el acceso a Worky.</AppText>
      </View>
      <View style={{ gap: 9, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 14 }}>
        <AppText variant="label">Verificación de email</AppText>
        <AppText variant="caption" style={{ color: colors.mutedForeground }}>{account?.email}</AppText>
        <LiveStatusText
          variant="caption"
          testID="status-account-email-verification"
          style={{ color: emailIsVerified ? colors.secondary : colors.mutedForeground }}
        >
          {emailIsVerified ? 'Email verificado.' : 'Tu email todavía no está verificado.'}
        </LiveStatusText>
        {emailMessage ? (
          <LiveStatusText variant="caption" testID="notice-account-email-verification" style={{ color: colors.secondary }}>
            {emailMessage}
          </LiveStatusText>
        ) : null}
        {emailError ? (
          <LiveStatusText variant="caption" role="alert" testID="error-account-email-verification" style={{ color: colors.destructive }}>
            {emailError}
          </LiveStatusText>
        ) : null}
        {!emailIsVerified && !emailCodeSent ? (
          <Button
            label="Enviar código de verificación"
            icon="mail"
            loading={emailPending}
            onPress={() => void requestEmailCode()}
            accessibilityLabel="Enviar código de verificación al email"
            testID="button-send-account-email-code"
          />
        ) : null}
        {!emailIsVerified && emailCodeSent ? (
          <>
            <TextField
              label="Código de 6 dígitos"
              value={emailCode}
              onChangeText={(value) => { setEmailCode(value.replace(/\D/g, '').slice(0, 6)); setEmailError(''); }}
              placeholder="000000"
              keyboardType="number-pad"
              autoComplete="one-time-code"
              accessibilityLabel="Código de verificación de 6 dígitos"
              maxLength={6}
              testID="input-account-email-code"
            />
            <Button
              label="Confirmar email"
              icon="check"
              loading={emailPending}
              onPress={() => void confirmEmailCode()}
              testID="button-confirm-account-email-code"
            />
            <Button
              label="Reenviar código"
              tone="quiet"
              icon="refresh-cw"
              loading={emailPending}
              onPress={() => void requestEmailCode()}
              accessibilityLabel="Reenviar código de verificación"
              testID="button-resend-account-email-code"
            />
          </>
        ) : null}
      </View>
      <TextField label="Contraseña actual" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry textContentType="password" />
      <TextField label="Nueva contraseña" value={newPassword} onChangeText={setNewPassword} secureTextEntry textContentType="newPassword" />
      <TextField label="Repetir nueva contraseña" value={confirmation} onChangeText={setConfirmation} secureTextEntry textContentType="newPassword" />
      {saved ? (
        <LiveStatusText
          key={resultVersion}
          variant="caption"
          role="status"
          testID="notice-password-changed"
          style={{ color: colors.secondary }}
        >
          Contraseña actualizada.
        </LiveStatusText>
      ) : null}
      {error ? (
        <LiveStatusText
          key={resultVersion}
          variant="caption"
          role="alert"
          testID="text-password-change-error"
          style={{ color: colors.destructive }}
        >
          {error}
        </LiveStatusText>
      ) : null}
      <Button label="Cambiar contraseña" icon="lock" loading={changePassword.isPending} onPress={() => void submit()} />
    </Surface>
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

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { account, signOut, setAccount, switchRole } = useAuth();
  const [name, setName] = useState(account?.nombre ?? '');
  const [phone, setPhone] = useState(account?.telefono ?? '');
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState(false);
  const [roleError, setRoleError] = useState('');
  const [roleNotice, setRoleNotice] = useState('');
  const [switchingRole, setSwitchingRole] = useState(false);
  const updateAccount = useUpdateMyAccount();
  const saveAnnouncement = updated ? 'Cambios guardados.' : error;
  const professional = useGetMyProfessionalProfile({
    query: { queryKey: ['/api/v1/partner-profile/me'], enabled: account?.rol === 'profesional', staleTime: 30_000 },
  });

  useEffect(() => {
    if (Platform.OS !== 'ios' || !saveAnnouncement) return;
    AccessibilityInfo.announceForAccessibilityWithOptions(saveAnnouncement, {
      queue: true,
      priority: 'low',
    });
  }, [saveAnnouncement]);

  useEffect(() => {
    if (Platform.OS !== 'ios' || !roleNotice) return;
    AccessibilityInfo.announceForAccessibilityWithOptions(roleNotice, {
      queue: true,
      priority: 'low',
    });
  }, [roleNotice]);

  const saveAccount = async () => {
    setError('');
    setUpdated(false);
    if (name.trim().length < 2) {
      setError('El nombre debe tener al menos 2 caracteres.');
      return;
    }
    const result = await savePersonalDetails(
      () => updateAccount.mutateAsync({
        data: { nombre: name.trim(), telefono: phone.trim() || null },
      }),
      setAccount,
    );
    if (result.kind === 'saved') setUpdated(true);
    else setError(result.message);
  };

  const handleRoleSwitch = async (role: WorkyRole) => {
    if (!account || account.rol === role) return;
    setRoleError('');
    setRoleNotice('');
    setSwitchingRole(true);
    try {
      await switchRole(role);
      setRoleNotice(role === 'profesional'
        ? 'Ahora usás Worky como Partner. Completá tu perfil para que puedan encontrarte.'
        : 'Ahora usás Worky como Cliente. Tu perfil profesional sigue guardado.');
    } catch {
      setRoleError('No pudimos cambiar tu perfil. Revisá tu conexión e intentá de nuevo.');
    } finally {
      setSwitchingRole(false);
    }
  };

  const confirmSignOut = () => {
    Alert.alert('Cerrar sesión', '¿Querés salir de tu cuenta en este dispositivo?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar sesión', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  if (!account) {
    return <Screen><StateMessage icon="user" title="No encontramos tu perfil" message="Volvé a iniciar sesión para continuar." action={{ label: 'Ingresar', onPress: () => router.replace('/(auth)/login') }} /></Screen>;
  }

  return (
    <KeyboardAwareScrollViewCompat
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        flexGrow: 1,
        gap: 16,
        paddingHorizontal: 20,
        paddingTop: insets.top + 14,
        paddingBottom: insets.bottom + 112,
      }}
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: 7 }}>
        <AppText variant="caption" style={{ color: colors.primary, letterSpacing: 1.3, textTransform: 'uppercase' }}>Tu cuenta</AppText>
        <AppText variant="title">{account.rol === 'profesional' ? 'Más' : 'Perfil y configuración'}</AppText>
      </View>
      <Surface style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
        <Avatar name={account.nombre} size={58} photoObjectPath={account.fotoObjectPath} />
        <View style={{ flex: 1, gap: 3 }}>
          <AppText variant="heading">{account.nombre}</AppText>
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>{account.email}</AppText>
            <AppText variant="caption" style={{ color: colors.primary }}>
              {account.rol === 'profesional' ? 'Partner' : account.rol === 'cliente' ? 'Cliente' : 'Administración'}
            </AppText>
        </View>
      </Surface>
      {account.rol !== 'admin' ? (
        <Surface style={{ gap: 9 }}>
          <AppText
            variant="caption"
            style={{ color: colors.mutedForeground, letterSpacing: 1.1, textTransform: 'uppercase' }}
          >
            Usar Worky como
          </AppText>
          <RoleSwitcher
            role={account.rol}
            onSelect={handleRoleSwitch}
            disabled={switchingRole}
            loading={switchingRole}
          />
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>
            Tus datos y conversaciones se conservan al cambiar de perfil.
          </AppText>
          {roleNotice ? (
            <LiveStatusText
              variant="caption"
              testID="text-role-switch-success"
              style={{ color: colors.secondary }}
            >
              {roleNotice}
            </LiveStatusText>
          ) : null}
          {roleError ? (
            <AppText
              variant="caption"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              testID="text-role-switch-error"
              style={{ color: colors.destructive }}
            >
              {roleError}
            </AppText>
          ) : null}
        </Surface>
      ) : null}
      <Surface>
        <AppText variant="heading">Datos personales</AppText>
        <TextField label="Nombre" value={name} onChangeText={setName} autoComplete="name" />
        <TextField label="Teléfono" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
        <SuccessNotice
          message={updated ? 'Cambios guardados.' : ''}
          onDismiss={() => setUpdated(false)}
          testID="notice-account-saved"
        />
        {error ? (
          <LiveStatusText
            variant="caption"
            role="alert"
            testID="text-account-save-error"
            style={{ color: colors.destructive }}
          >
            {error}
          </LiveStatusText>
        ) : null}
        <Button label="Guardar cambios" icon="check" loading={updateAccount.isPending} feedback onPress={() => void saveAccount()} />
      </Surface>
      {account.rol === 'profesional' ? (
        professional.isLoading ? (
          <StateMessage icon="tool" title="Cargando perfil profesional" message="Estamos buscando tus datos." />
        ) : professional.isError ? (
          <StateMessage icon="wifi-off" title="No cargó tu perfil profesional" message="Intentá actualizarlo." action={{ label: 'Reintentar', onPress: () => void professional.refetch() }} />
        ) : (
          <ProfessionalProfileEditor
            key={`${professional.data?.id ?? 'new'}-${professional.data?.updatedAt ?? ''}`}
            initial={professional.data ?? null}
          />
        )
      ) : null}
      <PasswordForm />
      <Surface style={{ gap: 8 }}>
        <AppText variant="heading">Sesión</AppText>
        <AppText variant="caption" style={{ color: colors.mutedForeground }}>Cuenta activa en este dispositivo.</AppText>
        <Button label="Cerrar sesión" tone="quiet" icon="log-out" onPress={confirmSignOut} testID="button-logout" />
      </Surface>
    </KeyboardAwareScrollViewCompat>
  );
}