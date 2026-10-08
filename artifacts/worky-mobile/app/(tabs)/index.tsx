import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useListProfessionals } from '@workspace/api-client-react';
import { AppText, Avatar, BrandHeader, FeedbackPressable, Screen, Surface, TextField, StateMessage } from '@/components/WorkyUI';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

const categories = ['Todos', 'Plomería', 'Electricidad', 'Pintura', 'Gas'];

export default function DiscoverScreen() {
  const colors = useColors();
  const { account } = useAuth();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Todos');
  const isPartner = account?.rol === 'profesional';
  const searchTerm = search.trim() || (activeCategory === 'Todos' ? '' : activeCategory);
  const query = useListProfessionals(
    searchTerm ? { search: searchTerm, limit: 25 } : { limit: 25 },
    { query: { queryKey: ['/api/v1/profesionales', searchTerm, 25], staleTime: 30_000, enabled: !isPartner } },
  );
  const professionals = query.data ?? [];

  return (
    <Screen contentStyle={{ gap: 14 }}>
      <BrandHeader />

      {isPartner ? (
        <>
          <View style={{ gap: 3, paddingTop: 4 }}>
            <AppText
              variant="caption"
              style={{ color: colors.primary, letterSpacing: 1.1, textTransform: 'uppercase' }}
            >
              Partner
            </AppText>
            <AppText variant="heading">Oportunidades cerca tuyo</AppText>
          </View>
          <Pressable
            onPress={() => router.push('/(tabs)/jobs')}
            accessibilityRole="button"
            testID="button-home-opportunities"
            style={({ pressed }) => ({
              minHeight: 72,
              padding: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: colors.radius,
              opacity: pressed ? 0.82 : 1,
            })}
          >
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.muted,
              }}
            >
              <Feather name="briefcase" size={19} color={colors.secondary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="label">Ver oportunidades</AppText>
              <AppText variant="caption" style={{ color: colors.mutedForeground }}>
                Trabajos disponibles en tu zona
              </AppText>
            </View>
            <Feather name="chevron-right" size={19} color={colors.primary} />
          </Pressable>
          <Pressable onPress={() => router.push('/(tabs)/profile')} accessibilityRole="button">
            <Surface style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 13,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.muted,
                }}
              >
                <Feather name="user-check" size={19} color={colors.secondary} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <AppText variant="label">Tu perfil profesional</AppText>
                <AppText variant="caption" style={{ color: colors.mutedForeground }}>
                  Oficios, experiencia y disponibilidad
                </AppText>
              </View>
              <Feather name="chevron-right" size={19} color={colors.mutedForeground} />
            </Surface>
          </Pressable>
        </>
      ) : (
        <>
          <TextField
            label="¿Qué necesitás resolver?"
            value={search}
            onChangeText={(value) => {
              setSearch(value);
              setActiveCategory('Todos');
            }}
            placeholder="Plomería, electricidad, pintura…"
            autoCapitalize="none"
            returnKeyType="search"
            testID="input-professional-search"
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingRight: 20 }}
            accessibilityLabel="Filtrar por oficio"
          >
            {categories.map((category) => {
              const selected = activeCategory === category;
              return (
                <Pressable
                  key={category}
                  onPress={() => {
                    setSearch('');
                    setActiveCategory(category);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  testID={`filter-${category.toLowerCase().replaceAll('í', 'i')}`}
                  style={{
                    minHeight: 34,
                    justifyContent: 'center',
                    paddingHorizontal: 13,
                    borderWidth: 1,
                    borderColor: selected ? colors.secondary : colors.border,
                    borderRadius: 999,
                    backgroundColor: selected ? colors.secondary : colors.card,
                  }}
                >
                  <AppText
                    variant="caption"
                    style={{ color: selected ? colors.secondaryForeground : colors.mutedForeground }}
                  >
                    {category}
                  </AppText>
                </Pressable>
              );
            })}
          </ScrollView>
          <FeedbackPressable
            onPress={() => router.push('/job/new')}
            style={({ pressed }) => ({
              minHeight: 64,
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: colors.radius,
              paddingHorizontal: 14,
              paddingVertical: 10,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              opacity: pressed ? 0.82 : 1,
            })}
            accessibilityRole="button"
            testID="button-post-job-home"
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 14,
                backgroundColor: colors.muted,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Feather name="plus" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="label">Publicar un trabajo</AppText>
              <AppText variant="caption" style={{ color: colors.mutedForeground }}>
                Contanos qué necesitás resolver
              </AppText>
            </View>
            <Feather name="chevron-right" size={19} color={colors.mutedForeground} />
          </FeedbackPressable>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
            <AppText variant="heading">Profesionales cerca</AppText>
            <AppText variant="caption" style={{ color: colors.mutedForeground }}>
              {professionals.length} {professionals.length === 1 ? 'resultado' : 'resultados'}
            </AppText>
          </View>
        </>
      )}

      {isPartner ? null : query.isLoading ? (
        <StateMessage icon="search" title="Buscando perfiles" message="Estamos cargando profesionales disponibles." />
      ) : query.isError ? (
        <StateMessage
          icon="wifi-off"
          title="No cargó la búsqueda"
          message="No pudimos traer los perfiles. Probá de nuevo en unos segundos."
          action={{ label: 'Reintentar', onPress: () => void query.refetch() }}
        />
      ) : professionals.length === 0 ? (
        <StateMessage
          icon="search"
          title="Todavía no hay resultados"
          message={search || activeCategory !== 'Todos' ? 'Probá con otro oficio o nombre.' : 'No encontramos perfiles para mostrar por ahora.'}
        />
      ) : !isPartner ? (
        <View style={{ gap: 10 }}>
          {professionals.map((professional) => (
            <Pressable
              key={professional.id}
              onPress={() => router.push({ pathname: '/professional/[id]', params: { id: String(professional.id) } })}
              accessibilityRole="button"
              testID={`card-professional-${professional.id}`}
            >
              <Surface style={{ gap: 11, padding: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                  <Avatar name={professional.usuario.nombre} photoObjectPath={professional.usuario.fotoObjectPath} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <AppText variant="heading" numberOfLines={1}>{professional.usuario.nombre}</AppText>
                    <AppText variant="caption" style={{ color: colors.mutedForeground }}>
                      {professional.oficio} · {professional.categoria}
                    </AppText>
                  </View>
                  {professional.verificado ? <Feather name="check-circle" size={19} color={colors.primary} /> : null}
                </View>
                <AppText numberOfLines={2} style={{ color: colors.mutedForeground }}>
                  {professional.about || 'Perfil profesional en Worky.'}
                </AppText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Feather name="star" size={14} color={colors.primary} />
                    <AppText variant="label">{professional.rating.toFixed(1)}</AppText>
                    <AppText variant="caption" style={{ color: colors.mutedForeground }}>
                      ({professional.reviewsCount})
                    </AppText>
                  </View>
                  <AppText variant="caption" style={{ color: colors.mutedForeground }}>
                    {professional.completedJobs} trabajos
                  </AppText>
                  {professional.distanceKm != null ? (
                    <AppText variant="caption" style={{ color: colors.mutedForeground }}>
                      {professional.distanceKm.toFixed(1)} km
                    </AppText>
                  ) : null}
                  <View style={{ flex: 1 }} />
                  <AppText variant="label" style={{ color: colors.secondary }}>Ver perfil</AppText>
                </View>
              </Surface>
            </Pressable>
          ))}
        </View>
      ) : null}

    </Screen>
  );
}
