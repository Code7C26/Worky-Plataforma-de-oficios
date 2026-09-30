import React, { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useCreateJob } from '@workspace/api-client-react';
import { AppText, Button, Screen, TextField } from '@/components/WorkyUI';
import { useColors } from '@/hooks/useColors';

export default function NewJobScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ professionalId?: string }>();
  const professionalId = params.professionalId ? Number(params.professionalId) : null;
  const createJob = useCreateJob();
  const [category, setCategory] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [price, setPrice] = useState('');
  const [detail, setDetail] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    const amount = Number(price.replace(',', '.'));
    if (category.trim().length < 2 || !address.trim() || !city.trim() || !Number.isFinite(amount) || amount < 0 || detail.trim().length < 3) {
      setError('Completá oficio, ubicación, presupuesto y una descripción de al menos 3 caracteres.');
      return;
    }
    setError('');
    try {
      await createJob.mutateAsync({
        data: {
          categoria: category.trim(),
          ubicacion: { direccionTexto: address.trim(), ciudad: city.trim(), provincia: province.trim() || undefined },
          precioOfrecido: amount,
          detalle: detail.trim(),
          profesionalId: professionalId && Number.isInteger(professionalId) ? professionalId : null,
        },
      });
      router.replace('/(tabs)/jobs');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No pudimos publicar el trabajo. Revisá los datos e intentá otra vez.');
    }
  };

  return (
    <Screen>
      <AppText variant="caption" style={{ color: colors.primary, letterSpacing: 1.3, textTransform: 'uppercase' }}>Nueva solicitud</AppText>
      <AppText variant="title">Publicá un trabajo</AppText>
      <AppText style={{ color: colors.mutedForeground }}>
        Contá qué necesitás y los profesionales podrán responderte.
      </AppText>
      <View style={{ gap: 14 }}>
        <TextField label="Oficio o categoría" value={category} onChangeText={setCategory} placeholder="Ej. Plomería" autoCapitalize="words" testID="input-job-category" />
        <TextField label="Dirección o zona" value={address} onChangeText={setAddress} placeholder="Calle y altura o barrio" autoCapitalize="words" testID="input-job-address" />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TextField label="Ciudad" value={city} onChangeText={setCity} placeholder="Ciudad" autoCapitalize="words" style={{ flex: 1 }} testID="input-job-city" />
          <TextField label="Provincia (opcional)" value={province} onChangeText={setProvince} placeholder="Provincia" autoCapitalize="words" style={{ flex: 1 }} />
        </View>
        <TextField label="Presupuesto ofrecido (ARS)" value={price} onChangeText={setPrice} placeholder="15000" keyboardType="decimal-pad" testID="input-job-price" />
        <TextField label="Descripción" value={detail} onChangeText={setDetail} placeholder="Describí el trabajo, el problema y cualquier detalle útil…" multiline style={{ minHeight: 116, textAlignVertical: 'top' }} testID="input-job-detail" />
      </View>
      {professionalId ? (
        <AppText variant="caption" style={{ color: colors.secondary }}>La solicitud se asignará al profesional elegido.</AppText>
      ) : null}
      {error ? <AppText variant="caption" style={{ color: colors.destructive }}>{error}</AppText> : null}
      <Button label="Publicar trabajo" icon="arrow-up-right" loading={createJob.isPending} onPress={() => void submit()} testID="button-publish-job" />
      <Button label="Cancelar" tone="quiet" onPress={() => router.back()} />
    </Screen>
  );
}