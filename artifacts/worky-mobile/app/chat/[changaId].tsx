import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { markMessagesRead, useCreateMessage, useListMessages } from '@workspace/api-client-react';
import { AppText, Avatar, StateMessage } from '@/components/WorkyUI';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { account } = useAuth();
  const params = useLocalSearchParams<{ changaId?: string; category?: string; participant?: string; participantPhotoPath?: string }>();
  const changaId = Number(params.changaId);
  const category = typeof params.category === 'string' ? params.category : 'Trabajo';
  const participant = typeof params.participant === 'string' ? params.participant : 'Conversación';
  const participantPhotoPath = typeof params.participantPhotoPath === 'string' ? params.participantPhotoPath : undefined;
  const messages = useListMessages(changaId, { query: { queryKey: [`/api/v1/chats/${changaId}/mensajes`], enabled: Number.isInteger(changaId) && changaId > 0, refetchInterval: 8_000 } });
  const createMessage = useCreateMessage();
  const [text, setText] = useState('');
  const [sendError, setSendError] = useState('');
  const allMessages = useMemo(() => [...(messages.data ?? [])].reverse(), [messages.data]);

  useEffect(() => {
    if (!Number.isInteger(changaId) || changaId < 1) return;
    void markMessagesRead(changaId)
      .then(() => queryClient.invalidateQueries())
      .catch(() => undefined);
  }, [changaId, queryClient]);

  const send = async () => {
    const value = text.trim();
    if (!value || createMessage.isPending) return;
    Keyboard.dismiss();
    setSendError('');
    try {
      await createMessage.mutateAsync({ changaId, data: { texto: value } });
      setText('');
      await queryClient.invalidateQueries();
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : 'No pudimos enviar el mensaje.');
    }
  };

  const topInset = insets.top || (Platform.OS === 'web' ? 67 : 0);
  const bottomInset = insets.bottom || (Platform.OS === 'web' ? 34 : 0);

  if (!Number.isInteger(changaId) || changaId < 1) {
    return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.background }}><StateMessage icon="message-circle" title="Conversación no disponible" message="Volvé a la bandeja e ingresá desde un trabajo válido." action={{ label: 'Volver', onPress: () => router.back() }} /></View>;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding" keyboardVerticalOffset={0}>
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" testID="button-chat-back">
          <Feather name="arrow-left" size={21} color={colors.foreground} />
        </Pressable>
        <Avatar name={participant} size={40} photoObjectPath={participantPhotoPath} />
        <View style={{ flex: 1, gap: 1 }}>
          <AppText variant="label" numberOfLines={1}>{participant}</AppText>
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>{category}</AppText>
        </View>
      </View>
      {messages.isLoading ? (
        <View style={{ flex: 1, justifyContent: 'center' }}><StateMessage icon="message-circle" title="Cargando mensajes" message="Un momento." /></View>
      ) : messages.isError ? (
        <View style={{ flex: 1, justifyContent: 'center' }}><StateMessage icon="wifi-off" title="No cargaron los mensajes" message="Podés intentar de nuevo." action={{ label: 'Reintentar', onPress: () => void messages.refetch() }} /></View>
      ) : (
        <FlatList
          inverted
          data={allMessages}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 12, flexGrow: 1, justifyContent: allMessages.length ? 'flex-start' : 'flex-end' }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', padding: 22 }}>
              <AppText variant="label">Todavía no hay mensajes</AppText>
              <AppText variant="caption" style={{ color: colors.mutedForeground, textAlign: 'center' }}>Escribí para empezar a coordinar este trabajo.</AppText>
            </View>
          }
          renderItem={({ item }) => {
            const outgoing = item.emisorId === account?.id;
            return (
              <View style={{ alignSelf: outgoing ? 'flex-end' : 'flex-start', maxWidth: '84%', marginVertical: 5 }}>
                <View style={[
                  styles.bubble,
                  { backgroundColor: outgoing ? colors.secondary : colors.card, borderColor: outgoing ? colors.secondary : colors.border },
                ]}>
                  <AppText style={{ color: outgoing ? colors.secondaryForeground : colors.foreground }}>{item.texto}</AppText>
                  <AppText variant="caption" style={{ color: outgoing ? colors.secondaryForeground : colors.mutedForeground, opacity: outgoing ? 0.7 : 1, alignSelf: 'flex-end', marginTop: 5 }}>
                    {new Date(item.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                  </AppText>
                </View>
              </View>
            );
          }}
        />
      )}
      <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.card, paddingBottom: Math.max(bottomInset, 10) }]}>
        {sendError ? <AppText variant="caption" style={{ color: colors.destructive, paddingHorizontal: 3 }}>{sendError}</AppText> : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Escribí un mensaje…"
            placeholderTextColor={colors.mutedForeground}
            multiline
            maxLength={1000}
            textAlignVertical="center"
            style={[styles.messageInput, { color: colors.foreground, backgroundColor: colors.muted, borderColor: colors.border }]}
            testID="input-chat-message"
          />
          <Pressable
            onPress={() => void send()}
            disabled={!text.trim() || createMessage.isPending}
            style={({ pressed }) => ({
              width: 48,
              height: 48,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.primary,
              opacity: !text.trim() || createMessage.isPending ? 0.5 : pressed ? 0.75 : 1,
            })}
            accessibilityRole="button"
            accessibilityLabel="Enviar mensaje"
            testID="button-send-message"
          >
            {createMessage.isPending ? <Feather name="loader" size={18} color={colors.primaryForeground} /> : <Feather name="arrow-up" size={20} color={colors.primaryForeground} />}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 62, borderBottomWidth: 1, paddingHorizontal: 14, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  backButton: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
  bubble: { borderRadius: 17, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 10 },
  composer: { borderTopWidth: 1, paddingHorizontal: 14, paddingTop: 10, gap: 8 },
  messageInput: { flex: 1, minHeight: 48, maxHeight: 120, borderRadius: 17, borderWidth: 1, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontFamily: 'DMSans_400Regular', fontSize: 15 },
});