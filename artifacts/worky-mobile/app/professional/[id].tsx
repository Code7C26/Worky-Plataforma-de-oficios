import React from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useGetProfessional, useGetProfessionalReputation } from '@workspace/api-client-react';
import { AppText, Avatar, Button, Screen, StateMessage, Surface, formatCurrency } from '@/components/WorkyUI';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function ProfessionalDetailsScreen() {
  const colors = useColors();
  const { account } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id);
  const profile = useGetProfessional(id, { query: { queryKey: [`/api/v1/profesionales/${id}`], enabled: Number.isInteger(id) && id > 0 } });
  const reputation = useGetProfessionalReputation(id, { query: { queryKey: [`/api/v1/profesionales/${id}/reputacion`], enabled: Number.isInteger(id) && id > 0, staleTime: 30_000 } });

  if (profile.isLoading) {
    return <Screen><StateMessage icon="user" title="Cargando perfil" message="Estamos buscando la información del profesional." /></Screen>;
  }
  if (profile.isError || !profile.data) {
    return <Screen><StateMessage icon="wifi-off" title="No encontramos este perfil" message="Puede que ya no esté disponible." action={{ label: 'Volver a buscar', onPress: () => router.back() }} /></Screen>;
  }

  const professional = profile.data;

  return (
    <Screen>
      <Pressable onPress={() => router.back()} style={{ alignSelf: 'flex-start', padding: 7, marginLeft: -7 }} accessibilityRole="button">
        <Feather name="arrow-left" size={22} color={colors.foreground} />
      </Pressable>
      <Surface style={{ alignItems: 'center', paddingVertical: 24 }}>
        <Avatar name={professional.usuario.nombre} size={76} photoObjectPath={professional.usuario.fotoObjectPath} />
        <AppText variant="title" style={{ textAlign: 'center', marginTop: 3 }}>{professional.usuario.nombre}</AppText>
        <AppText variant="label" style={{ color: colors.mutedForeground }}>{professional.oficio} · {professional.categoria}</AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 }}>
          <Feather name="star" size={17} color={colors.primary} />
          <AppText variant="label">{professional.rating.toFixed(1)}</AppText>
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>({professional.reviewsCount} opiniones)</AppText>
        </View>
        {professional.verificado ? <AppText variant="caption" style={{ color: colors.secondary, marginTop: 4 }}>Identidad verificada</AppText> : null}
      </Surface>
      {account?.rol !== 'profesional' ? (
        <Button
          label="Publicar trabajo para este profesional"
          icon="plus"
          onPress={() => router.push({ pathname: '/job/new', params: { professionalId: String(professional.usuarioId) } })}
          testID="button-request-professional"
        />
      ) : null}
      <Surface>
        <AppText variant="heading">Sobre el profesional</AppText>
        <AppText style={{ color: colors.mutedForeground }}>{professional.about || 'Todavía no agregó una presentación.'}</AppText>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, marginTop: 3 }}>
          <View style={{ gap: 3 }}>
            <AppText variant="caption" style={{ color: colors.mutedForeground }}>Experiencia</AppText>
            <AppText variant="label">{professional.experienciaAnios} años</AppText>
          </View>
          <View style={{ gap: 3 }}>
            <AppText variant="caption" style={{ color: colors.mutedForeground }}>Trabajos completos</AppText>
            <AppText variant="label">{professional.completedJobs}</AppText>
          </View>
          <View style={{ gap: 3 }}>
            <AppText variant="caption" style={{ color: colors.mutedForeground }}>Referencia</AppText>
            <AppText variant="label">{formatCurrency(professional.precioReferencia)}</AppText>
          </View>
        </View>
      </Surface>
      {professional.skills.length ? (
        <View style={{ gap: 10 }}>
          <AppText variant="heading">Especialidades</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {professional.skills.map((skill) => (
              <View key={skill} style={{ backgroundColor: colors.muted, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 8 }}>
                <AppText variant="caption">{skill}</AppText>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <View style={{ gap: 10 }}>
        <AppText variant="heading">Opiniones y recomendaciones</AppText>
        {reputation.isLoading ? (
          <StateMessage icon="star" title="Cargando opiniones" message="Un momento." />
        ) : reputation.isError ? (
          <StateMessage icon="wifi-off" title="No cargaron las opiniones" message="El perfil sigue disponible; probá actualizar." action={{ label: 'Reintentar', onPress: () => void reputation.refetch() }} />
        ) : (
          <>
            {(reputation.data?.reviews ?? []).slice(0, 6).map((review) => (
              <Surface key={`review-${review.id}`}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                  <AppText variant="label">{review.autor.nombre}</AppText>
                  <View style={{ flexDirection: 'row', gap: 3 }}>
                    {Array.from({ length: Math.max(0, Math.min(5, Math.round(review.rating))) }, (_, index) => (
                      <Feather key={index} name="star" size={13} color={colors.primary} />
                    ))}
                  </View>
                </View>
                {review.comentario ? <AppText variant="caption" style={{ color: colors.mutedForeground }}>{review.comentario}</AppText> : null}
              </Surface>
            ))}
            {(reputation.data?.recommendations ?? []).slice(0, 4).map((recommendation) => (
              <Surface key={`recommendation-${recommendation.id}`}>
                <AppText variant="label">{recommendation.autor.nombre} recomendó a este profesional</AppText>
                {recommendation.comentario ? <AppText variant="caption" style={{ color: colors.mutedForeground }}>{recommendation.comentario}</AppText> : null}
              </Surface>
            ))}
            {(reputation.data?.reviews.length ?? 0) === 0 && (reputation.data?.recommendations.length ?? 0) === 0 ? (
              <AppText style={{ color: colors.mutedForeground }}>Todavía no hay opiniones publicadas.</AppText>
            ) : null}
          </>
        )}
      </View>
    </Screen>
  );
}