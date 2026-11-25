import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Alert, Image, Linking, Modal, Platform, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { File } from 'expo-file-system';
import { fetch as uploadFetch } from 'expo/fetch';
import {
  confirmAccountEmailVerification,
  getGetClientIdentityVerificationStatusQueryKey,
  useGetClientIdentityVerificationStatus,
  useDeleteMyProfilePhoto,
  requestAccountEmailVerification,
  useCreateMyProfessionalProfile,
  useChangeMyPassword,
  getGetMyAccountQueryKey,
  useGetMyProfessionalProfile,
  useGetPartnerVisitBalance,
  useGetTwoFactorSecurity,
  useListMyTrustedMobileDevices,
  useRequestUploadUrl,
  useSubmitClientIdentityVerification,
  useRevokeMyTrustedMobileDevice,
  useUpdateMyAccount,
  useUpdateMyProfilePhoto,
  useUpdateMyProfessionalProfile,
  useUpdateTwoFactorSecurity,
  type ProfessionalProfileInput,
} from '@workspace/api-client-react';
import { AppText, Avatar, Button, ErrorNotice, LiveStatusText, Screen, StateMessage, SuccessNotice, Surface, TextField, formatCurrency } from '@/components/WorkyUI';
import { RoleSwitcher, type WorkyRole } from '@/components/RoleSwitcher';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
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
    ubicacionFija?: { direccionTexto: string; ciudad: string; provincia?: string | null } | null;
  } | null;
}) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const create = useCreateMyProfessionalProfile();
  const update = useUpdateMyProfessionalProfile();
  const [locationPermission, requestLocationPermission] = Location.useForegroundPermissions();
  const [trade, setTrade] = useState(initial?.oficio ?? '');
  const [category, setCategory] = useState(initial?.categoria ?? '');
  const [rate, setRate] = useState(initial ? String(initial.precioReferencia) : '');
  const [experience, setExperience] = useState(initial ? String(initial.experienciaAnios) : '0');
  const [about, setAbout] = useState(initial?.about ?? '');
  const [skills, setSkills] = useState(initial?.skills.join(', ') ?? '');
  const [available, setAvailable] = useState(initial?.disponible ?? true);
  const [workshopAddress, setWorkshopAddress] = useState(initial?.ubicacionFija?.direccionTexto ?? '');
  const [workshopCity, setWorkshopCity] = useState(initial?.ubicacionFija?.ciudad ?? '');
  const [workshopProvince, setWorkshopProvince] = useState(initial?.ubicacionFija?.provincia ?? '');
  const [workshopCoordinates, setWorkshopCoordinates] = useState<[number, number] | undefined>();
  const [locationError, setLocationError] = useState('');
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
    if (workshopAddress.trim().length < 3 || workshopCity.trim().length < 2) {
      showError('Indicá la dirección exacta del taller y la ciudad.');
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
      ubicacionFija: {
        direccionTexto: workshopAddress.trim(),
        ciudad: workshopCity.trim(),
        provincia: workshopProvince.trim() || null,
        ...(workshopCoordinates ? { coordinates: workshopCoordinates } : {}),
      },
    };
    const result = await runProfessionalProfileSave(
      () => initial ? update.mutateAsync({ data: payload }) : create.mutateAsync({ data: payload }),
      () => queryClient.invalidateQueries(),
    );
    if (result.kind === 'saved') setSaved(true);
    else showError(result.message);
  };

  const captureWorkshopLocation = async () => {
    setLocationError('');
    try {
      let permission = locationPermission;
      if (!permission?.granted) permission = await requestLocationPermission();
      if (!permission?.granted) {
        if (permission && !permission.canAskAgain && Platform.OS !== 'web') {
          Alert.alert('Ubicación desactivada', 'Permití el acceso a la ubicación desde la configuración para guardar el punto de tu taller.', [
            { text: 'Ahora no', style: 'cancel' },
            { text: 'Abrir configuración', onPress: () => { try { void Linking.openSettings(); } catch { /* Settings may not be available */ } } },
          ]);
        } else {
          setLocationError('Necesitamos permiso de ubicación para calcular la distancia desde tu taller.');
        }
        return;
      }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setWorkshopCoordinates([current.coords.longitude, current.coords.latitude]);
    } catch {
      setLocationError('No pudimos obtener la ubicación. Intentá nuevamente cuando estés en tu taller.');
    }
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
      <View style={{ gap: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted, padding: 14 }}>
        <AppText variant="label">Ubicación fija del taller</AppText>
        <AppText variant="caption" style={{ color: colors.mutedForeground }}>
          La dirección exacta será pública en tu perfil. El GPS solo se usa para calcular distancias aproximadas; las coordenadas no se muestran.
        </AppText>
      </View>
      <TextField label="Dirección exacta del taller" value={workshopAddress} onChangeText={setWorkshopAddress} placeholder="Calle y altura" autoComplete="street-address" testID="input-professional-workshop-address" />
      <TextField label="Ciudad" value={workshopCity} onChangeText={setWorkshopCity} placeholder="Ciudad" testID="input-professional-workshop-city" />
      <TextField label="Provincia (opcional)" value={workshopProvince} onChangeText={setWorkshopProvince} placeholder="Provincia" testID="input-professional-workshop-province" />
      <Button
        label={workshopCoordinates ? 'Actualizar ubicación del taller' : 'Usar ubicación actual del taller'}
        icon="map-pin"
        tone="quiet"
        onPress={() => void captureWorkshopLocation()}
        testID="button-capture-workshop-location"
      />
      {workshopCoordinates ? <LiveStatusText variant="caption" role="status" style={{ color: colors.foreground }}>Punto del taller guardado; las coordenadas no se publican.</LiveStatusText> : null}
      {locationError ? <LiveStatusText variant="caption" role="alert" style={{ color: colors.destructive }}>{locationError}</LiveStatusText> : null}
      <TextField label="Presentación" value={about} onChangeText={setAbout} placeholder="Contá brevemente tu experiencia" multiline style={{ minHeight: 94, textAlignVertical: 'top' }} />
      <TextField
        label="Especialidades (separadas por coma)"
        value={skills}
        onChangeText={setSkills}
        placeholder="Instalaciones, reparaciones…"
        testID="input-professional-skills"
      />
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
      <Button
        label="Guardar perfil"
        icon="check"
        loading={create.isPending || update.isPending}
        feedback
        onPress={() => void save()}
        testID="button-save-professional-profile"
      />
    </Surface>
  );
}

