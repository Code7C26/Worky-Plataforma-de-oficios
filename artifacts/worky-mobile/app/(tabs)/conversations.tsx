import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useListConversations } from '@workspace/api-client-react';
import { AppText, Avatar, Screen, StateMessage, formatShortDate } from '@/components/WorkyUI';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { createConversationOnPress, getConversationInboxQuery, getConversationRowPresentation } from '@/lib/conversation-inbox';

export default function ConversationsScreen() {
  const colors = useColors();
  const { account } = useAuth();
  const inboxQuery = getConversationInboxQuery(account?.rol);
  const conversations = useListConversations(
    inboxQuery.params,
    { query: inboxQuery.query },
  );
  const items = conversations.data ?? [];

  return (
    <Screen contentStyle={styles.screenContent}>
      <View style={styles.header}>
        <AppText variant="title">Mensajes</AppText>
        <AppText variant="caption" style={{ color: colors.mutedForeground }}>Tus conversaciones de Worky</AppText>
      </View>
      {conversations.isLoading ? (
        <StateMessage icon="message-circle" title="Cargando conversaciones" message="Tus mensajes van a aparecer acá." />
      ) : conversations.isError ? (
        <StateMessage icon="wifi-off" title="No cargaron los mensajes" message="Probá actualizar la bandeja." action={{ label: 'Reintentar', onPress: () => void conversations.refetch() }} />
      ) : items.length === 0 ? (
        <StateMessage icon="message-circle" title="Todavía no hay conversaciones" message="Cuando un trabajo tenga un profesional asignado, vas a poder coordinar por acá." />
      ) : (
        <View style={{ backgroundColor: colors.card, marginHorizontal: -16 }}>
          {items.map((conversation, index) => {
            const row = getConversationRowPresentation(conversation, new Date(), formatShortDate);
            return (
              <View key={conversation.changaId}>
                <Pressable
                  onPress={createConversationOnPress(conversation, (route) => router.push(route))}
                  accessibilityRole="button"
                  accessibilityLabel={row.accessibilityLabel}
                  accessibilityHint="Abre el chat del trabajo"
                  testID={`card-conversation-${conversation.changaId}`}
                  style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
                >
                  <Avatar name={row.name} size={54} photoObjectPath={row.photoObjectPath} />
                  <View style={styles.conversationCopy}>
                    <View style={styles.topLine}>
                      <View style={styles.nameAndCategory}>
                        <AppText variant="label" numberOfLines={1} style={styles.name}>{row.name}</AppText>
                        <View style={[styles.categoryPill, { backgroundColor: colors.muted }]}>
                          <AppText variant="caption" numberOfLines={1} style={[styles.category, { color: colors.mutedForeground }]}>
                            {row.category}
                          </AppText>
                        </View>
                      </View>
                      <AppText
                        variant="caption"
                        style={{ color: conversation.unread > 0 ? colors.messageUnread : colors.mutedForeground }}
                      >
                        {row.time}
                      </AppText>
                    </View>
                    <View style={styles.messageLine}>
                      <AppText variant="caption" numberOfLines={1} style={[styles.preview, { color: colors.mutedForeground }]}>
                        {row.preview}
                      </AppText>
                      {row.unreadBadge ? (
                        <View style={[styles.unreadBadge, { backgroundColor: colors.messageUnread }]}>
                          <AppText
                            variant="caption"
                            style={[styles.unreadCount, { color: colors.secondaryForeground }]}
                          >
                            {row.unreadBadge}
                          </AppText>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </Pressable>
                {index < items.length - 1 ? (
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { paddingHorizontal: 16 },
  header: { gap: 4, marginHorizontal: 4 },
  row: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  rowPressed: { opacity: 0.72 },
  conversationCopy: { minWidth: 0, flex: 1, gap: 5 },
  topLine: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  nameAndCategory: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, fontSize: 15, lineHeight: 20 },
  categoryPill: { maxWidth: 88, flexShrink: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 9 },
  category: { fontSize: 10, lineHeight: 14 },
  messageLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  preview: { minWidth: 0, flex: 1, fontSize: 13, lineHeight: 18 },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    flex: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  unreadCount: { fontFamily: 'DMSans_700Bold', fontSize: 11, lineHeight: 16 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 82 },
});