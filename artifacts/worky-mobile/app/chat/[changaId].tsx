import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { File } from 'expo-file-system';
import { fetch as uploadFetch } from 'expo/fetch';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { markMessagesRead, useCreateMessage, useListMessages, useRequestUploadUrl } from '@workspace/api-client-react';
import { AppText, Avatar, FeedbackPressable, StateMessage, SuccessNotice } from '@/components/WorkyUI';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import {
  CHAT_IMAGE_LIMIT_MESSAGE,
  CHAT_IMAGE_SIZE_MESSAGE,
  filterChatImageSelection,
  MAX_CHAT_IMAGES,
  MAX_CHAT_IMAGE_SIZE_BYTES,
} from '@/lib/chat-attachments';
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
  const requestUploadUrl = useRequestUploadUrl();
  const [mediaPermission, requestMediaPermission] = ImagePicker.useMediaLibraryPermissions();
  const [text, setText] = useState('');
  const [sendError, setSendError] = useState('');
  const [sendNotice, setSendNotice] = useState('');
  const [images, setImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [isPickingImages, setIsPickingImages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showSettingsLink, setShowSettingsLink] = useState(false);
  const allMessages = useMemo(() => [...(messages.data ?? [])].reverse(), [messages.data]);

  useEffect(() => {
    if (!Number.isInteger(changaId) || changaId < 1) return;
    void markMessagesRead(changaId)
      .then(() => queryClient.invalidateQueries())
      .catch(() => undefined);
  }, [changaId, queryClient]);

  const chooseImages = async () => {
    if (isPickingImages || isSending || images.length >= MAX_CHAT_IMAGES) return;
    setSendError('');
    setShowSettingsLink(false);
    setIsPickingImages(true);
    try {
      if (Platform.OS !== 'web' && !mediaPermission?.granted) {
        const permission = await requestMediaPermission();
        if (!permission.granted) {
          setSendError(permission.canAskAgain
            ? 'Necesitamos permiso para acceder a tus fotos y adjuntarlas al chat.'
            : 'Permití el acceso a tus fotos desde la configuración del dispositivo.');
          setShowSettingsLink(!permission.canAskAgain);
          return;
        }
      }

      const remaining = MAX_CHAT_IMAGES - images.length;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: remaining > 1,
        selectionLimit: remaining,
        quality: 1,
      });
      if (result.canceled) return;

      const selection = filterChatImageSelection(result.assets, images.length);
      if (selection.accepted.length) {
        setImages((current) => [...current, ...selection.accepted].slice(0, MAX_CHAT_IMAGES));
      }
      if (selection.rejectedForSize) setSendError(CHAT_IMAGE_SIZE_MESSAGE);
      else if (selection.exceededLimit) setSendError(CHAT_IMAGE_LIMIT_MESSAGE);
      else if (selection.rejectedNonImage && !selection.accepted.length) setSendError('Solo podés adjuntar imágenes.');
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : 'No pudimos abrir tus fotos.');
    } finally {
      setIsPickingImages(false);
    }
  };

  const removeImage = (index: number) => {
    setImages((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const send = async () => {
    const value = text.trim();
    const selectedImages = [...images];
    if ((!value && !selectedImages.length) || isPickingImages || isSending || createMessage.isPending) return;
    Keyboard.dismiss();
    setSendError('');
    setSendNotice('');
    setShowSettingsLink(false);
    setIsSending(true);
    try {
      const prepared = selectedImages.map((asset, index) => {
        const file = asset.file ?? new File(asset.uri);
        const contentType = getImageContentType(asset, file.type);
        const extension = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
        const name = asset.fileName?.trim() || `chat-image-${Date.now()}-${index + 1}.${extension}`;
        const size = asset.fileSize ?? file.size;
        if (!contentType.startsWith('image/')) throw new Error('Solo podés adjuntar imágenes.');
        if (!Number.isFinite(size) || size <= 0) throw new Error(`No pudimos leer el tamaño de ${name}.`);
        if (size > MAX_CHAT_IMAGE_SIZE_BYTES) throw new Error(CHAT_IMAGE_SIZE_MESSAGE);
        return { file, contentType, name, size };
      });

      const adjuntos: { objectPath: string; nombre: string }[] = [];
      for (const image of prepared) {
        const upload = await requestUploadUrl.mutateAsync({
          data: {
            name: image.name,
            size: image.size,
            contentType: image.contentType,
            purpose: 'chat_image',
            changaId,
          },
        });
        const uploaded = await uploadFetch(upload.uploadURL, {
          method: 'PUT',
          headers: { 'Content-Type': image.contentType },
          body: image.file,
        });
        if (!uploaded.ok) throw new Error('No pudimos cargar una de las imágenes. Intentá de nuevo.');
        adjuntos.push({ objectPath: upload.objectPath, nombre: image.name });
      }

      await createMessage.mutateAsync({
        changaId,
        data: { texto: value || 'Imagen adjunta', adjuntos },
      });
      setText('');
      setImages([]);
      await queryClient.invalidateQueries();
      setSendNotice('Mensaje enviado.');
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : 'No pudimos enviar el mensaje.');
    } finally {
      setIsSending(false);
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
        {images.length ? (
          <View style={{ gap: 5 }}>
            <AppText variant="caption" style={{ color: colors.mutedForeground }}>
              {images.length >= MAX_CHAT_IMAGES ? CHAT_IMAGE_LIMIT_MESSAGE : `${images.length} de ${MAX_CHAT_IMAGES} imágenes`}
            </AppText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachmentList}>
              {images.map((image, index) => (
                <View key={`${image.uri}-${index}`} style={[styles.attachmentPreview, { borderColor: colors.border }]}>
                  <Image source={{ uri: image.uri }} contentFit="cover" style={styles.attachmentThumbnail} />
                  <Pressable
                    onPress={() => removeImage(index)}
                    disabled={isSending}
                    style={[styles.removeAttachment, { backgroundColor: colors.card, borderColor: colors.border }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Quitar imagen ${index + 1}`}
                    testID={`button-remove-chat-image-${index}`}
                  >
                    <Feather name="x" size={13} color={colors.foreground} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}
        <SuccessNotice
          message={sendNotice}
          onDismiss={() => setSendNotice('')}
          testID="notice-message-sent"
        />
        {sendError ? (
          <View style={styles.errorRow}>
            <AppText variant="caption" style={{ color: colors.destructive, flex: 1 }}>{sendError}</AppText>
            {showSettingsLink ? (
              <Pressable onPress={() => void Linking.openSettings().catch(() => undefined)} accessibilityRole="button">
                <AppText variant="caption" style={{ color: colors.primary }}>Configuración</AppText>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
          <Pressable
            onPress={() => void chooseImages()}
            disabled={isPickingImages || isSending || images.length >= MAX_CHAT_IMAGES}
            style={({ pressed }) => ({
              width: 42,
              height: 48,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: isPickingImages || isSending || images.length >= MAX_CHAT_IMAGES ? 0.45 : pressed ? 0.65 : 1,
            })}
            accessibilityRole="button"
            accessibilityLabel="Adjuntar imágenes"
            testID="button-attach-chat-images"
          >
            {isPickingImages ? <Feather name="loader" size={19} color={colors.foreground} /> : <Feather name="image" size={19} color={colors.foreground} />}
          </Pressable>
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
          <FeedbackPressable
            onPress={() => void send()}
            disabled={(!text.trim() && !images.length) || isPickingImages || isSending || createMessage.isPending}
            style={({ pressed }) => ({
              width: 48,
              height: 48,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.primary,
              opacity: (!text.trim() && !images.length) || isPickingImages || isSending || createMessage.isPending ? 0.5 : pressed ? 0.75 : 1,
            })}
            accessibilityRole="button"
            accessibilityLabel="Enviar mensaje"
            testID="button-send-message"
          >
            {isSending || createMessage.isPending ? <Feather name="loader" size={18} color={colors.primaryForeground} /> : <Feather name="arrow-up" size={20} color={colors.primaryForeground} />}
          </FeedbackPressable>
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
  attachmentList: { gap: 10, paddingHorizontal: 3, paddingBottom: 2 },
  attachmentPreview: { width: 68, height: 68, borderWidth: 1, borderRadius: 13, overflow: 'visible' },
  attachmentThumbnail: { width: '100%', height: '100%', borderRadius: 12 },
  removeAttachment: { position: 'absolute', top: -6, right: -6, width: 23, height: 23, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 3 },
});

function getImageContentType(asset: ImagePicker.ImagePickerAsset, fileType?: string) {
  const declaredType = asset.mimeType?.toLowerCase() || fileType?.toLowerCase();
  if (declaredType?.startsWith('image/')) return declaredType;

  const path = (asset.fileName || asset.uri).split(/[?#]/, 1)[0];
  const extension = path.split('.').pop()?.toLowerCase();
  const imageTypes: Record<string, string> = {
    avif: 'image/avif',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };
  return imageTypes[extension ?? ''] ?? 'image/jpeg';
}