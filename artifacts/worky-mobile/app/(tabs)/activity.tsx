import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import {
  getListNotificationsQueryKey,
  getJob,
  useGetPartnerDashboard,
  useGetPartnerVisitBalance,
  useListNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  type WorkyNotification,
} from '@workspace/api-client-react';
import { AppText, Button, Screen, StateMessage, Surface, formatCurrency, formatShortDate } from '@/components/WorkyUI';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useQueryClient } from '@tanstack/react-query';
import { formatJobContextTitle, getJobReviewRoute } from '@/lib/job-navigation';

function notificationRoute(href: string | null) {
  if (!href) return null;
  const chatMatch = href.match(/^\/chat\/(\d+)$/);
  if (chatMatch) return { pathname: '/chat/[changaId]' as const, params: { changaId: chatMatch[1] } };
  if (href === '/trabajos' || href === '/jobs') return '/(tabs)/jobs' as const;
  if (href === '/mensajes' || href === '/conversaciones') return '/(tabs)/conversations' as const;
  if (href === '/perfil') return '/(tabs)/profile' as const;
  return null;
}

function formatPaymentConfirmedAt(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function jobPaymentLabel(job: NonNullable<WorkyNotification['jobContext']>) {
  if (job.paymentStatus === 'aprobado') {
    const confirmedAt = formatPaymentConfirmedAt(job.paymentConfirmedAt);
    return confirmedAt ? `Pago de la changa confirmado · ${confirmedAt}` : 'Pago de la changa confirmado · hora no registrada';
  }
  if (job.paymentStatus === 'reembolsado') return 'Pago de la changa reembolsado';
  return 'Pago de la changa pendiente de confirmación';
}

function NotificationRow({
  item,
  onRead,
}: {
  item: WorkyNotification;
  onRead: (item: WorkyNotification) => void;
}) {
  const colors = useColors();
  const destination = notificationRoute(item.href);
  return (
    <Pressable
      onPress={() => onRead(item)}
      accessibilityRole="button"
      accessibilityState={{ checked: item.leida }}
      testID={`notification-${item.id}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.78 : 1 })}
    >
      <Surface style={{ flexDirection: 'row', gap: 12, padding: 14, backgroundColor: item.leida ? colors.card : colors.muted }}>
        <View style={{ width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: item.leida ? colors.muted : colors.primary }}>
          <Feather name={item.tipo === 'booking' ? 'calendar' : 'bell'} size={17} color={item.leida ? colors.foreground : colors.primaryForeground} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <AppText variant="label" style={{ flex: 1 }}>{item.titulo}</AppText>
            {!item.leida ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary, marginTop: 5 }} /> : null}
          </View>
          {item.detalle ? <AppText variant="caption" style={{ color: colors.mutedForeground }}>{item.detalle}</AppText> : null}
          {item.jobContext ? (
            <View
              testID={`notification-job-context-${item.id}`}
              style={{ gap: 2, marginTop: 5, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}
            >
              <AppText variant="caption" style={{ color: colors.foreground }}>
                Worker: {item.jobContext.workerName ?? 'pendiente de asignación'}
              </AppText>
              <AppText variant="caption" style={{ color: colors.mutedForeground }}>
                Rubro: {item.jobContext.trade ?? 'sin especificar'}
              </AppText>
              <AppText variant="caption" style={{ color: colors.foreground }}>
                Precio de la changa: {formatCurrency(item.jobContext.price)}
              </AppText>
              <AppText variant="caption" style={{ color: colors.mutedForeground }}>
                {jobPaymentLabel(item.jobContext)}
              </AppText>
            </View>
          ) : null}
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>{formatShortDate(item.createdAt)}{destination ? ' · Ver detalle' : ''}</AppText>
        </View>
      </Surface>
    </Pressable>
  );
}

function ClientActivity() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState('');
  const notifications = useListNotifications({
    query: { queryKey: getListNotificationsQueryKey(), staleTime: 10_000, refetchInterval: 20_000 },
  });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const items = notifications.data?.items ?? [];

  const read = async (item: WorkyNotification) => {
    setActionError('');
    try {
      if (!item.leida) {
        await markRead.mutateAsync({ id: item.id });
        queryClient.setQueryData(getListNotificationsQueryKey(), (old: typeof notifications.data) => old
          ? { ...old, unread: Math.max(0, old.unread - 1), items: old.items.map((entry) => entry.id === item.id ? { ...entry, leida: true } : entry) }
          : old);
      }
      const chatMatch = item.href?.match(/^\/chat\/(\d+)$/);
      // Resolve the current server state, including notifications emitted before this update.
      const linkedJob = chatMatch ? await getJob(Number(chatMatch[1])) : null;
      const destination = linkedJob?.estado === 'finalizada' ? getJobReviewRoute(linkedJob.id) : notificationRoute(item.href);
      if (destination) router.push(destination);
    } catch {
      setActionError('No se pudo actualizar el aviso. Probá de nuevo.');
    }
  };

  const readAll = async () => {
    setActionError('');
    try {
      await markAll.mutateAsync();
      queryClient.setQueryData(getListNotificationsQueryKey(), (old: typeof notifications.data) => old
        ? { ...old, unread: 0, items: old.items.map((entry) => ({ ...entry, leida: true })) }
        : old);
    } catch {
      setActionError('No se pudieron marcar todos los avisos como leídos.');
    }
  };

  return (
    <Screen hasHeader>
      <View style={{ gap: 6 }}>
        <AppText variant="caption" style={{ color: colors.primary, letterSpacing: 1.3, textTransform: 'uppercase' }}>Tu cuenta</AppText>
        <AppText variant="title">Actividad</AppText>
        <AppText style={{ color: colors.mutedForeground }}>Notificaciones sobre tus trabajos y nuevos mensajes</AppText>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <AppText variant="heading">{notifications.data?.unread ?? 0} sin leer</AppText>
        {(notifications.data?.unread ?? 0) > 0 ? (
          <Button label="Marcar todo leído" tone="quiet" icon="check-circle" loading={markAll.isPending} onPress={() => void readAll()} />
        ) : null}
      </View>
      {actionError ? <AppText variant="caption" style={{ color: colors.destructive }}>{actionError}</AppText> : null}
      {notifications.isLoading ? (
        <StateMessage icon="bell" title="Cargando actividad" message="Estamos buscando tus avisos." />
      ) : notifications.isError ? (
        <StateMessage icon="wifi-off" title="No cargó tu actividad" message="Probá actualizar los avisos." action={{ label: 'Reintentar', onPress: () => void notifications.refetch() }} />
      ) : items.length === 0 ? (
        <StateMessage icon="bell" title="No hay novedades" message="Cuando haya actividad en tu cuenta, la vas a encontrar acá." />
      ) : (
        <View style={{ gap: 10 }}>{items.map((item) => <NotificationRow key={item.id} item={item} onRead={(value) => void read(value)} />)}</View>
      )}
    </Screen>
  );
}

function PartnerPanel() {
  const colors = useColors();
  const { account } = useAuth();
  const visitBalance = useGetPartnerVisitBalance({
    query: { queryKey: ['/api/v1/partner/saldo-visitas', account?.id], staleTime: 15_000, refetchInterval: 30_000 },
  });
  const dashboard = useGetPartnerDashboard({
    query: { queryKey: ['/api/v1/partner/dashboard'], staleTime: 15_000, refetchInterval: 30_000 },
  });
  const jobs = dashboard.data?.trabajos ?? [];
  const upcoming = dashboard.data?.calendario ?? [];

  return (
    <Screen hasHeader>
      <View style={{ gap: 6 }}>
        <AppText variant="caption" style={{ color: colors.primary, letterSpacing: 1.3, textTransform: 'uppercase' }}>Tu operación</AppText>
        <AppText variant="title">Panel Partner</AppText>
        <AppText style={{ color: colors.mutedForeground }}>Una vista rápida de tus changas activas y próximas reservas.</AppText>
      </View>
      {dashboard.isLoading ? (
        <StateMessage icon="activity" title="Cargando panel" message="Estamos armando tu resumen." />
      ) : dashboard.isError ? (
        <StateMessage icon="wifi-off" title="No cargó tu panel" message="Probá actualizar tu resumen." action={{ label: 'Reintentar', onPress: () => void dashboard.refetch() }} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {[
              ['Trabajos', String(jobs.length), 'briefcase'],
              ['Próximas', String(upcoming.length), 'calendar'],
              ['Avisos', String(dashboard.data?.notificacionesNoLeidas ?? 0), 'bell'],
            ].map(([label, value, icon]) => (
              <Surface key={label} style={{ flex: 1, padding: 12, gap: 6 }}>
                <Feather name={icon as React.ComponentProps<typeof Feather>['name']} size={17} color={colors.primary} />
                <AppText variant="title" style={{ fontSize: 22 }}>{value}</AppText>
                <AppText variant="caption" style={{ color: colors.mutedForeground }}>{label}</AppText>
              </Surface>
            ))}
          </View>
          <Surface style={{ gap: 5 }} testID="partner-mobile-visit-balance">
            <AppText variant="heading">Saldo</AppText>
            {visitBalance.isLoading ? <AppText variant="caption" style={{ color: colors.mutedForeground }}>Cargando saldo…</AppText> : visitBalance.isError ? (
              <Pressable onPress={() => void visitBalance.refetch()} accessibilityRole="button"><AppText variant="caption" style={{ color: colors.destructive }}>No pudimos cargar el saldo. Tocá para reintentar.</AppText></Pressable>
            ) : (
              <>
                <AppText variant="title">{formatCurrency(visitBalance.data?.availableAmount ?? 0)} disponible</AppText>
                <AppText variant="caption" style={{ color: colors.mutedForeground }}>{formatCurrency(visitBalance.data?.pendingAmount ?? 0)} retenido · liberación tras confirmar o cumplirse 24 horas</AppText>
                {(visitBalance.data?.cashCommissionDue ?? 0) > 0 ? <AppText variant="caption" style={{ color: colors.destructive }}>Comisión pendiente de visitas en efectivo: {formatCurrency(visitBalance.data?.cashCommissionDue ?? 0)}</AppText> : null}
                {(visitBalance.data?.cashJobCommissionDue ?? 0) > 0 ? <AppText variant="caption" style={{ color: colors.destructive }}>Comisión pendiente de changas en efectivo: {formatCurrency(visitBalance.data?.cashJobCommissionDue ?? 0)}</AppText> : null}
              </>
            )}
          </Surface>
          <Surface style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <AppText variant="heading">Próximos movimientos</AppText>
              <Pressable onPress={() => router.push('/(tabs)/jobs')} accessibilityRole="button">
                <AppText variant="label" style={{ color: colors.primary }}>Ver changas</AppText>
              </Pressable>
            </View>
            {jobs.slice(0, 3).map((job) => (
              <View key={job.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="label" numberOfLines={2}>
                    {formatJobContextTitle(job.categoria, job.cliente?.nombre)}
                  </AppText>
                  <AppText variant="caption" style={{ color: colors.mutedForeground }}>{job.estado === 'trabajo_realizado' ? 'Pago pendiente' : job.estado.replaceAll('_', ' ')} · {formatShortDate(job.createdAt)}</AppText>
                </View>
                <AppText variant="label" style={{ color: colors.foreground }}>{formatCurrency(job.precioOfrecido)}</AppText>
              </View>
            ))}
            {jobs.length === 0 ? <AppText variant="caption" style={{ color: colors.mutedForeground }}>Todavía no tenés changas activas.</AppText> : null}
          </Surface>
        </>
      )}
    </Screen>
  );
}

export default function ActivityScreen() {
  const { account } = useAuth();
  return account?.rol === 'profesional' ? <PartnerPanel /> : <ClientActivity />;
}