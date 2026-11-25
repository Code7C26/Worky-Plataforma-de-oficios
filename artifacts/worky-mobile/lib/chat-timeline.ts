import type { Appointment, ChatMessage } from '@workspace/api-client-react';

export type ChatTimelineItem =
  | { key: string; kind: 'message'; createdAt: string; message: ChatMessage }
  | { key: string; kind: 'visit'; createdAt: string; appointment: Appointment };

// FlatList is inverted: newest first, without flipping the contents of each row.
export function buildChatTimeline(messages: ChatMessage[], appointments: Appointment[]): ChatTimelineItem[] {
  return [
    ...messages.map((message): ChatTimelineItem => ({
      key: `message-${message.id}`, kind: 'message', createdAt: message.createdAt, message,
    })),
    ...appointments.map((appointment): ChatTimelineItem => ({
      key: `visit-${appointment.id}`, kind: 'visit', createdAt: appointment.createdAt, appointment,
    })),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.key.localeCompare(a.key));
}

export function canRespondToVisit(appointment: Appointment, accountId?: number) {
  return appointment.estado === 'solicitada' && accountId === appointment.clienteId;
}
