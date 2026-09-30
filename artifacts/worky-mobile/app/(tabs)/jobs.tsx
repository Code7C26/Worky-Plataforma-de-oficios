import React, { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import {
  useAcceptJob,
  useListAssignedJobs,
  useListAvailableJobs,
  useListMyJobs,
  type Job,
} from '@workspace/api-client-react';
import { AppText, Button, Screen, StateMessage, Surface, formatCurrency, formatShortDate } from '@/components/WorkyUI';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

function JobCard({
  job,
  available,
  onAccept,
  accepting,
}: {
  job: Job;
  available: boolean;
  onAccept: () => void;
  accepting: boolean;
}) {
  const colors = useColors();
  const canChat = Boolean(job.profesionalId) && ['aceptada', 'en_curso', 'finalizada'].includes(job.estado);

  return (
    <Surface>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="heading">{job.categoria}</AppText>
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>{formatShortDate(job.createdAt)} · {job.ubicacion?.ciudad || 'Ubicación a coordinar'}</AppText>
        </View>
        <View style={{ backgroundColor: colors.muted, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 }}>
          <AppText variant="caption" style={{ color: colors.secondary }}>{job.estado.replace('_', ' ')}</AppText>
        </View>
      </View>
      {job.detalle ? <AppText style={{ color: colors.mutedForeground }}>{job.detalle}</AppText> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 11, marginTop: 2 }}>
        <View>
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>Presupuesto ofrecido</AppText>
          <AppText variant="label">{formatCurrency(job.precioOfrecido)}</AppText>
        </View>
        {available ? (
          <Button label="Aceptar" icon="check" loading={accepting} onPress={onAccept} testID={`button-accept-job-${job.id}`} />
        ) : canChat ? (
          <Pressable
            onPress={() => router.push({ pathname: '/chat/[changaId]', params: { changaId: String(job.id), category: job.categoria, participant: job.cliente?.nombre || job.profesional?.nombre || 'Conversación' } })}
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
    </Surface>
  );
}

export default function JobsScreen() {
  const colors = useColors();
  const { account } = useAuth();
  const isProfessional = account?.rol === 'profesional';
  const [view, setView] = useState<'mine' | 'available'>('mine');
  const mine = useListMyJobs({ query: { queryKey: ['/api/v1/trabajos/mias'], enabled: Boolean(account) && !isProfessional, staleTime: 15_000 } });
  const assigned = useListAssignedJobs({ query: { queryKey: ['/api/v1/trabajos/asignadas'], enabled: Boolean(account) && isProfessional, staleTime: 15_000 } });
  const available = useListAvailableJobs({ query: { queryKey: ['/api/v1/trabajos/disponibles'], enabled: Boolean(account) && isProfessional && view === 'available', staleTime: 15_000 } });
  const acceptJob = useAcceptJob();
  const jobs = isProfessional ? (view === 'available' ? available.data ?? [] : assigned.data ?? []) : mine.data ?? [];
  const activeQuery = isProfessional ? (view === 'available' ? available : assigned) : mine;

  const handleAccept = async (jobId: number) => {
    try {
      await acceptJob.mutateAsync({ id: jobId });
      await Promise.all([mine.refetch(), assigned.refetch(), available.refetch()]);
    } catch {
      Alert.alert('No se pudo aceptar', 'El trabajo pudo haber sido tomado por otra persona. Actualizá la lista e intentá de nuevo.');
    }
  };

  return (
    <Screen>
      <View style={{ gap: 7 }}>
        <AppText variant="caption" style={{ color: colors.primary, letterSpacing: 1.3, textTransform: 'uppercase' }}>Tu actividad</AppText>
        <AppText variant="title">Trabajos</AppText>
        <AppText style={{ color: colors.mutedForeground }}>
          {isProfessional ? 'Seguí tus trabajos y encontrá nuevas oportunidades.' : 'Consultá el estado de los trabajos que publicaste.'}
        </AppText>
      </View>
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
        <Button label="Publicar un trabajo" icon="plus" onPress={() => router.push('/job/new')} testID="button-new-job" />
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
          action={!isProfessional ? { label: 'Publicar un trabajo', onPress: () => router.push('/job/new') } : undefined}
        />
      ) : (
        <View style={{ gap: 12 }}>
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              available={isProfessional && view === 'available'}
              onAccept={() => void handleAccept(job.id)}
              accepting={acceptJob.isPending && acceptJob.variables?.id === job.id}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}