function PasswordForm() {
  const colors = useColors();
  const { account, refreshSession } = useAuth();
  const queryClient = useQueryClient();
  const changePassword = useChangeMyPassword();
  const trustedDevices = useListMyTrustedMobileDevices();
  const revokeTrustedDevice = useRevokeMyTrustedMobileDevice();
  const twoFactorSecurity = useGetTwoFactorSecurity({
    query: { queryKey: ['auth-two-factor'], enabled: Boolean(account), staleTime: 30_000 },
  });
  const updateTwoFactorSecurity = useUpdateTwoFactorSecurity();
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
  const [deviceNotice, setDeviceNotice] = useState('');
  const [deviceError, setDeviceError] = useState('');
  const [twoFactorPassword, setTwoFactorPassword] = useState('');
  const [twoFactorError, setTwoFactorError] = useState('');
  const [twoFactorMessage, setTwoFactorMessage] = useState('');
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

  const updateTwoFactor = async () => {
    setTwoFactorError('');
    setTwoFactorMessage('');
    const enabled = !twoFactorSecurity.data?.enabled;
    if (enabled && !emailIsVerified) {
      setTwoFactorError('Primero verificá tu email para activar el segundo paso.');
      return;
    }
    if (!twoFactorPassword) {
      setTwoFactorError('Ingresá tu contraseña actual para confirmar este cambio.');
      return;
    }
    try {
      const result = await updateTwoFactorSecurity.mutateAsync({
        data: { enabled, currentPassword: twoFactorPassword },
      });
      setTwoFactorPassword('');
      setTwoFactorMessage(result.enabled
        ? 'La verificación en dos pasos quedó activada.'
        : 'La verificación en dos pasos quedó desactivada.');
      await queryClient.invalidateQueries({ queryKey: ['auth-two-factor'] });
    } catch (reason) {
      setTwoFactorError(getRequestError(reason, 'No pudimos actualizar la seguridad.'));
    }
  };

  const revokeDevice = async (deviceKey: string) => {
    setDeviceError('');
    setDeviceNotice('');
    try {
      await revokeTrustedDevice.mutateAsync({ deviceKey });
      await trustedDevices.refetch();
      setDeviceNotice('Se quitó la confianza de esa instalación. Para volver a ingresar, deberá confirmar un código enviado a tu email.');
    } catch (reason) {
      setDeviceError(getRequestError(reason, 'No pudimos quitar la confianza de esa instalación.'));
    }
  };

  const confirmRevokeDevice = (deviceKey: string) => {
    Alert.alert(
      'Quitar instalación confiable',
      'La próxima vez que se intente ingresar desde esa instalación, Worky pedirá un código enviado a tu email.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Quitar confianza', style: 'destructive', onPress: () => void revokeDevice(deviceKey) },
      ],
    );
  };

  return (
    <Surface>
      <View style={{ gap: 4 }}>
        <AppText variant="heading">Seguridad</AppText>
        <AppText variant="caption" style={{ color: colors.mutedForeground }}>Actualizá tu contraseña para proteger el acceso a Worky.</AppText>
      </View>
      <View style={{ gap: 9, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flex: 1, gap: 3 }}>
            <AppText variant="label">Verificación en dos pasos (opcional)</AppText>
            <AppText variant="caption" style={{ color: colors.mutedForeground }}>
              {twoFactorSecurity.data?.enabled
                ? 'Está activada para proteger los nuevos inicios de sesión.'
                : 'Agregá un código enviado a tu email como protección adicional.'}
            </AppText>
          </View>
          <AppText
            variant="caption"
            testID="status-two-factor-security"
            style={{ color: twoFactorSecurity.data?.enabled ? colors.secondary : colors.mutedForeground }}
          >
            {twoFactorSecurity.isLoading ? 'Consultando…' : twoFactorSecurity.data?.enabled ? 'Activada' : 'Desactivada'}
          </AppText>
        </View>
        {!emailIsVerified && !twoFactorSecurity.data?.enabled ? (
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>
            Verificá tu email antes de activar esta opción.
          </AppText>
        ) : null}
        {twoFactorSecurity.isError ? (
          <LiveStatusText variant="caption" role="alert" testID="error-two-factor-security" style={{ color: colors.destructive }}>
            No pudimos consultar este ajuste de seguridad.
          </LiveStatusText>
        ) : null}
        <TextField
          label="Contraseña actual para confirmar"
          value={twoFactorPassword}
          onChangeText={(value) => { setTwoFactorPassword(value); setTwoFactorError(''); }}
          secureTextEntry
          showPasswordToggle
          textContentType="password"
          testID="input-two-factor-password"
        />
        {twoFactorError ? (
          <LiveStatusText variant="caption" role="alert" testID="error-update-two-factor" style={{ color: colors.destructive }}>
            {twoFactorError}
          </LiveStatusText>
        ) : null}
        {twoFactorMessage ? (
          <LiveStatusText variant="caption" role="status" testID="notice-update-two-factor" style={{ color: colors.foreground }}>
            {twoFactorMessage}
          </LiveStatusText>
        ) : null}
        <Button
          label={twoFactorSecurity.data?.enabled ? 'Desactivar verificación' : 'Activar verificación'}
          icon={twoFactorSecurity.data?.enabled ? 'shield-off' : 'shield'}
          tone={twoFactorSecurity.data?.enabled ? 'quiet' : 'secondary'}
          loading={updateTwoFactorSecurity.isPending}
          disabled={twoFactorSecurity.isLoading || twoFactorSecurity.isError || (!emailIsVerified && !twoFactorSecurity.data?.enabled) || !twoFactorPassword}
          onPress={() => void updateTwoFactor()}
          testID="button-toggle-two-factor"
        />
      </View>
      <View style={{ gap: 9, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 14 }}>
        <AppText variant="label">Verificación de email</AppText>
        <AppText variant="caption" style={{ color: colors.mutedForeground }}>{account?.email}</AppText>
        <LiveStatusText
          variant="caption"
          testID="status-account-email-verification"
          style={{ color: emailIsVerified ? colors.foreground : colors.mutedForeground }}
        >
          {emailIsVerified ? 'Email verificado.' : 'Tu email todavía no está verificado.'}
        </LiveStatusText>
        {emailMessage ? (
          <LiveStatusText variant="caption" testID="notice-account-email-verification" style={{ color: colors.foreground }}>
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
      <View style={{ gap: 9, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 14 }}>
        <AppText variant="label">Instalaciones confiables</AppText>
        <AppText variant="caption" style={{ color: colors.mutedForeground }}>
          Revisá dónde puede iniciar sesión tu cuenta. Al quitar una instalación, la próxima vez deberá confirmar un código.
        </AppText>
        {trustedDevices.isLoading ? (
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>Cargando instalaciones…</AppText>
        ) : trustedDevices.isError ? (
          <View style={{ gap: 8 }}>
            <LiveStatusText variant="caption" role="alert" testID="error-trusted-devices" style={{ color: colors.destructive }}>
              No pudimos cargar las instalaciones confiables.
            </LiveStatusText>
            <Button label="Reintentar" tone="quiet" icon="refresh-cw" onPress={() => void trustedDevices.refetch()} testID="button-retry-trusted-devices" />
          </View>
        ) : trustedDevices.data?.length ? (
          <View style={{ gap: 10 }}>
            {trustedDevices.data.map((device, index) => (
              <View
                key={device.deviceKey}
                testID={`trusted-device-${index}`}
                style={{ gap: 5, paddingVertical: 7, borderBottomWidth: index < trustedDevices.data.length - 1 ? 1 : 0, borderBottomColor: colors.border }}
              >
                <AppText variant="label">Instalación de Worky</AppText>
                <AppText variant="caption" style={{ color: colors.mutedForeground }}>
                  Último uso: {new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(device.lastSeenAt))}
                </AppText>
                <AppText variant="caption" style={{ color: colors.mutedForeground }}>
                  Verificada: {new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(new Date(device.createdAt))}
                </AppText>
                <Button
                  label="Quitar confianza"
                  tone="quiet"
                  icon="trash-2"
                  loading={revokeTrustedDevice.isPending}
                  disabled={revokeTrustedDevice.isPending}
                  onPress={() => confirmRevokeDevice(device.deviceKey)}
                  testID={`button-revoke-trusted-device-${index}`}
                />
              </View>
            ))}
          </View>
        ) : (
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>No hay instalaciones móviles confiables.</AppText>
        )}
        {deviceNotice ? (
          <LiveStatusText variant="caption" role="status" testID="notice-trusted-device-revoked" style={{ color: colors.foreground }}>
            {deviceNotice}
          </LiveStatusText>
        ) : null}
        {deviceError ? (
          <LiveStatusText variant="caption" role="alert" testID="error-revoke-trusted-device" style={{ color: colors.destructive }}>
            {deviceError}
          </LiveStatusText>
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
          style={{ color: colors.foreground }}
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

function ClientIdentityVerificationCard() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const verification = useGetClientIdentityVerificationStatus({
    query: { queryKey: getGetClientIdentityVerificationStatusQueryKey(), refetchOnMount: 'always' },
  });
  const requestUploadUrl = useRequestUploadUrl();
  const submitVerification = useSubmitClientIdentityVerification();
  const [photoPermission, requestPhotoPermission] = ImagePicker.useMediaLibraryPermissions();
  const [cameraPermission, requestCameraPermission] = ImagePicker.useCameraPermissions();
  const [dni, setDni] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [selfie, setSelfie] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const chooseDni = async () => {
    setError('');
    setNotice('');
    try {
      let permission = photoPermission;
      if (!permission?.granted) permission = await requestPhotoPermission();
      if (!permission.granted) {
        setError(permission.canAskAgain
          ? 'Necesitamos acceso a tus fotos para elegir la imagen del DNI.'
          : 'Permití el acceso a tus fotos desde la configuración del dispositivo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.9,
      });
      if (!result.canceled && result.assets[0]) setDni(result.assets[0]);
    } catch (reason) {
      setError(getRequestError(reason, 'No pudimos abrir la galería.'));
    }
  };

  const captureSelfie = async () => {
    setError('');
    setNotice('');
    try {
      let permission = cameraPermission;
      if (!permission?.granted) permission = await requestCameraPermission();
      if (!permission.granted) {
        setError(permission.canAskAgain
          ? 'Necesitamos permiso para tomar una selfie de verificación.'
          : 'Permití el acceso a la cámara desde la configuración del dispositivo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        cameraType: ImagePicker.CameraType.front,
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.9,
      });
      if (!result.canceled && result.assets[0]) setSelfie(result.assets[0]);
    } catch (reason) {
      setError(getRequestError(reason, 'No pudimos abrir la cámara.'));
    }
  };

  const uploadImage = async (asset: ImagePicker.ImagePickerAsset, documentType: 'dni' | 'selfie') => {
    const file = asset.file ?? new File(asset.uri);
    const contentType = (asset.mimeType || file.type || 'image/jpeg').toLowerCase().split(';')[0];
    const size = asset.fileSize ?? file.size;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
      throw new Error('Usá una imagen JPG, PNG o WebP.');
    }
    if (!Number.isFinite(size) || size <= 0 || size > 10 * 1024 * 1024) {
      throw new Error('Cada imagen debe pesar hasta 10 MB.');
    }
    const upload = await requestUploadUrl.mutateAsync({
      data: {
        name: asset.fileName || `verificacion-${documentType}-${Date.now()}.${contentType.split('/')[1]}`,
        size,
        contentType,
        purpose: 'client_verification',
        documentType,
      },
    });
    const uploaded = await uploadFetch(upload.uploadURL, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: file,
    });
    if (!uploaded.ok) throw new Error('No pudimos cargar una de las imágenes. Intentá nuevamente.');
    if (!upload.uploadId) throw new Error('No recibimos la confirmación de carga. Volvé a intentar.');
    return upload.uploadId;
  };

  const submit = async () => {
    if (!dni || !selfie || !consented || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const dniUploadId = await uploadImage(dni, 'dni');
      const selfieUploadId = await uploadImage(selfie, 'selfie');
      await submitVerification.mutateAsync({ data: { dniUploadId, selfieUploadId, consent: true } });
      setDni(null);
      setSelfie(null);
      setConsented(false);
      setNotice('Recibimos tu solicitud. Podés seguir usando Worky mientras la revisamos.');
      await queryClient.invalidateQueries({ queryKey: getGetClientIdentityVerificationStatusQueryKey() });
    } catch (reason) {
      setError(getRequestError(reason, 'No pudimos enviar la solicitud. Revisá tu conexión e intentá nuevamente.'));
    } finally {
      setBusy(false);
    }
  };

  const status = verification.data?.status;
  const reasonLabel = verification.data?.reasonCode === 'dni_unreadable'
    ? 'La foto del DNI no se pudo leer.'
    : verification.data?.reasonCode === 'selfie_unusable'
      ? 'La selfie no permitió revisar la identidad.'
      : verification.data?.reasonCode === 'identity_mismatch'
        ? 'Los datos no coincidieron.'
        : '';

  return (
    <Surface testID="client-identity-verification-card">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
          <Feather name="shield" size={19} color={colors.primary} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <AppText variant="heading">Verificar cuenta de cliente</AppText>
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>
            La insignia solo aparece ante trabajadores después de aprobar la revisión.
          </AppText>
        </View>
      </View>
      {verification.isLoading ? (
        <AppText variant="caption" style={{ color: colors.mutedForeground }}>Consultando el estado…</AppText>
      ) : verification.isError ? (
        <View style={{ gap: 8 }}>
          <LiveStatusText variant="caption" role="alert" style={{ color: colors.destructive }}>
            No pudimos consultar el estado de verificación.
          </LiveStatusText>
          <Button label="Reintentar" tone="quiet" icon="refresh-cw" onPress={() => void verification.refetch()} testID="button-retry-client-verification" />
        </View>
      ) : status === 'verified' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13, backgroundColor: colors.muted, padding: 12 }} testID="status-client-verification">
          <Feather name="check-circle" size={18} color={colors.secondary} />
          <AppText variant="label">Cliente verificado</AppText>
        </View>
      ) : status === 'pending_verification' ? (
        <View style={{ gap: 4, borderRadius: 13, backgroundColor: colors.muted, padding: 12 }} testID="status-client-verification">
          <AppText variant="label">Solicitud en revisión</AppText>
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>
            Tu cuenta mantiene sus funciones habituales mientras revisamos las imágenes.
          </AppText>
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>
            Enviá una foto legible del DNI y una selfie actual. Solo el equipo autorizado de Worky podrá verlas durante la revisión.
          </AppText>
          {status === 'rejected' ? (
            <View style={{ gap: 4, borderRadius: 13, backgroundColor: colors.muted, padding: 12 }} testID="status-client-verification">
              <AppText variant="label">Necesitamos nuevas imágenes</AppText>
              <AppText variant="caption" style={{ color: colors.mutedForeground }}>{reasonLabel || 'Revisá las imágenes y volvé a enviarlas.'}</AppText>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label={dni ? 'DNI seleccionado' : 'Elegir foto del DNI'} tone="quiet" icon="image" onPress={() => void chooseDni()} disabled={busy} testID="button-select-client-dni" />
            <Button label={selfie ? 'Selfie lista' : 'Tomar selfie'} tone="quiet" icon="camera" onPress={() => void captureSelfie()} disabled={busy} testID="button-capture-client-selfie" />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {[['DNI', dni], ['Selfie', selfie]].map(([label, asset]) => asset ? (
              <View key={label as string} style={{ flex: 1, gap: 5 }}>
                <Image source={{ uri: (asset as ImagePicker.ImagePickerAsset).uri }} accessibilityLabel={`${label} seleccionado`} style={{ width: '100%', height: 120, borderRadius: 12, backgroundColor: colors.muted }} resizeMode="cover" />
                <AppText variant="caption" style={{ color: colors.mutedForeground }}>{label as string} listo para enviar</AppText>
              </View>
            ) : null)}
          </View>
          <Pressable
            onPress={() => setConsented((value) => !value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consented }}
            testID="checkbox-client-verification-consent"
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4 }}
          >
            <Feather name={consented ? 'check-square' : 'square'} size={20} color={consented ? colors.primary : colors.mutedForeground} />
            <AppText variant="caption" style={{ flex: 1, color: colors.mutedForeground }}>
              Acepto que Worky use estas imágenes únicamente para revisar mi identidad y las elimine cuando se resuelva el caso. Se conservarán el resultado y los datos mínimos de auditoría.
            </AppText>
          </Pressable>
          {error ? <LiveStatusText variant="caption" role="alert" testID="error-client-verification" style={{ color: colors.destructive }}>{error}</LiveStatusText> : null}
          {notice ? <LiveStatusText variant="caption" role="status" testID="notice-client-verification" style={{ color: colors.foreground }}>{notice}</LiveStatusText> : null}
          <Button
            label={busy ? 'Enviando solicitud…' : 'Enviar para revisión'}
            icon="shield"
            loading={busy || requestUploadUrl.isPending || submitVerification.isPending}
            disabled={!dni || !selfie || !consented || busy}
            onPress={() => void submit()}
            testID="button-submit-client-verification"
          />
        </View>
      )}
    </Surface>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const { mode, toggleMode } = useTheme();
  const insets = useSafeAreaInsets();
  const { account, savedAccounts, signOut, setAccount, switchRole, refreshSession, switchSavedAccount } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState(account?.nombre ?? '');
  const [phone, setPhone] = useState(account?.telefono ?? '');
  const [username, setUsername] = useState(account?.username ?? '');
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState(false);
  const [roleError, setRoleError] = useState('');
  const [roleNotice, setRoleNotice] = useState('');
  const [switchingRole, setSwitchingRole] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [personalDetailsOpen, setPersonalDetailsOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [photoActionsOpen, setPhotoActionsOpen] = useState(false);
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);
  const [photoDeleteConfirmOpen, setPhotoDeleteConfirmOpen] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [switchingAccountId, setSwitchingAccountId] = useState<number | null>(null);
  const updateAccount = useUpdateMyAccount();
  const deleteProfilePhoto = useDeleteMyProfilePhoto();
  const requestUploadUrl = useRequestUploadUrl();
  const updateProfilePhoto = useUpdateMyProfilePhoto();
  const [photoPermission, requestPhotoPermission] = ImagePicker.useMediaLibraryPermissions();
  const [photoError, setPhotoError] = useState('');
  const [photoSaved, setPhotoSaved] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [themeError, setThemeError] = useState('');
  const saveAnnouncement = updated ? 'Cambios guardados.' : error;
  const professional = useGetMyProfessionalProfile({
    query: { queryKey: ['/api/v1/partner-profile/me'], enabled: account?.rol === 'profesional', staleTime: 30_000 },
  });
  const partnerBalance = useGetPartnerVisitBalance({
    query: {
      queryKey: ['/api/v1/partner/saldo-visitas', account?.id],
      enabled: account?.rol === 'profesional',
      staleTime: 15_000,
      refetchInterval: 30_000,
    },
  });

  useEffect(() => {
    if (!account) return;
    setName(account.nombre);
    setPhone(account.telefono ?? '');
    setUsername(account.username ?? '');
  }, [account?.id]);

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
    const normalizedUsername = username.trim().replace(/^@/, '').toLowerCase();
    if (normalizedUsername && !/^[a-z0-9_]{3,20}$/.test(normalizedUsername)) {
      setError('El usuario debe tener entre 3 y 20 caracteres: letras, números o guion bajo.');
      return;
    }
    const result = await savePersonalDetails(
      () => updateAccount.mutateAsync({
        data: {
          nombre: name.trim(),
          telefono: phone.trim() || null,
          username: normalizedUsername || null,
        },
      }),
      setAccount,
    );
    if (result.kind === 'saved') setUpdated(true);
    else setError(result.message);
  };

  const handleThemeToggle = async () => {
    setThemeError('');
    try {
      await toggleMode();
    } catch {
      setThemeError('No pudimos guardar la apariencia. Intentá nuevamente.');
    }
  };

  const changeProfilePhoto = async () => {
    setPhotoActionsOpen(false);
    setPhotoError('');
    setPhotoSaved(false);
    if (Platform.OS !== 'web' && !photoPermission?.granted) {
      const permission = await requestPhotoPermission();
      if (!permission.granted) {
        if (!permission.canAskAgain) {
          Alert.alert(
            'Acceso a fotos desactivado',
            'Permití el acceso a tus fotos desde la configuración para cambiar tu imagen.',
            [
              { text: 'Ahora no', style: 'cancel' },
              { text: 'Abrir configuración', onPress: () => void Linking.openSettings() },
            ],
          );
        } else {
          setPhotoError('Necesitamos permiso para elegir una imagen de tu galería.');
        }
        return;
      }
    }

    setUploadingPhoto(true);
    try {
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (selection.canceled) return;

      const asset = selection.assets[0];
      if (!asset) throw new Error('No pudimos leer la imagen seleccionada.');
      const file = asset.file ?? new File(asset.uri);
      const contentType = asset.mimeType || file.type || 'image/jpeg';
      const size = asset.fileSize ?? file.size;
      if (!contentType.startsWith('image/')) throw new Error('Elegí un archivo de imagen.');
      if (!Number.isFinite(size) || size <= 0) throw new Error('No pudimos leer el tamaño de la imagen.');
      if (size > 10 * 1024 * 1024) throw new Error('La foto de perfil puede pesar hasta 10 MB.');

      const upload = await requestUploadUrl.mutateAsync({
        data: {
          name: asset.fileName || `foto-perfil-${Date.now()}.jpg`,
          size,
          contentType,
          purpose: 'profile_photo',
        },
      });
      const uploaded = await uploadFetch(upload.uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file,
      });
      if (!uploaded.ok) throw new Error('No pudimos cargar la foto. Probá nuevamente.');

      await updateProfilePhoto.mutateAsync({ data: { objectPath: upload.objectPath } });
      await refreshSession();
      await queryClient.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      setPhotoSaved(true);
    } catch (reason) {
      setPhotoError(getRequestError(reason, 'No pudimos guardar la foto de perfil.'));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const removeProfilePhoto = async () => {
    setPhotoActionsOpen(false);
    setPhotoDeleteConfirmOpen(false);
    setPhotoError('');
    setPhotoSaved(false);
    setUploadingPhoto(true);
    try {
      await deleteProfilePhoto.mutateAsync();
      await refreshSession();
      await queryClient.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      setPhotoSaved(true);
    } catch (reason) {
      setPhotoError(getRequestError(reason, 'No pudimos quitar la foto de perfil.'));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSavedAccountSwitch = async (accountId: number) => {
    setSessionError('');
    setSwitchingAccountId(accountId);
    try {
      await switchSavedAccount(accountId);
      setAccountsOpen(false);
    } catch (reason) {
      setSessionError(getRequestError(reason, 'No pudimos cambiar de cuenta.'));
    } finally {
      setSwitchingAccountId(null);
    }
  };

  const addAccount = () => {
    router.push({ pathname: '/(auth)/login', params: { mode: 'add' } });
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

  const ratingValue = account?.rol === 'profesional' ? Number(professional.data?.rating ?? 0) : 0;
  const ratingCount = account?.rol === 'profesional' ? Number(professional.data?.reviewsCount ?? 0) : 0;

  if (!account) {
    return <Screen hasHeader><StateMessage icon="user" title="No encontramos tu perfil" message="Volvé a iniciar sesión para continuar." action={{ label: 'Ingresar', onPress: () => router.replace('/(auth)/login') }} /></Screen>;
  }

  return (
    <>
    <KeyboardAwareScrollViewCompat
      testID="worky-profile-screen"
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        flexGrow: 1,
        gap: 16,
        paddingHorizontal: 20,
        paddingTop: 14,
        paddingBottom: insets.bottom + 112,
      }}
      bottomOffset={72}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: 7 }}>
        <AppText variant="caption" style={{ color: colors.primary, letterSpacing: 1.3, textTransform: 'uppercase' }}>Tu cuenta</AppText>
        <AppText variant="title">{account.rol === 'profesional' ? 'Más' : 'Perfil y configuración'}</AppText>
      </View>
      <Surface testID="profile-photo-section" style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 17 }}>
        <Pressable
          onPress={() => setPhotoActionsOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Opciones de foto de perfil"
          accessibilityHint="Ver, cambiar o eliminar tu imagen"
          testID="button-profile-photo-actions"
          style={({ pressed }) => ({ opacity: pressed ? 0.78 : 1 })}
        >
          <View style={{ position: 'relative' }}>
            <Avatar name={account.nombre} size={72} photoObjectPath={account.fotoObjectPath} />
            <View style={{
              position: 'absolute',
              right: -2,
              bottom: -1,
              width: 25,
              height: 25,
              borderRadius: 13,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.primary,
              opacity: 0.82,
              borderWidth: 2,
              borderColor: colors.card,
            }}>
              <Feather name="plus" size={15} color={colors.primaryForeground} />
            </View>
          </View>
        </Pressable>
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="heading" numberOfLines={1}>{account.nombre}</AppText>
          <AppText variant="caption" style={{ color: colors.mutedForeground }} numberOfLines={1}>{account.email}</AppText>
          {account.rol !== 'admin' ? (
            <AppText variant="caption" style={{ color: colors.primary, fontWeight: '700' }}>
              {account.rol === 'profesional' ? 'Partner' : 'Cliente'}
            </AppText>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }} testID="profile-rating-summary">
            {Array.from({ length: 5 }, (_, index) => (
              <Feather
                key={index}
                name="star"
                size={15}
                color={ratingCount > 0 && index < Math.round(ratingValue) ? colors.accent : colors.mutedForeground}
              />
            ))}
            <AppText variant="caption" style={{ color: colors.mutedForeground, marginLeft: 4 }}>
              {account.rol === 'profesional' && ratingCount > 0
                ? `${ratingValue.toFixed(1)} (${ratingCount})`
                : '(0)'}
            </AppText>
          </View>
        </View>
      </Surface>
      {photoSaved ? (
        <LiveStatusText variant="caption" role="status" testID="notice-profile-photo-saved" style={{ color: colors.foreground }}>
          {account.fotoObjectPath ? 'Foto de perfil actualizada.' : 'Foto de perfil eliminada.'}
        </LiveStatusText>
      ) : null}
      {photoError ? (
        <LiveStatusText variant="caption" role="alert" testID="error-profile-photo" style={{ color: colors.destructive }}>
          {photoError}
        </LiveStatusText>
      ) : null}
      {account.rol === 'profesional' ? (
        <Surface testID="profile-professional-balance" style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
              <Feather name="credit-card" size={19} color={colors.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="heading">Saldo</AppText>
              <AppText variant="caption" style={{ color: colors.mutedForeground }}>Disponible, retenido y comisiones pendientes.</AppText>
            </View>
          </View>
          {partnerBalance.isLoading ? (
            <AppText variant="caption" style={{ color: colors.mutedForeground }}>Cargando saldo…</AppText>
          ) : partnerBalance.isError ? (
            <View style={{ gap: 8 }}>
              <AppText variant="caption" style={{ color: colors.destructive }}>
                No pudimos cargar el saldo. Verificá que tu perfil profesional esté habilitado e intentá de nuevo.
              </AppText>
              <Button label="Reintentar" tone="quiet" icon="refresh-cw" onPress={() => void partnerBalance.refetch()} testID="button-retry-profile-balance" />
            </View>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1, gap: 3 }}>
                  <AppText variant="caption" style={{ color: colors.mutedForeground }}>Disponible</AppText>
                  <AppText variant="heading" testID="text-profile-balance-available">
                    {formatCurrency(partnerBalance.data?.availableAmount ?? 0)}
                  </AppText>
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <AppText variant="caption" style={{ color: colors.mutedForeground }}>A liberar</AppText>
                  <AppText variant="label" testID="text-profile-balance-pending">
                    {formatCurrency(partnerBalance.data?.pendingAmount ?? 0)}
                  </AppText>
                </View>
              </View>
              <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 9, gap: 5 }}>
                <AppText variant="caption" style={{ color: colors.mutedForeground }}>
                  Comisión pendiente de visitas: {formatCurrency(partnerBalance.data?.cashCommissionDue ?? 0)}
                </AppText>
                <AppText
                  variant="caption"
                  testID="text-profile-balance-cash-job-commission"
                  style={{ color: (partnerBalance.data?.cashJobCommissionDue ?? 0) > 0 ? colors.destructive : colors.mutedForeground }}
                >
                  Comisión pendiente de changas en efectivo: {formatCurrency(partnerBalance.data?.cashJobCommissionDue ?? 0)}
                </AppText>
              </View>
            </>
          )}
        </Surface>
      ) : null}
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
              style={{ color: colors.foreground }}
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
      <Surface testID="personal-details-disclosure">
        <Pressable
          onPress={() => setPersonalDetailsOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={`Datos personales, ${personalDetailsOpen ? 'contraer' : 'expandir'}`}
          accessibilityState={{ expanded: personalDetailsOpen }}
          testID="button-toggle-personal-details"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.72 : 1 })}
        >
          <View style={{ width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
            <Feather name="user" size={19} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <AppText variant="heading">Datos personales</AppText>
            <AppText variant="caption" style={{ color: colors.mutedForeground }}>
              Tocá para editar: nombre · teléfono · Gmail · DNI · usuario
            </AppText>
          </View>
          <Feather name={personalDetailsOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.mutedForeground} />
        </Pressable>
        {personalDetailsOpen ? (
          <View style={{ gap: 12, marginTop: 18 }}>
            <TextField label="Nombre y apellido" value={name} onChangeText={setName} autoComplete="name" testID="input-account-name" />
            <TextField label="Teléfono" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" testID="input-account-phone" />
            <View style={{ gap: 4 }}>
              <AppText variant="label">Gmail</AppText>
              <AppText variant="body" testID="text-account-email" style={{ color: colors.mutedForeground }}>{account.email}</AppText>
              <AppText variant="caption" style={{ color: colors.mutedForeground }}>Email vinculado a esta cuenta.</AppText>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted, padding: 12 }}>
              <Feather name="lock" size={16} color={colors.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="label">DNI</AppText>
                <AppText variant="caption" style={{ color: colors.mutedForeground }}>Número protegido por seguridad; se usa solo en la verificación privada.</AppText>
              </View>
            </View>
            <TextField
              label="Nombre de usuario"
              value={username}
              onChangeText={(value) => setUsername(value.replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20))}
              placeholder="ejemplo_usuario"
              autoCapitalize="none"
              autoComplete="username"
              testID="input-account-username"
            />
            <AppText variant="caption" style={{ color: colors.mutedForeground }}>
              Elegí tu identificador de Worky. Se guarda en minúsculas; usá de 3 a 20 letras, números o guion bajo.
            </AppText>
            <SuccessNotice
              message={updated ? 'Cambios guardados.' : ''}
              onDismiss={() => setUpdated(false)}
              testID="notice-account-saved"
            />
            {error ? (
              <LiveStatusText variant="caption" role="alert" testID="text-account-save-error" style={{ color: colors.destructive }}>
                {error}
              </LiveStatusText>
            ) : null}
            <Button label="Guardar cambios" icon="check" loading={updateAccount.isPending} feedback onPress={() => void saveAccount()} testID="button-save-account-details" />
          </View>
        ) : null}
      </Surface>
      {account.rol === 'cliente' ? <ClientIdentityVerificationCard /> : null}
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
      <Surface testID="profile-security-disclosure">
        <Pressable
          onPress={() => setSecurityOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={`Seguridad de la cuenta, ${securityOpen ? 'contraer' : 'expandir'}`}
          accessibilityState={{ expanded: securityOpen }}
          testID="button-toggle-profile-security"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <View style={{ width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
            <Feather name="shield" size={19} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <AppText variant="heading">Seguridad</AppText>
            <AppText variant="caption" style={{ color: colors.mutedForeground }}>
              Contraseña, email y verificación en dos pasos
            </AppText>
          </View>
          <Feather name={securityOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.mutedForeground} />
        </Pressable>
      </Surface>
      {securityOpen ? <PasswordForm /> : null}
      <Surface testID="accounts-section" style={{ gap: 8 }}>
        <Pressable
          onPress={() => setAccountsOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={`Cuentas, ${accountsOpen ? 'contraer' : 'expandir'}`}
          accessibilityHint="Muestra la cuenta activa, las cuentas guardadas y la opción para agregar otra."
          accessibilityState={{ expanded: accountsOpen }}
          testID="button-toggle-account-management"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.72 : 1 })}
        >
          <View style={{ width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
            <Feather name="users" size={19} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <AppText variant="heading">Cuentas</AppText>
            <AppText variant="caption" style={{ color: colors.mutedForeground }}>Cuenta activa, cambiar o agregar una cuenta.</AppText>
          </View>
          <Feather name={accountsOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.mutedForeground} />
        </Pressable>
        {accountsOpen ? (
          <View style={{ gap: 10 }} testID="account-management-options">
            <View style={{ gap: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted, padding: 12 }}>
              <AppText variant="label">Cuenta activa</AppText>
              <AppText variant="body">{account.nombre}</AppText>
              <AppText variant="caption" style={{ color: colors.mutedForeground }}>{account.email}</AppText>
            </View>
            {savedAccounts.filter((saved) => saved.id !== account.id).length ? (
              <View style={{ gap: 8 }} testID="saved-accounts-list">
                <AppText variant="label">Cambiar a una cuenta guardada</AppText>
                {savedAccounts.filter((saved) => saved.id !== account.id).map((saved) => (
                  <Pressable
                    key={saved.id}
                    onPress={() => void handleSavedAccountSwitch(saved.id)}
                    disabled={switchingAccountId !== null}
                    accessibilityRole="button"
                    accessibilityLabel={`Cambiar a ${saved.nombre}, ${saved.email}`}
                    testID={`button-switch-account-${saved.id}`}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: colors.border,
                      padding: 12,
                      opacity: switchingAccountId !== null ? 0.6 : pressed ? 0.78 : 1,
                    })}
                  >
                    <Avatar name={saved.nombre} size={38} photoObjectPath={saved.fotoObjectPath} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText variant="label">{saved.nombre}</AppText>
                      <AppText variant="caption" style={{ color: colors.mutedForeground }}>{saved.email}</AppText>
                    </View>
                    <Feather
                      name={switchingAccountId === saved.id ? 'loader' : 'arrow-right'}
                      size={17}
                      color={colors.primary}
                    />
                  </Pressable>
                ))}
              </View>
            ) : (
              <AppText variant="caption" style={{ color: colors.mutedForeground }}>
                Todavía no hay otra cuenta guardada en este dispositivo.
              </AppText>
            )}
            {sessionError ? (
              <LiveStatusText variant="caption" role="alert" testID="error-switch-account" style={{ color: colors.destructive }}>
                {sessionError}
              </LiveStatusText>
            ) : null}
            <Button label="Agregar cuenta" tone="secondary" icon="user-plus" onPress={addAccount} testID="button-add-account" />
          </View>
        ) : null}
      </Surface>
      <Surface testID="theme-mode-section" style={{ gap: 10 }}>
        <View style={{ gap: 4 }}>
          <AppText variant="heading">Apariencia</AppText>
          <AppText
            variant="caption"
            testID="text-theme-description"
            style={{ color: colors.mutedForeground }}
          >
            {mode === 'dark'
              ? 'Modo oscuro activado. La franja azul se mantiene.'
              : 'Usá un fondo oscuro y conservá el azul de Worky.'}
          </AppText>
        </View>
        <Button
          label={mode === 'dark' ? 'Usar tema claro' : 'Activar modo oscuro'}
          icon={mode === 'dark' ? 'sun' : 'moon'}
          tone="quiet"
          onPress={() => void handleThemeToggle()}
          testID="button-toggle-theme"
        />
        {themeError ? (
          <LiveStatusText
            variant="caption"
            role="alert"
            testID="text-theme-save-error"
            style={{ color: colors.destructive }}
          >
            {themeError}
          </LiveStatusText>
        ) : null}
      </Surface>
      <Surface testID="logout-section">
        <Button label="Cerrar sesión" tone="danger" icon="log-out" onPress={confirmSignOut} testID="button-logout" />
      </Surface>
    </KeyboardAwareScrollViewCompat>
    <Modal
      visible={photoActionsOpen || photoPreviewOpen || photoDeleteConfirmOpen}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        setPhotoActionsOpen(false);
        setPhotoPreviewOpen(false);
        setPhotoDeleteConfirmOpen(false);
      }}
    >
      <View style={{
        flex: 1,
        justifyContent: photoPreviewOpen ? 'center' : 'flex-end',
        padding: 16,
        backgroundColor: 'rgba(13, 20, 31, 0.48)',
      }}>
        <Pressable
          onPress={() => {
            setPhotoActionsOpen(false);
            setPhotoPreviewOpen(false);
            setPhotoDeleteConfirmOpen(false);
          }}
          accessibilityRole="button"
          accessibilityLabel="Cerrar opciones de foto"
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
        />
        <Surface
          testID={photoPreviewOpen ? 'profile-photo-preview' : undefined}
          style={{ gap: 10, borderRadius: 22, padding: 18 }}
        >
          {photoDeleteConfirmOpen ? (
            <>
              <View style={{ gap: 3, marginBottom: 2 }}>
                <AppText variant="heading">¿Eliminar tu foto?</AppText>
                <AppText variant="caption" style={{ color: colors.mutedForeground }}>
                  Dejará de mostrarse en tu perfil y en Worky.
                </AppText>
              </View>
              <Button
                label="Eliminar imagen"
                icon="trash-2"
                tone="danger"
                loading={deleteProfilePhoto.isPending}
                disabled={deleteProfilePhoto.isPending}
                onPress={() => void removeProfilePhoto()}
                testID="button-confirm-remove-profile-photo"
              />
              <Button label="Cancelar" tone="quiet" onPress={() => setPhotoDeleteConfirmOpen(false)} testID="button-cancel-remove-profile-photo" />
            </>
          ) : photoPreviewOpen ? (
            <>
              <AppText variant="heading">Vista previa de tu foto</AppText>
              <View style={{ alignItems: 'center', paddingVertical: 12 }}>
                <Avatar name={account.nombre} size={264} photoObjectPath={account.fotoObjectPath} />
              </View>
              <Button
                label="Volver a opciones"
                icon="arrow-left"
                tone="quiet"
                onPress={() => {
                  setPhotoPreviewOpen(false);
                  setPhotoActionsOpen(true);
                }}
                testID="button-back-profile-photo-actions"
              />
              <Button
                label="Cerrar"
                tone="secondary"
                onPress={() => setPhotoPreviewOpen(false)}
                testID="button-close-profile-photo-preview"
              />
            </>
          ) : (
            <>
              <View style={{ gap: 3, marginBottom: 2 }}>
                <AppText variant="heading">Foto de perfil</AppText>
                <AppText variant="caption" style={{ color: colors.mutedForeground }}>
                  {account.fotoObjectPath ? 'Elegí qué querés hacer con tu imagen.' : 'Agregá una foto para identificar tu cuenta.'}
                </AppText>
              </View>
              <Button
                label="Ver imagen"
                icon="eye"
                disabled={!account.fotoObjectPath}
                onPress={() => {
                  setPhotoActionsOpen(false);
                  setPhotoPreviewOpen(true);
                }}
                testID="button-view-profile-photo"
              />
              <Button
                label={uploadingPhoto ? 'Guardando foto…' : 'Cambiar imagen'}
                icon="image"
                loading={uploadingPhoto || requestUploadUrl.isPending || updateProfilePhoto.isPending}
                disabled={uploadingPhoto || requestUploadUrl.isPending || updateProfilePhoto.isPending}
                onPress={() => void changeProfilePhoto()}
                testID="button-change-profile-photo"
              />
              <Button
                label="Eliminar imagen"
                icon="trash-2"
                tone="danger"
                disabled={!account.fotoObjectPath || uploadingPhoto || deleteProfilePhoto.isPending}
                onPress={() => {
                  setPhotoActionsOpen(false);
                  setPhotoDeleteConfirmOpen(true);
                }}
                testID="button-remove-profile-photo"
              />
              <Button label="Cancelar" tone="quiet" onPress={() => setPhotoActionsOpen(false)} testID="button-cancel-profile-photo-actions" />
            </>
          )}
        </Surface>
      </View>
    </Modal>
    </>
  );
}