import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import {
  useCreateMyProfessionalProfile,
  useGetMyProfessionalProfile,
  useUpdateMyAccount,
  useUpdateMyProfessionalProfile,
  type ProfessionalProfileInput,
} from '@workspace/api-client-react';
import { AppText, Avatar, Button, Screen, StateMessage, Surface, TextField, formatCurrency } from '@/components/WorkyUI';
import { RoleSwitcher, type WorkyRole } from '@/components/RoleSwitcher';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useQueryClient } from '@tanstack/react-query';

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
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const price = Number(rate);
    if (trade.trim().length < 2 || !category.trim() || !Number.isFinite(price) || price < 0) {
      setError('Completá oficio, categoría y un precio de referencia válido.');
      return;
    }
    const payload: ProfessionalProfileInput = {
      oficio: trade.trim(),
      categoria: category.trim(),
      precioReferencia: price,
      experienciaAnios: Math.max(0, Number(experience) || 0),
      about: about.trim() || null,
      skills: skills.split(',').map((value) => value.trim()).filter(Boolean),
      disponible: initial?.disponible ?? true,
    };
    setError('');
    setSaved(false);
    try {
      if (initial) await update.mutateAsync({ data: payload });
      else await create.mutateAsync({ data: payload });
      await queryClient.invalidateQueries();
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No pudimos guardar tu perfil.');
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
      <TextField label="Presentación" value={about} onChangeText={setAbout} placeholder="Contá brevemente tu experiencia" multiline style={{ minHeight: 94, textAlignVertical: 'top' }} />
      <TextField label="Especialidades (separadas por coma)" value={skills} onChangeText={setSkills} placeholder="Instalaciones, reparaciones…" />
      {saved ? <AppText variant="caption" style={{ color: colors.secondary }}>Perfil guardado.</AppText> : null}
      {error ? <AppText variant="caption" style={{ color: colors.destructive }}>{error}</AppText> : null}
      <Button label="Guardar perfil" icon="check" loading={create.isPending || update.isPending} onPress={() => void save()} />
    </Surface>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { account, signOut, setAccount, switchRole } = useAuth();
  const [name, setName] = useState(account?.nombre ?? '');
  const [phone, setPhone] = useState(account?.telefono ?? '');
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState(false);
  const [roleError, setRoleError] = useState('');
  const [roleNotice, setRoleNotice] = useState('');
  const [switchingRole, setSwitchingRole] = useState(false);
  const updateAccount = useUpdateMyAccount();
  const professional = useGetMyProfessionalProfile({
    query: { queryKey: ['/api/v1/partner-profile/me'], enabled: account?.rol === 'profesional', staleTime: 30_000 },
  });

  const saveAccount = async () => {
    if (name.trim().length < 2) {
      setError('El nombre debe tener al menos 2 caracteres.');
      return;
    }
    setError('');
    setUpdated(false);
    try {
      const updatedAccount = await updateAccount.mutateAsync({
        data: { nombre: name.trim(), telefono: phone.trim() || null },
      });
      setAccount(updatedAccount);
      setUpdated(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No pudimos guardar tus datos.');
    }
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
    <Screen>
      <View style={{ gap: 7 }}>
        <AppText variant="caption" style={{ color: colors.primary, letterSpacing: 1.3, textTransform: 'uppercase' }}>Tu cuenta</AppText>
        <AppText variant="title">Perfil</AppText>
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
          {roleNotice ? <AppText variant="caption" style={{ color: colors.secondary }}>{roleNotice}</AppText> : null}
          {roleError ? <AppText variant="caption" style={{ color: colors.destructive }}>{roleError}</AppText> : null}
        </Surface>
      ) : null}
      <Surface>
        <AppText variant="heading">Datos personales</AppText>
        <TextField label="Nombre" value={name} onChangeText={setName} autoComplete="name" />
        <TextField label="Teléfono" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
        {updated ? <AppText variant="caption" style={{ color: colors.secondary }}>Cambios guardados.</AppText> : null}
        {error ? <AppText variant="caption" style={{ color: colors.destructive }}>{error}</AppText> : null}
        <Button label="Guardar cambios" icon="check" loading={updateAccount.isPending} onPress={() => void saveAccount()} />
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
      <Button label="Cerrar sesión" tone="quiet" icon="log-out" onPress={confirmSignOut} testID="button-logout" />
    </Screen>
  );
}