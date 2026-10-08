import type { Conversation, ListConversationsRol } from '@workspace/api-client-react';

type ShortDateFormatter = (value?: string | null) => string;

export function getConversationInboxQuery(accountRole?: string | null) {
  const role: ListConversationsRol = accountRole === 'profesional' ? 'profesional' : 'cliente';

  return {
    role,
    params: { rol: role },
    query: {
      queryKey: ['/api/v1/conversaciones', role],
      staleTime: 10_000,
      refetchInterval: 15_000,
    },
  };
}

export function getUnreadConversationCount(
  conversations: readonly Pick<Conversation, 'unread'>[] | null | undefined,
) {
  return (conversations ?? []).reduce((sum, conversation) => sum + conversation.unread, 0);
}

export function getConversationRoute(conversation: Conversation) {
  const participant = conversation.interlocutor?.nombre || 'Conversación';
  const participantPhotoPath = conversation.interlocutor?.fotoObjectPath;

  return {
    pathname: '/chat/[changaId]' as const,
    params: {
      changaId: String(conversation.changaId),
      category: conversation.categoria,
      participant,
      ...(participantPhotoPath ? { participantPhotoPath } : {}),
    },
  };
}

export function createConversationOnPress(
  conversation: Conversation,
  pushRoute: (route: ReturnType<typeof getConversationRoute>) => void,
) {
  return () => pushRoute(getConversationRoute(conversation));
}

export function formatConversationTime(
  value: string | null | undefined,
  now: Date,
  formatShortDate: ShortDateFormatter,
) {
  if (!value) return 'Sin actividad';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin actividad';

  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Ayer';

  return formatShortDate(value);
}

export function getConversationRowPresentation(
  conversation: Conversation,
  now: Date,
  formatShortDate: ShortDateFormatter,
) {
  const name = conversation.interlocutor?.nombre || 'Conversación';
  const unreadBadge = conversation.unread > 0
    ? conversation.unread > 99 ? '99+' : String(conversation.unread)
    : null;
  const lastMessage = conversation.ultimoMensaje;
  const messageText = lastMessage?.texto;
  const attachmentCount = lastMessage?.adjuntos?.length ?? 0;
  const attachmentPreview = attachmentCount === 1
    ? 'Archivo adjunto'
    : `${attachmentCount} archivos adjuntos`;

  return {
    name,
    category: conversation.categoria,
    photoObjectPath: conversation.interlocutor?.fotoObjectPath,
    preview: messageText?.trim()
      ? messageText
      : attachmentCount > 0 ? attachmentPreview : 'Empezá la conversación',
    time: formatConversationTime(
      lastMessage?.createdAt || conversation.updatedAt,
      now,
      formatShortDate,
    ),
    unreadBadge,
    accessibilityLabel: `Abrir conversación con ${name}${conversation.unread > 0 ? `, ${conversation.unread} mensajes sin leer` : ''}`,
  };
}