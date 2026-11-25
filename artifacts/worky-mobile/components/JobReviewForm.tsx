import React, { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetJobQueryKey,
  getGetProfessionalQueryKey,
  getGetProfessionalReputationQueryKey,
  getListAssignedJobsQueryKey,
  getListMyJobsQueryKey,
  useCreateJobReview,
  type Job,
} from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { AppText, Button, ErrorNotice, Surface, TextField } from '@/components/WorkyUI';

const MAX_COMMENT = 2000;
const LABELS = ['', 'Muy malo', 'Regular', 'Bueno', 'Muy bueno', 'Excelente'];

function readError(error: unknown): string {
  const anyErr = error as { data?: { error?: string; message?: string }; status?: number; message?: string } | null;
  const server = anyErr?.data?.error || anyErr?.data?.message;
  if (anyErr?.status === 409) return 'Este trabajo ya tiene una reseña.';
  if (server) return `${server} Revisá los datos e intentá de nuevo.`;
  return 'No pudimos enviar tu reseña. Revisá tu conexión e intentá de nuevo; tu borrador sigue acá.';
}

export function JobReviewForm({ job }: { job: Job }) {
  const colors = useColors();
  const { account } = useAuth();
  const queryClient = useQueryClient();
  const mutation = useCreateJobReview();
  const lock = useRef(false);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comentario, setComentario] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (job.calificada || sent) {
    return (
      <View testID={`review-sent-${job.id}`} role="status" style={[styles.sent, { backgroundColor: colors.muted, borderColor: colors.border }]}>
        <Feather name="check-circle" size={16} color={colors.foreground} />
        <AppText variant="label">Calificación enviada</AppText>
      </View>
    );
  }

  const eligible = job.estado === 'finalizada' && account != null && account.id === job.clienteId && job.profesionalId != null;
  if (!eligible) return null;

  if (!open) {
    return (
      <Button
        testID={`review-open-${job.id}`}
        label="Dejar una reseña"
        icon="star"
        tone="secondary"
        feedback
        onPress={() => { setOpen(true); setError(''); }}
      />
    );
  }

  const submit = async () => {
    if (lock.current) return;
    if (rating < 1) { setError('Elegí de 1 a 5 estrellas antes de enviar.'); return; }
    lock.current = true;
    setSubmitting(true);
    setError('');
    const comment = comentario.trim();
    try {
      await mutation.mutateAsync({ data: { changaId: job.id, rating, ...(comment ? { comentario: comment } : {}) } });
    } catch (e) {
      setError(readError(e));
      setSubmitting(false);
      lock.current = false;
      return;
    }
    setSent(true);
    setSubmitting(false);
    const pid = job.profesionalId as number;
    Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: getListMyJobsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListAssignedJobsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(job.id) }),
      queryClient.invalidateQueries({ queryKey: getGetProfessionalReputationQueryKey(pid) }),
      queryClient.invalidateQueries({ queryKey: getGetProfessionalQueryKey(pid) }),
    ]).catch(() => undefined);
  };

  return (
    <Surface style={{ gap: 14 }}>
      <View style={{ gap: 4 }}>
        <AppText variant="heading">¿Cómo fue el trabajo?</AppText>
        <AppText variant="caption" style={{ color: colors.mutedForeground }}>
          Tu opinión ayuda a otros vecinos a elegir con confianza.
        </AppText>
      </View>
      <View role="radiogroup" accessibilityLabel="Puntuación" style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => {
          const active = n <= rating;
          const checked = n === rating;
          return (
            <Pressable
              key={n}
              testID={`review-star-${job.id}-${n}`}
              accessibilityRole="radio"
              accessibilityLabel={`Puntuar ${n} de 5`}
              accessibilityState={{ checked, disabled: submitting }}
              {...(Platform.OS === 'web' ? { 'aria-checked': checked } : {})}
              disabled={submitting}
              hitSlop={4}
              onPress={() => { setRating(n); setError(''); }}
              style={({ pressed }) => [styles.star, { backgroundColor: active ? colors.secondary : colors.muted, borderRadius: 14, opacity: pressed ? 0.75 : 1 }]}
            >
              <MaterialCommunityIcons
                name={active ? 'star' : 'star-outline'}
                size={24}
                color={active ? colors.accent : colors.mutedForeground}
              />
            </Pressable>
          );
        })}
      </View>
      <AppText variant="caption" style={{ color: colors.mutedForeground }}>
        {rating ? `${rating} de 5 · ${LABELS[rating]}` : 'Sin puntuación todavía'}
      </AppText>
      <View style={{ gap: 4 }}>
        <TextField
          testID={`review-comment-${job.id}`}
          label="Comentario (opcional)"
          value={comentario}
          onChangeText={(t) => setComentario(t.slice(0, MAX_COMMENT))}
          maxLength={MAX_COMMENT}
          multiline
          editable={!submitting}
          placeholder="Puntualidad, prolijidad, trato..."
          style={{ minHeight: 96, textAlignVertical: 'top' }}
        />
        <AppText variant="caption" style={{ color: colors.mutedForeground, textAlign: 'right' }}>
          {comentario.length}/{MAX_COMMENT}
        </AppText>
      </View>
      <ErrorNotice testID={`review-error-${job.id}`} message={error} />
      <View style={styles.actions}>
        <Button
          label="Cancelar"
          tone="quiet"
          disabled={submitting}
          onPress={() => { setOpen(false); setError(''); }}
          style={{ flex: 1 }}
        />
        <Button
          testID={`review-submit-${job.id}`}
          label="Enviar reseña"
          icon="send"
          loading={submitting}
          disabled={rating < 1}
          onPress={submit}
          style={{ flex: 1.4 }}
        />
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  sent: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, alignSelf: 'flex-start' },
  stars: { flexDirection: 'row', gap: 8 },
  star: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 10 },
});
