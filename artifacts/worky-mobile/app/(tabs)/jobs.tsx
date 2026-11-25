import React, { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Feather } from '@expo/vector-icons';
import {
  useAcceptJob,
  useConfirmCashJobPayment,
  useDeleteJob,
  getListMyPaymentsQueryKey,
  useCreatePaymentCheckout,
  useListAssignedJobs,
  useListAvailableJobs,
  useListMyPayments,
  useListMyJobs,
  useUpdateJob,
  type ClientPayment,
  type Job,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { AppText, Avatar, Button, FeedbackPressable, Screen, StateMessage, SuccessNotice, Surface, formatCurrency, formatShortDate } from '@/components/WorkyUI';
import { JobReviewForm } from '@/components/JobReviewForm';
import { formatJobContextTitle, getJobParticipant, getJobReviewRoute } from '@/lib/job-navigation';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

function JobCard({
  job,
  available,
  onAccept,
  accepting,
  editable = false,
  onDelete,
  deleting = false,
  payment,
  onPay,
  paying = false,
  onAdvance,
  advancing = false,
  onConfirmCash,
  confirmingCash = false,
}: {
  job: Job;
  available: boolean;
  onAccept: () => void;
  accepting: boolean;
  editable?: boolean;
  onDelete?: () => void;
  deleting?: boolean;
  payment?: ClientPayment;
  onPay?: () => void;
  paying?: boolean;
  onAdvance?: () => void;
  advancing?: boolean;
  onConfirmCash?: () => void;
  confirmingCash?: boolean;
}) {
  const colors = useColors();
  const { account } = useAuth();
  const participant = getJobParticipant(job, account?.id);
  const isProfessional = account?.rol === 'profesional';
  const paymentApproved = payment?.status === 'aprobado';
  const canChat = Boolean(job.profesionalId) && ['aceptada', 'en_curso', 'trabajo_realizado', 'finalizada'].includes(job.estado);
  const statusLabels: Record<string, string> = {
    publicada: 'Publicada',
    aceptada: 'Aceptada',
    en_curso: 'En curso',
    trabajo_realizado: 'Pago pendiente',
    finalizada: 'Finalizada',
    cancelada: 'Cancelada',
  };

  return (
    <Surface testID={`card-job-${job.id}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        {participant ? <Avatar name={participant.nombre} size={36} photoObjectPath={participant.fotoObjectPath} /> : null}
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="heading" numberOfLines={2}>{formatJobContextTitle(job.categoria, participant?.nombre)}</AppText>
          {isProfessional && job.cliente.clientVerified ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} testID={`badge-client-verified-${job.id}`}>
              <Feather name="check-circle" size={13} color={colors.secondary} />
              <AppText variant="caption" style={{ color: colors.secondary }}>Cliente verificado</AppText>
            </View>
          ) : null}
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>{formatShortDate(job.createdAt)} · {job.ubicacion?.ciudad || 'Ubicación a coordinar'}</AppText>
        </View>
        <View style={{ backgroundColor: colors.muted, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 }}>
          <AppText variant="caption" style={{ color: colors.foreground }}>{statusLabels[job.estado] ?? job.estado.replaceAll('_', ' ')}</AppText>
        </View>
      </View>
      {job.detalle ? <AppText style={{ color: colors.mutedForeground }}>{job.detalle}</AppText> : null}
      {editable ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
          <Pressable
            onPress={() => router.push({ pathname: '/job/edit/[id]', params: { id: String(job.id) } })}
            accessibilityRole="button"
            accessibilityLabel={`Editar trabajo de ${job.categoria}`}
            testID={`button-edit-job-${job.id}`}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, opacity: pressed ? 0.65 : 1 })}
          >
            <Feather name="edit-2" size={16} color={colors.primary} />
            <AppText variant="label" style={{ color: colors.primary }}>Editar</AppText>
          </Pressable>
          <Pressable
            onPress={onDelete}
            disabled={deleting}
            accessibilityRole="button"
            accessibilityLabel={`Eliminar trabajo de ${job.categoria}`}
            testID={`button-delete-job-${job.id}`}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, opacity: deleting ? 0.5 : pressed ? 0.65 : 1 })}
          >
            <Feather name="trash-2" size={16} color={colors.destructive} />
            <AppText variant="label" style={{ color: colors.destructive }}>{deleting ? 'Eliminando…' : 'Eliminar'}</AppText>
          </Pressable>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 11, marginTop: 2 }}>
        <View>
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>Presupuesto ofrecido</AppText>
          <AppText variant="label">{formatCurrency(job.precioOfrecido)}</AppText>
        </View>
        {available ? (
          <Button label="Aceptar" icon="check" loading={accepting} onPress={onAccept} testID={`button-accept-job-${job.id}`} />
        ) : canChat ? (
          <Pressable
            onPress={() => router.push({ pathname: '/chat/[changaId]', params: { changaId: String(job.id), category: job.categoria, participant: participant?.nombre || 'Conversación', profesionalId: job.profesionalId ? String(job.profesionalId) : '', participantPhotoPath: participant?.fotoObjectPath || '' } })}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8 }}
            accessibilityRole="button"
          >
            <Feather name="message-circle" size={17} color={colors.primary} />
            <AppText variant="label" style={{ color: colors.primary }}>Mensajes</AppText>
          </Pressable>
        ) : (
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>Esperando profesional</AppText>
        )}
      </View>
      {job.estado === 'trabajo_realizado' ? (
        <View style={{ gap: 8, borderRadius: 14, backgroundColor: colors.muted, padding: 12 }}>
          <AppText variant="label">Trabajo realizado · {formatCurrency(job.precioOfrecido)}</AppText>
          {job.paymentMethod === 'mercado_pago' ? (
            <>
              <AppText variant="caption" style={{ color: colors.mutedForeground }}>
                {paymentApproved
                  ? 'Pago confirmado. Worky está actualizando el cierre del trabajo.'
                  : payment?.status === 'iniciado'
                  ? 'Esperando confirmación de Mercado Pago.'
                  : payment?.status === 'rechazado'
                    ? 'El pago fue rechazado. Podés intentarlo nuevamente.'
                    : 'El trabajo no se finaliza ni se puede reseñar hasta que Mercado Pago confirme el pago.'}
              </AppText>
              {!isProfessional && !paymentApproved ? (
                <Button
                  label={payment?.status === 'iniciado' ? 'Continuar pago' : 'Pagar trabajo'}
                  icon="credit-card"
                  loading={paying}
                  onPress={onPay}
                  testID={`button-pay-job-${job.id}`}
                />
              ) : null}
            </>
          ) : (
            <>
              <AppText variant="caption" style={{ color: colors.mutedForeground }}>
                Efectivo · cliente {job.cashConfirmedByClient ? 'confirmó' : 'pendiente'} · profesional {job.cashConfirmedByProfessional ? 'confirmó' : 'pendiente'}.
              </AppText>
              {onConfirmCash ? (
                <Button label="Confirmar pago en efectivo" icon="check" loading={confirmingCash} onPress={onConfirmCash} testID={`button-confirm-cash-job-${job.id}`} />
              ) : (isProfessional ? job.cashConfirmedByProfessional : job.cashConfirmedByClient) ? (
                <AppText variant="caption" style={{ color: colors.primary }}>Ya confirmaste; falta la otra parte.</AppText>
              ) : null}
            </>
          )}
        </View>
      ) : null}
      {isProfessional && onAdvance ? (
        <Button
          label={job.estado === 'aceptada' ? 'Iniciar trabajo' : 'Marcar trabajo realizado'}
          icon={job.estado === 'aceptada' ? 'play' : 'check'}
          loading={advancing}
          onPress={onAdvance}
          testID={`button-advance-job-${job.id}`}
        />
      ) : null}
      <JobReviewForm job={job} />
    </Surface>
  );
}

export default function JobsScreen() {
  const colors = useColors();
  const { account } = useAuth();
  const params = useLocalSearchParams<{ jobId?: string }>();
  const isProfessional = account?.rol === 'profesional';
  const [view, setView] = useState<'mine' | 'available'>('mine');
  const [actionFeedback, setActionFeedback] = useState('');
  const mine = useListMyJobs({ query: { queryKey: ['/api/v1/trabajos/mias'], enabled: Boolean(account) && !isProfessional, staleTime: 15_000, refetchInterval: 8_000 } });
  const myPayments = useListMyPayments({ query: {
    queryKey: getListMyPaymentsQueryKey(),
    enabled: Boolean(account) && !isProfessional,
    staleTime: 10_000,
    refetchInterval: (query) => query.state.data?.some((payment) => payment.status === 'iniciado') ? 8000 : false,
  } });
  const assigned = useListAssignedJobs({ query: { queryKey: ['/api/v1/trabajos/asignadas'], enabled: Boolean(account) && isProfessional, staleTime: 15_000, refetchInterval: 8_000 } });
  const available = useListAvailableJobs({ query: { queryKey: ['/api/v1/trabajos/disponibles'], enabled: Boolean(account) && isProfessional && view === 'available', staleTime: 15_000 } });
  const acceptJob = useAcceptJob();
  const updateJob = useUpdateJob();
  const confirmCashPayment = useConfirmCashJobPayment();
  const createPayment = useCreatePaymentCheckout();
  const deleteJob = useDeleteJob();
  const queryClient = useQueryClient();
  const jobs = isProfessional ? (view === 'available' ? available.data ?? [] : assigned.data ?? []) : mine.data ?? [];
  const activeQuery = isProfessional ? (view === 'available' ? available : assigned) : mine;
  useFocusEffect(React.useCallback(() => {
    if (account) {
      void activeQuery.refetch();
      if (!isProfessional) void myPayments.refetch();
    }
  }, [account?.id, isProfessional, view, activeQuery.refetch, myPayments.refetch]));
  const orderedJobs = [...jobs].sort((a, b) => Number(b.id === Number(params.jobId)) - Number(a.id === Number(params.jobId)));

  const handleAccept = async (jobId: number) => {
    try {
      await acceptJob.mutateAsync({ id: jobId });
      await Promise.all([mine.refetch(), assigned.refetch(), available.refetch()]);
      setActionFeedback('Trabajo aceptado.');
    } catch {
      Alert.alert('No se pudo aceptar', 'El trabajo pudo haber sido tomado por otra persona. Actualizá la lista e intentá de nuevo.');
    }
  };

  const handleAdvance = async (job: Job) => {
    const nextState = job.estado === 'aceptada' ? 'en_curso' : 'trabajo_realizado';
    try {
      await updateJob.mutateAsync({ id: job.id, data: { estado: nextState } });
      await Promise.all([mine.refetch(), assigned.refetch(), available.refetch()]);
      setActionFeedback(nextState === 'en_curso' ? 'Trabajo iniciado.' : 'Marcado como realizado; falta completar el pago.');
    } catch (reason) {
      const data = reason && typeof reason === 'object' ? (reason as { data?: { error?: unknown } }).data : undefined;
      const message = typeof data?.error === 'string'
        ? data.error
        : reason instanceof Error ? reason.message : 'No pudimos actualizar el estado del trabajo.';
      Alert.alert('No se pudo actualizar', message);
    }
  };

  const handleConfirmCash = async (jobId: number) => {
    try {
      const updated = await confirmCashPayment.mutateAsync({ id: jobId });
      await Promise.all([mine.refetch(), assigned.refetch()]);
      setActionFeedback(updated.estado === 'finalizada'
        ? 'Ambas partes confirmaron el pago. El trabajo quedó finalizado.'
        : 'Tu confirmación quedó registrada; falta la otra parte.');
    } catch (reason) {
      const data = reason && typeof reason === 'object' ? (reason as { data?: { error?: unknown } }).data : undefined;
      const message = typeof data?.error === 'string'
        ? data.error
        : reason instanceof Error ? reason.message : 'No pudimos confirmar el pago en efectivo.';
      Alert.alert('No se pudo confirmar', message);
    }
  };

  const handlePayment = async (jobId: number) => {
    try {
      const checkout = await createPayment.mutateAsync({ data: { changaId: jobId } });
      const returnUrl = Linking.createURL('/jobs', { queryParams: { jobId: String(jobId) } });
      const result = await WebBrowser.openAuthSessionAsync(checkout.checkoutUrl, returnUrl);
      if (result.type === 'success') {
        router.replace(getJobReviewRoute(jobId));
      }
      await Promise.all([mine.refetch(), myPayments.refetch()]);
    } catch (cause) {
      const data = cause && typeof cause === 'object' ? (cause as { data?: { error?: unknown } }).data : undefined;
      const message = typeof data?.error === 'string'
        ? data.error
        : cause instanceof Error ? cause.message : 'No pudimos abrir el pago.';
      Alert.alert('No se pudo iniciar el pago', message);
    }
  };

  const confirmDelete = (job: Job) => {
    Alert.alert(
      'Eliminar trabajo',
      '¿Querés eliminar esta publicación? Si ya tiene mensajes, visitas o historial, Worky no permitirá borrarla para conservar la conversación.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            void deleteJob.mutateAsync({ id: job.id })
              .then(async () => {
                await queryClient.invalidateQueries();
                setActionFeedback('Trabajo eliminado.');
              })
              .catch((reason: unknown) => {
                const data = reason && typeof reason === 'object' ? (reason as { data?: { error?: unknown } }).data : undefined;
                const message = typeof data?.error === 'string'
                  ? data.error
                  : reason instanceof Error ? reason.message : 'No pudimos eliminar el trabajo.';
                Alert.alert('No se pudo eliminar', message);
              });
          },
        },
      ],
    );
  };

  return (
    <Screen hasHeader>
      <View style={{ gap: 7 }}>
        <AppText variant="caption" style={{ color: colors.primary, letterSpacing: 1.3, textTransform: 'uppercase' }}>Tu actividad</AppText>
        <AppText variant="title">Mis trabajos</AppText>
        <AppText style={{ color: colors.mutedForeground }}>
          {isProfessional ? 'Seguí tus trabajos y encontrá nuevas oportunidades.' : 'Consultá el estado de los trabajos que publicaste.'}
        </AppText>
      </View>
      <SuccessNotice
        message={actionFeedback}
        onDismiss={() => setActionFeedback('')}
        testID="notice-job-accepted"
      />
      {isProfessional ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([
            ['mine', 'Asignados'],
            ['available', 'Disponibles'],
          ] as const).map(([key, label]) => {
            const selected = view === key;
            return (
              <Pressable
                key={key}
                onPress={() => setView(key)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={{ flex: 1, borderRadius: 14, backgroundColor: selected ? colors.secondary : colors.muted, paddingVertical: 12, alignItems: 'center' }}
              >
                <AppText variant="label" style={{ color: selected ? colors.secondaryForeground : colors.foreground }}>{label}</AppText>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <FeedbackPressable
          onPress={() => router.push('/job/new')}
          accessibilityRole="button"
          accessibilityLabel="Publicar un trabajo"
          testID="button-new-job"
          style={({ pressed }) => ({
            minHeight: 84,
            paddingHorizontal: 16,
            paddingVertical: 14,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: colors.radius,
            opacity: pressed ? 0.82 : 1,
          })}
        >
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.secondary,
            }}
          >
            <Feather name="plus" size={30} color={colors.secondaryForeground} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <AppText variant="heading" style={{ fontSize: 19, lineHeight: 25 }}>
              Publicar un trabajo
            </AppText>
            <AppText variant="caption" style={{ color: colors.mutedForeground }}>
              Contanos qué necesitás resolver
            </AppText>
          </View>
        </FeedbackPressable>
      )}
      {activeQuery.isLoading ? (
        <StateMessage icon="briefcase" title="Cargando trabajos" message="Enseguida vas a ver las novedades." />
      ) : activeQuery.isError ? (
        <StateMessage icon="wifi-off" title="No cargaron tus trabajos" message="Actualizá la lista para volver a intentarlo." action={{ label: 'Actualizar', onPress: () => void activeQuery.refetch() }} />
      ) : jobs.length === 0 ? (
        <StateMessage
          icon={isProfessional && view === 'available' ? 'search' : 'briefcase'}
          title={isProfessional && view === 'available' ? 'No hay trabajos disponibles' : 'Todavía no hay trabajos'}
          message={isProfessional && view === 'available' ? 'Cuando aparezcan trabajos para tu perfil, los vas a encontrar acá.' : isProfessional ? 'Los trabajos que aceptes van a aparecer en esta lista.' : 'Publicá tu primer trabajo y empezá a recibir respuestas.'}
          action={!isProfessional ? { label: 'Publicar un trabajo', onPress: () => router.push('/job/new'), feedback: true } : undefined}
        />
      ) : (
        <View style={{ gap: 12 }}>
          {orderedJobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              available={isProfessional && view === 'available'}
              onAccept={() => void handleAccept(job.id)}
              accepting={acceptJob.isPending && acceptJob.variables?.id === job.id}
              payment={myPayments.data?.find((payment) => payment.changaId === job.id)}
              onPay={!isProfessional && job.estado === 'trabajo_realizado' && job.paymentMethod === 'mercado_pago' ? () => void handlePayment(job.id) : undefined}
              paying={createPayment.isPending && createPayment.variables?.data.changaId === job.id}
              onAdvance={isProfessional && ['aceptada', 'en_curso'].includes(job.estado) ? () => void handleAdvance(job) : undefined}
              advancing={updateJob.isPending && updateJob.variables?.id === job.id}
              onConfirmCash={job.estado === 'trabajo_realizado' && job.paymentMethod === 'efectivo' && (isProfessional ? !job.cashConfirmedByProfessional : !job.cashConfirmedByClient) ? () => void handleConfirmCash(job.id) : undefined}
              confirmingCash={confirmCashPayment.isPending && confirmCashPayment.variables?.id === job.id}
              editable={!isProfessional && job.estado === 'publicada' && job.profesionalId === null}
              onDelete={() => confirmDelete(job)}
              deleting={deleteJob.isPending && deleteJob.variables?.id === job.id}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}