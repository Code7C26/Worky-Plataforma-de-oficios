import React, { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  getGetJobQueryKey,
  getListProfessionalsQueryKey,
  useGetJob,
  useListProfessionals,
  useUpdateJob,
  type JobUpdate,
} from '@workspace/api-client-react';
import { resolveWorkyCategory } from '@workspace/worky-domain';
import { AppText, Avatar, BrandHeader, Button, Screen, StateMessage, Surface, TextField } from '@/components/WorkyUI';
import { useColors } from '@/hooks/useColors';

function requestMessage(reason: unknown) {
  if (reason && typeof reason === 'object') {
    const data = (reason as { data?: { error?: unknown } }).data;
    if (typeof data?.error === 'string') return data.error;
  }
  return reason instanceof Error ? reason.message : 'No pudimos guardar los cambios.';
}

function withoutOriginalTrade(detail: string | null | undefined) {
  return (detail ?? '').replace(/^Oficio solicitado:\s*.+?\n{2}/, '').trim();
}

export default function EditJobScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ id?: string }>();
  const jobId = Number(params.id);
  const validId = Number.isInteger(jobId) && jobId > 0;
  const job = useGetJob(jobId, {
    query: { queryKey: getGetJobQueryKey(jobId), enabled: validId, refetchOnMount: 'always' },
  });
  const updateJob = useUpdateJob();
  const [category, setCategory] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [price, setPrice] = useState('');
  const [detail, setDetail] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'mercado_pago' | 'efectivo'>('mercado_pago');
  const [professionalId, setProfessionalId] = useState('none');
  const [error, setError] = useState('');
  const categoryResolution = resolveWorkyCategory(category);
  const professionalParams = categoryResolution ? { categoria: categoryResolution.category, limit: 50 } : undefined;
  const professionals = useListProfessionals(professionalParams, {
    query: {
      queryKey: getListProfessionalsQueryKey(professionalParams),
      enabled: Boolean(categoryResolution),
      staleTime: 30_000,
    },
  });

  useEffect(() => {
    if (!job.data) return;
    const originalTrade = job.data.detalle?.match(/^Oficio solicitado:\s*(.+?)\n{2}/)?.[1];
    setCategory(originalTrade || job.data.categoria);
    setAddress(job.data.ubicacion?.direccionTexto ?? '');
    setCity(job.data.ubicacion?.ciudad ?? '');
    setProvince(job.data.ubicacion?.provincia ?? '');
    setPrice(String(job.data.precioOfrecido));
    setDetail(withoutOriginalTrade(job.data.detalle));
    setPaymentMethod(job.data.paymentMethod);
    setProfessionalId(job.data.profesionalId ? String(job.data.profesionalId) : 'none');
  }, [job.data]);

  const persist = async () => {
    const amount = Number(price.replace(',', '.'));
    if (
      !categoryResolution
      || address.trim().length < 3
      || city.trim().length < 2
      || !Number.isFinite(amount)
      || amount < 0
      || detail.trim().length < 3
    ) {
      setError('Completá oficio, dirección, ciudad, presupuesto y una descripción de al menos 3 caracteres.');
      return;
    }
    setError('');
    const cleanDetail = withoutOriginalTrade(detail);
    const updatedDetail = categoryResolution.preserveOriginalTrade
      ? `Oficio solicitado: ${categoryResolution.original}\n\n${cleanDetail}`
      : cleanDetail;
    const data: JobUpdate = {
      categoria: categoryResolution.category,
      ubicacion: {
        ...job.data?.ubicacion,
        direccionTexto: address.trim(),
        ciudad: city.trim(),
        provincia: province.trim() || undefined,
      },
      precioOfrecido: amount,
      detalle: updatedDetail,
      profesionalId: professionalId === 'none' ? null : Number(professionalId),
      paymentMethod,
    };
    try {
      await updateJob.mutateAsync({ id: jobId, data });
      Alert.alert('Cambios guardados', professionalId === 'none'
        ? 'La publicación quedó actualizada.'
        : 'El trabajo quedó asignado al profesional elegido.');
      await router.replace('/(tabs)/jobs');
    } catch (reason) {
      setError(requestMessage(reason));
    }
  };

  const submit = () => {
    if (professionalId === 'none') {
      void persist();
      return;
    }
    Alert.alert(
      'Asignar profesional',
      'Al guardar, el trabajo pasará a “aceptada” y Worky avisará al profesional elegido.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Guardar y asignar', onPress: () => void persist() },
      ],
    );
  };

  if (!validId) {
    return (
      <Screen>
        <StateMessage icon="briefcase" title="Trabajo no disponible" message="Volvé a tus trabajos y elegí una publicación válida." action={{ label: 'Volver', onPress: () => router.replace('/(tabs)/jobs') }} />
      </Screen>
    );
  }
  if (job.isLoading) {
    return <Screen><StateMessage icon="briefcase" title="Cargando publicación" message="Estamos buscando los datos del trabajo." /></Screen>;
  }
  if (job.isError || !job.data) {
    return <Screen><StateMessage icon="wifi-off" title="No cargó el trabajo" message="Puede que ya no esté disponible para editar." action={{ label: 'Volver a mis trabajos', onPress: () => router.replace('/(tabs)/jobs') }} /></Screen>;
  }
  if (job.data.estado !== 'publicada' || job.data.profesionalId !== null) {
    return (
      <Screen>
        <StateMessage icon="lock" title="Esta publicación ya no se puede editar" message="Worky permite editarla mientras siga publicada y todavía no tenga un profesional asignado. El historial se conserva." action={{ label: 'Volver a mis trabajos', onPress: () => router.replace('/(tabs)/jobs') }} />
      </Screen>
    );
  }

  const matchingProfessionals = professionals.data ?? [];

  return (
    <Screen>
      <BrandHeader onPress={() => router.replace('/')} />
      <AppText variant="caption" style={{ color: colors.primary, letterSpacing: 1.3, textTransform: 'uppercase' }}>Mis trabajos</AppText>
      <AppText variant="title">Editar publicación</AppText>
      <AppText style={{ color: colors.mutedForeground }}>
        Actualizá el oficio, los datos del trabajo o elegí un profesional habilitado.
      </AppText>
      <Surface style={{ gap: 14 }}>
        <TextField
          label="Oficio o categoría"
          value={category}
          onChangeText={(value) => { setCategory(value); setProfessionalId('none'); }}
          placeholder="Ej. Albañil, plomero o electricista"
          autoCapitalize="words"
          testID="input-edit-job-category"
        />
        {categoryResolution ? (
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>
            {categoryResolution.preserveOriginalTrade
              ? `Se publicará como “${categoryResolution.category}” y se conservará “${categoryResolution.original}” en la descripción.`
              : `Se publicará como “${categoryResolution.category}”.`}
          </AppText>
        ) : null}
        <TextField label="Dirección o zona" value={address} onChangeText={setAddress} placeholder="Calle y altura o barrio" autoCapitalize="words" testID="input-edit-job-address" />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TextField label="Ciudad" value={city} onChangeText={setCity} placeholder="Ciudad" autoCapitalize="words" style={{ flex: 1 }} testID="input-edit-job-city" />
          <TextField label="Provincia (opcional)" value={province} onChangeText={setProvince} placeholder="Provincia" autoCapitalize="words" style={{ flex: 1 }} />
        </View>
        <TextField label="Presupuesto ofrecido (ARS)" value={price} onChangeText={setPrice} placeholder="15000" keyboardType="decimal-pad" testID="input-edit-job-price" />
        <TextField label="Descripción" value={detail} onChangeText={setDetail} placeholder="Describí el trabajo y cualquier detalle útil…" multiline style={{ minHeight: 116, textAlignVertical: 'top' }} testID="input-edit-job-detail" />
        <View style={{ gap: 8 }}>
          <AppText variant="label">Medio de pago</AppText>
          {([
            ['mercado_pago', 'Mercado Pago', 'Se finaliza cuando Worky recibe la confirmación del pago.'],
            ['efectivo', 'Efectivo', 'Se finaliza cuando ambas partes confirman el pago.'],
          ] as const).map(([value, title, copy]) => {
            const selected = paymentMethod === value;
            return (
              <Pressable
                key={value}
                onPress={() => setPaymentMethod(value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                testID={`option-edit-job-payment-${value}`}
                style={{ gap: 3, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, borderRadius: 14, padding: 12, backgroundColor: selected ? colors.muted : colors.card }}
              >
                <AppText variant="label">{title}</AppText>
                <AppText variant="caption" style={{ color: colors.mutedForeground }}>{copy}</AppText>
              </Pressable>
            );
          })}
        </View>
      </Surface>
      <Surface style={{ gap: 10 }}>
        <View style={{ gap: 4 }}>
          <AppText variant="heading">Profesional</AppText>
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>
            Podés dejar la publicación abierta o asignarla a una persona habilitada para este oficio.
          </AppText>
        </View>
        <Pressable
          onPress={() => setProfessionalId('none')}
          accessibilityRole="radio"
          accessibilityState={{ checked: professionalId === 'none' }}
          testID="option-edit-job-unassigned"
          style={{ borderWidth: 1, borderColor: professionalId === 'none' ? colors.primary : colors.border, borderRadius: 14, padding: 12, backgroundColor: professionalId === 'none' ? colors.muted : colors.card }}
        >
          <AppText variant="label">Sin asignar · seguir recibiendo respuestas</AppText>
        </Pressable>
        {professionals.isLoading ? (
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>Buscando profesionales habilitados…</AppText>
        ) : professionals.isError ? (
          <AppText variant="caption" style={{ color: colors.destructive }}>No pudimos cargar profesionales. Podés guardar la publicación sin asignarla.</AppText>
        ) : matchingProfessionals.length ? matchingProfessionals.map((professional) => {
          const selected = professionalId === String(professional.usuarioId);
          return (
            <Pressable
              key={professional.usuarioId}
              onPress={() => setProfessionalId(String(professional.usuarioId))}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              testID={`option-edit-job-professional-${professional.usuarioId}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, borderRadius: 14, padding: 12, backgroundColor: selected ? colors.muted : colors.card }}
            >
              <Avatar name={professional.usuario.nombre} size={38} photoObjectPath={professional.usuario.fotoObjectPath} />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="label">{professional.usuario.nombre}</AppText>
                <AppText variant="caption" style={{ color: colors.mutedForeground }}>{professional.oficio} · {professional.categoria}</AppText>
              </View>
              <AppText variant="caption" style={{ color: selected ? colors.primary : colors.mutedForeground }}>{selected ? 'Elegido' : 'Elegir'}</AppText>
            </Pressable>
          );
        }) : categoryResolution ? (
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>No hay profesionales habilitados para esta categoría. La publicación puede quedar sin asignar.</AppText>
        ) : null}
      </Surface>
      {professionalId !== 'none' ? (
        <AppText variant="caption" style={{ color: colors.mutedForeground }}>
          Al guardar, el trabajo se asigna y cambia al estado “aceptada”.
        </AppText>
      ) : null}
      {error ? <AppText variant="caption" accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</AppText> : null}
      <Button
        label={professionalId === 'none' ? 'Guardar cambios' : 'Guardar y asignar'}
        icon="check"
        tone="secondary"
        loading={updateJob.isPending}
        onPress={submit}
        style={{ width: '100%', height: 52 }}
        testID="button-save-job-edits"
      />
      <Button label="Cancelar" tone="quiet" onPress={() => router.back()} style={{ width: '100%', height: 52 }} />
    </Screen>
  );
}
