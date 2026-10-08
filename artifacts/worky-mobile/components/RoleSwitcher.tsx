import React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText } from '@/components/WorkyUI';
import { useColors } from '@/hooks/useColors';
import type { WorkyRole } from '@/lib/role-switch';

export type { WorkyRole } from '@/lib/role-switch';

const options: { role: WorkyRole; label: string; icon: React.ComponentProps<typeof Feather>['name'] }[] = [
  { role: 'cliente', label: 'Cliente', icon: 'search' },
  { role: 'profesional', label: 'Partner', icon: 'briefcase' },
];

export function RoleSwitcher({
  role,
  onSelect,
  disabled = false,
  loading = false,
}: {
  role: WorkyRole;
  onSelect: (role: WorkyRole) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const colors = useColors();

  return (
    <View>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Cambiar perfil de uso"
        style={{
          flexDirection: 'row',
          gap: 4,
          padding: 4,
          borderRadius: 14,
          backgroundColor: colors.muted,
        }}
      >
        {options.map((option) => {
          const selected = role === option.role;
          return (
            <Pressable
              key={option.role}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: selected, disabled }}
              aria-checked={selected}
              disabled={disabled}
              onPress={() => onSelect(option.role)}
              testID={`button-role-${option.role === 'profesional' ? 'partner' : 'cliente'}`}
              style={({ pressed }) => ({
                minHeight: 42,
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
                paddingHorizontal: 8,
                borderRadius: 11,
                backgroundColor: selected ? colors.card : 'transparent',
                borderWidth: selected ? 1 : 0,
                borderColor: selected ? colors.border : 'transparent',
                opacity: disabled ? 0.6 : pressed ? 0.82 : 1,
              })}
            >
              <Feather
                name={option.icon}
                size={15}
                color={selected ? colors.primary : colors.mutedForeground}
              />
              <AppText
                variant="label"
                style={{ color: selected ? colors.secondary : colors.mutedForeground }}
              >
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {loading ? (
        <ActivityIndicator
          accessibilityLabel="Actualizando perfil"
          size="small"
          color={colors.primary}
          style={{ marginTop: 8 }}
        />
      ) : null}
    </View>
  );
}