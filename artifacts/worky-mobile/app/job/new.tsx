import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useCreateJob } from '@workspace/api-client-react';
import { resolveWorkyCategory } from '@workspace/worky-domain';
import { AppText, BrandHeader, Button, Screen, TextField } from '@/components/WorkyUI';
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
  const [paymentMethod, setPaymentMethod] = useState<'mercado_pago' | 'efectivo'>('mercado_pago');
  const [error, setError] = useState('');
  const categoryResolution = resolveWorkyCategory(category);

  const submit = async () => {
    const amount = Number(price.replace(',', '.'));
    if (category.trim().length < 2 || !categoryResolution || !address.trim() || !city.trim() || !Number.isFinite(amount) || amount < 0 || detail.trim().length < 3) {
      setError('Completá oficio, ubicación, presupuesto y una descripción de al menos 3 caracteres.');
      return;
    }
    setError('');
    try {
      const jobDetail = categoryResolution.preserveOriginalTrade
        ? `Oficio solicitado: ${categoryResolution.original}\n\n${detail.trim()}`
        : detail.trim();
      await createJob.mutateAsync({
        data: {
          categoria: categoryResolution.category,
          ubicacion: { direccionTexto: address.trim(), ciudad: city.trim(), provincia: province.trim() || undefined },
          precioOfrecido: amount,
          detalle: jobDetail,
          profesionalId: professionalId && Number.isInteger(professionalId) ? professionalId : null,
          paymentMethod,
        },
      });
      router.replace('/(tabs)/jobs');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No pudimos publicar el trabajo. Revisá los datos e intentá otra vez.');
    }
  };

  return (
    <Screen>
      <BrandHeader onPress={() => router.replace('/')} />
      <AppText variant="caption" style={{ color: colors.primary, letterSpacing: 1.3, textTransform: 'uppercase' }}>Nueva solicitud</AppText>
      <AppText variant="title">Publicá un trabajo</AppText>
      <AppText style={{ color: colors.mutedForeground }}>
        Contá qué necesitás y los profesionales podrán responderte.
      </AppText>
      <View style={{ gap: 14 }}>
        <TextField label="Oficio o categoría" value={category} onChangeText={setCategory} placeholder="Ej. Albañil, plomero o electricista" autoCapitalize="words" testID="input-job-category" />
        {category.trim().length >= 2 && categoryResolution ? (
          <AppText variant="caption" style={{ color: colors.mutedForeground }} testID="job-category-normalization-hint">
            {categoryResolution.preserveOriginalTrade
              ? `Se publicará en “Otro” y se conservará “${categoryResolution.original}” en la descripción.`
              : `Se publicará como “${categoryResolution.category}”.`}
          </AppText>
        ) : null}
        <TextField label="Dirección o zona" value={address} onChangeText={setAddress} placeholder="Calle y altura o barrio" autoCapitalize="words" testID="input-job-address" />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TextField label="Ciudad" value={city} onChangeText={setCity} placeholder="Ciudad" autoCapitalize="words" style={{ flex: 1 }} testID="input-job-city" />
          <TextField label="Provincia (opcional)" value={province} onChangeText={setProvince} placeholder="Provincia" autoCapitalize="words" style={{ flex: 1 }} />
        </View>
        <TextField label="Presupuesto ofrecido (ARS)" value={price} onChangeText={setPrice} placeholder="15000" keyboardType="decimal-pad" testID="input-job-price" />
        <View style={{ gap: 8 }}>
          <AppText variant="label">Medio de pago</AppText>
          {([
            ['mercado_pago', 'Mercado Pago', 'El trabajo finaliza cuando Mercado Pago confirma el pago.'],
            ['efectivo', 'Efectivo', 'Cliente y profesional confirman el pago desde Worky.'],
          ] as const).map(([value, title, copy]) => {
            const selected = paymentMethod === value;
            return (
              <Pressable
                key={value}
                onPress={() => setPaymentMethod(value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                testID={`option-job-payment-${value}`}
                style={{ gap: 3, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, borderRadius: 14, padding: 12, backgroundColor: selected ? colors.muted : colors.card }}
              >
                <AppText variant="label">{title}</AppText>
                <AppText variant="caption" style={{ color: colors.mutedForeground }}>{copy}</AppText>
              </Pressable>
            );
          })}
        </View>
        <TextField label="Descripción" value={detail} onChangeText={setDetail} placeholder="Describí el trabajo, el problema y cualquier detalle útil…" multiline style={{ minHeight: 116, textAlignVertical: 'top' }} testID="input-job-detail" />
      </View>
      {professionalId ? (
        <AppText variant="caption" style={{ color: colors.foreground }}>La solicitud se asignará al profesional elegido.</AppText>
      ) : null}
      {error ? <AppText variant="caption" style={{ color: colors.destructive }}>{error}</AppText> : null}
      <Button
        label="Publicar trabajo"
        icon="check"
        tone="secondary"
        loading={createJob.isPending}
        onPress={() => void submit()}
        style={{ width: '100%', height: 52 }}
        testID="button-publish-job"
      />
      <Button label="Cancelar" tone="quiet" onPress={() => router.back()} style={{ width: '100%', height: 52 }} />
    </Screen>
  );
}