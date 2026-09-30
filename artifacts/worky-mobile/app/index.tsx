import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { StateMessage } from '@/components/WorkyUI';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';

export default function IndexRoute() {
  const colors = useColors();
  const { state, refreshSession } = useAuth();

  if (state === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.background, padding: 24 }}>
        <StateMessage
          icon="wifi-off"
          title="No pudimos validar tu sesión"
          message="Revisá tu conexión e intentá de nuevo."
          action={{ label: 'Reintentar', onPress: () => void refreshSession() }}
        />
      </View>
    );
  }

  return <Redirect href={state === 'signed-in' ? '/(tabs)' : '/(auth)/login'} />;
}