import React, { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListAppointmentsQueryKey,
  useAcceptAppointment,
  useRejectAppointment,
  useRecordVisitArrival,
  useCompleteVisit,
  useConfirmVisit,
  useReportVisitIssue,
  type Appointment,
} from '@workspace/api-client-react';
import { AppText } from '@/components/WorkyUI';
import { useColors } from '@/hooks/useColors';

type Action = 'accept-mp' | 'accept-cash' | 'reject' | 'arrival' | 'complete' | 'confirm' | 'report';

const statusLabels: Record<Appointment['estado'], string> = {
  solicitada: 'Pendiente de respuesta y pago',
  confirmada: 'Visita confirmada y pagada',
  en_curso: 'Visita en revisión',
  completada: 'Visita realizada',
  cancelada: 'Visita rechazada o cancelada',
};
const money = (amount: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(amount);

export function ChatVisitCard({ appointment, accountId }: { appointment: Appointment; accountId?: number }) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const accept = useAcceptAppointment();
  const reject = useRejectAppointment();
  const arrival = useRecordVisitArrival();
  const complete = useCompleteVisit();
  const confirm = useConfirmVisit();
  const report = useReportVisitIssue();
  const locked = useRef(false);
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState('');
  const [issueType, setIssueType] = useState<'partner_no_show' | 'client_no_show' | 'other'>('other');
  const [issueDetail, setIssueDetail] = useState('');
  const isClient = accountId === appointment.clienteId;
  const isPartner = accountId === appointment.profesionalId;
  const finance = appointment.finanzas;
  const busy = action !== null;
  const respond = async (next: Action) => {
    if (locked.current || !accountId) return;
    locked.current = true;
    setAction(next);
    setError('');
    try {
      if (next === 'accept-mp' || next === 'accept-cash') {
        const result = await accept.mutateAsync({
          id: appointment.id,
          data: { paymentMethod: next === 'accept-mp' ? 'mercado_pago' : 'efectivo' },
        });
        if (result.checkoutUrl) {
          await Linking.openURL(result.checkoutUrl);
          return;
        }
        queryClient.setQueryData<Appointment[]>(getListAppointmentsQueryKey(appointment.changaId),
          (current) => current?.map((item) => item.id === result.appointment.id ? result.appointment : item));
      } else if (next === 'reject') {
        const updated = await reject.mutateAsync({ id: appointment.id });
        queryClient.setQueryData<Appointment[]>(getListAppointmentsQueryKey(appointment.changaId),
          (current) => current?.map((item) => item.id === updated.id ? updated : item));
      } else if (next === 'arrival') {
        await arrival.mutateAsync({ id: appointment.id });
      } else if (next === 'complete') {
        await complete.mutateAsync({ id: appointment.id });
      } else if (next === 'confirm') {
        await confirm.mutateAsync({ id: appointment.id });
      } else if (next === 'report') {
        await report.mutateAsync({ id: appointment.id, data: { issueType, detail: issueDetail.trim() } });
      }
      await queryClient.invalidateQueries();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No pudimos guardar el cambio. Intentá de nuevo.');
      void queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey(appointment.changaId) });
    } finally {
      locked.current = false;
      setAction(null);
    }
  };
  const dateFormat = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
  const reportable = Boolean(finance && ['pending_release', 'cash_pending_visit', 'cash_commission_due', 'cash_commission_settled'].includes(finance.status));
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]} testID={`card-chat-visit-${appointment.id}`}>
      <View style={styles.heading}><Feather name="calendar" size={20} color={colors.foreground} /><AppText variant="label">Propuesta de visita</AppText></View>
      <AppText>{dateFormat.format(new Date(appointment.empiezaAt))}</AppText>
      {appointment.terminaAt ? <AppText variant="caption" style={{ color: colors.mutedForeground }}>Hasta {dateFormat.format(new Date(appointment.terminaAt))}</AppText> : null}
      <AppText variant="label" accessibilityLiveRegion="polite" style={{ color: colors.foreground }} testID={`status-chat-visit-${appointment.id}`}>{statusLabels[appointment.estado]}</AppText>
      <AppText variant="caption" style={{ color: colors.mutedForeground }}>Tarifa {money(appointment.tarifaVisita)} · Worky 15% · Partner 85%</AppText>
      {finance ? <AppText variant="caption" style={{ color: colors.mutedForeground }}>
        {finance.method === 'mercado_pago' ? 'Mercado Pago' : 'Efectivo'} · {finance.status === 'pending_release' ? '85% retenido' : finance.status === 'available' ? 'saldo disponible' : finance.status === 'under_review' ? 'saldo en revisión' : finance.status === 'cash_commission_due' ? `comisión pendiente: ${money(finance.commissionAmount)}` : finance.status === 'cash_commission_settled' ? 'comisión saldada' : finance.status.replaceAll('_', ' ')}
      </AppText> : null}
      {isClient && appointment.estado === 'solicitada' ? (
        <View style={styles.actions}>
          <ActionButton label="Aceptar y pagar con Mercado Pago" icon="credit-card" disabled={busy} busy={action === 'accept-mp'} onPress={() => void respond('accept-mp')} testID={`button-accept-visit-mp-${appointment.id}`} colors={colors} />
          <ActionButton label="Aceptar en efectivo" icon="dollar-sign" disabled={busy} busy={action === 'accept-cash'} onPress={() => void respond('accept-cash')} testID={`button-accept-visit-cash-${appointment.id}`} colors={colors} />
          <ActionButton label="Rechazar" icon="x" disabled={busy} busy={action === 'reject'} onPress={() => void respond('reject')} testID={`button-reject-visit-${appointment.id}`} colors={colors} />
        </View>
      ) : null}
      {isPartner && appointment.estado === 'confirmada' && finance ? (
        <View style={styles.actions}>
          {!finance.partnerArrivedAt
            ? <ActionButton label="Registrar llegada" icon="map-pin" disabled={busy} busy={action === 'arrival'} onPress={() => void respond('arrival')} testID={`button-arrival-visit-${appointment.id}`} colors={colors} />
            : <ActionButton label="Marcar visita realizada" icon="check" disabled={busy} busy={action === 'complete'} onPress={() => void respond('complete')} testID={`button-complete-visit-${appointment.id}`} colors={colors} />}
        </View>
      ) : null}
      {isClient && appointment.estado === 'completada' && finance && ['pending_release', 'cash_commission_due', 'cash_commission_settled'].includes(finance.status)
        ? <ActionButton label={finance.method === 'mercado_pago' ? 'Confirmar y liberar saldo' : 'Confirmar visita'} icon="check" disabled={busy} busy={action === 'confirm'} onPress={() => void respond('confirm')} testID={`button-confirm-visit-${appointment.id}`} colors={colors} />
        : null}
      {finance?.status === 'pending_release' && finance.releaseAt ? <AppText variant="caption" style={{ color: colors.mutedForeground }}>
        Sin reportes, el 85% se libera automáticamente el {dateFormat.format(new Date(finance.releaseAt))}.
      </AppText> : null}
      {finance?.status === 'under_review' ? <AppText variant="caption" style={{ color: colors.destructive }}>El saldo está retenido hasta que Worky revise el reporte.</AppText> : null}
      {reportable ? (
        <View style={styles.reportBox}>
          <AppText variant="label">Reportar un problema</AppText>
          <View style={styles.actions}>
            {(isClient ? [['partner_no_show', 'El Partner no vino'], ['other', 'Otro problema']] : [['client_no_show', 'El cliente no vino'], ['other', 'Otro problema']]).map(([value, label]) => (
              <Pressable key={value} onPress={() => setIssueType(value as typeof issueType)} accessibilityRole="button" accessibilityState={{ selected: issueType === value }} testID={`button-visit-issue-${value}-${appointment.id}`}
                style={[styles.issueType, { borderColor: issueType === value ? colors.secondary : colors.border, backgroundColor: issueType === value ? colors.muted : colors.card }]}>
                <AppText variant="caption">{label}</AppText>
              </Pressable>
            ))}
          </View>
          <TextInput value={issueDetail} onChangeText={setIssueDetail} placeholder="Contanos qué pasó" placeholderTextColor={colors.mutedForeground} multiline maxLength={1000}
            style={[styles.issueInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} accessibilityLabel="Detalle del problema" testID={`input-visit-issue-${appointment.id}`} />
          <AppText variant="caption" style={{ color: colors.mutedForeground }}>Para ausencias, esperá 10 minutos desde el horario pactado. El saldo queda retenido mientras Worky revisa.</AppText>
          <ActionButton label="Enviar reporte" icon="alert-circle" disabled={busy || issueDetail.trim().length < 5} busy={action === 'report'} onPress={() => void respond('report')} testID={`button-report-visit-${appointment.id}`} colors={colors} />
        </View>
      ) : null}
      {error ? <AppText variant="caption" accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</AppText> : null}
    </View>
  );
}

function ActionButton({ label, icon, disabled, busy, onPress, testID, colors }: {
  label: string; icon: React.ComponentProps<typeof Feather>['name']; disabled: boolean; busy: boolean;
  onPress: () => void; testID: string; colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityState={{ disabled, busy }}
      testID={testID} style={({ pressed }) => [styles.button, { backgroundColor: colors.secondary, borderColor: colors.secondary, opacity: disabled ? 0.55 : pressed ? 0.75 : 1 }]}>
      {busy ? <ActivityIndicator size="small" color={colors.secondaryForeground} /> : <Feather name={icon} size={16} color={colors.secondaryForeground} />}
      <AppText variant="label" style={{ color: colors.secondaryForeground }}>{busy ? 'Guardando…' : label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 17, padding: 15, gap: 9, marginVertical: 7 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 3 },
  button: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  issueType: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 7 },
  reportBox: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#aab0b5', paddingTop: 10, marginTop: 3 },
  issueInput: { minHeight: 54, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, textAlignVertical: 'top' },
});
