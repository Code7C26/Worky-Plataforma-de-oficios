import React from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useListConversations } from '@workspace/api-client-react';
import { AppText, Avatar, Screen, StateMessage, Surface, formatShortDate } from '@/components/WorkyUI';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function ConversationsScreen() {
  const colors = useColors();
  const { account } = useAuth();
  const role = account?.rol === 'profesional' ? 'profesional' : 'cliente';
  const conversations = useListConversations(
    { rol: role },
    { query: { queryKey: ['/api/v1/conversaciones', role], staleTime: 10_000, refetchInterval: 15_000 } },
  );
  const items = conversations.data ?? [];

  return (
    <Screen>
      <View style={{ gap: 7 }}>
        <AppText variant="caption" style={{ color: colors.primary, letterSpacing: 1.3, textTransform: 'uppercase' }}>En contacto</AppText>
        <AppText variant="title">Mensajes</AppText>
        <AppText style={{ color: colors.mutedForeground }}>Coordiná cada trabajo desde una conversación.</AppText>
      </View>
      {conversations.isLoading ? (
        <StateMessage icon="message-circle" title="Cargando conversaciones" message="Tus mensajes van a aparecer acá." />
      ) : conversations.isError ? (
        <StateMessage icon="wifi-off" title="No cargaron los mensajes" message="Probá actualizar la bandeja." action={{ label: 'Reintentar', onPress: () => void conversations.refetch() }} />
      ) : items.length === 0 ? (
        <StateMessage icon="message-circle" title="Todavía no hay conversaciones" message="Cuando un trabajo tenga un profesional asignado, vas a poder coordinar por acá." />
      ) : (
        <View style={{ gap: 10 }}>
          {items.map((conversation) => {
            const name = conversation.interlocutor?.nombre || 'Conversación';
            const photoObjectPath = conversation.interlocutor?.fotoObjectPath;
            return (
              <Pressable
                key={conversation.changaId}
                onPress={() => router.push({
                  pathname: '/chat/[changaId]',
                  params: {
                    changaId: String(conversation.changaId),
                    category: conversation.categoria,
                    participant: name,
                    ...(photoObjectPath ? { participantPhotoPath: photoObjectPath } : {}),
                  },
                })}
                accessibilityRole="button"
                testID={`card-conversation-${conversation.changaId}`}
              >
                <Surface style={{ flexDirection: 'row', alignItems: 'center', padding: 14 }}>
                  <Avatar name={name} photoObjectPath={photoObjectPath} />
                  <View style={{ flex: 1, gap: 4, marginLeft: 11 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                      <AppText variant="label" numberOfLines={1} style={{ flex: 1 }}>{name}</AppText>
                      <AppText variant="caption" style={{ color: colors.mutedForeground }}>{formatShortDate(conversation.ultimoMensaje?.createdAt || conversation.updatedAt)}</AppText>
                    </View>
                    <AppText variant="caption" style={{ color: colors.primary }}>{conversation.categoria}</AppText>
                    <AppText variant="caption" numberOfLines={1} style={{ color: colors.mutedForeground }}>
                      {conversation.ultimoMensaje?.texto || 'Empezá la conversación'}
                    </AppText>
                  </View>
                  {conversation.unread > 0 ? (
                    <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginLeft: 8 }}>
                      <AppText variant="caption" style={{ color: colors.primaryForeground, fontFamily: 'DMSans_700Bold' }}>{conversation.unread}</AppText>
                    </View>
                  ) : (
                    <Feather name="chevron-right" size={18} color={colors.mutedForeground} style={{ marginLeft: 5 }} />
                  )}
                </Surface>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}