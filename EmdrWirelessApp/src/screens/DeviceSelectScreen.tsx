import React, { useMemo } from 'react';
import { View, Text, Switch, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useSession } from '../context/SessionContext';
import { DeviceRole, DEVICE_ROLE_NAMES } from '../ble/constants';
import { DeviceStatus } from '../ble/BleService';
import { colors } from '../theme/colors';

type Nav = NativeStackNavigationProp<RootStackParamList, 'DeviceSelect'>;

const STATUS_LABEL: Record<DeviceStatus, string> = {
  scanning: 'Scanning…',
  connecting: 'Connecting…',
  connected: 'Connected',
  not_found: 'Not found',
  error: 'Connection failed',
};

function statusColor(status: DeviceStatus | undefined): string {
  if (status === 'connected') return colors.success;
  if (status === 'not_found' || status === 'error') return colors.danger;
  if (status) return colors.primary;
  return colors.textMuted;
}

export default function DeviceSelectScreen() {
  const navigation = useNavigation<Nav>();
  const {
    pulsatorsEnabled,
    lightBarEnabled,
    togglePulsators,
    toggleLightBar,
    statuses,
    connecting,
    connect,
    allConnected,
    bleError,
  } = useSession();

  const bleErrorText =
    bleError === 'powered_off'
      ? 'Bluetooth is turned off. Please turn it on and try again.'
      : bleError === 'permissions_denied'
      ? 'Bluetooth permission is required to connect. Please allow it in your phone’s settings.'
      : null;

  const activeRoles = useMemo<DeviceRole[]>(() => {
    const roles: DeviceRole[] = [];
    if (pulsatorsEnabled) roles.push('pulsator1', 'pulsator2');
    if (lightBarEnabled) roles.push('lightBar');
    return roles;
  }, [pulsatorsEnabled, lightBarEnabled]);

  const hasAttemptedConnect = Object.keys(statuses).length > 0;
  const nothingEnabled = !pulsatorsEnabled && !lightBarEnabled;

  const onPrimaryAction = () => {
    if (allConnected) {
      navigation.navigate('Control');
    } else {
      connect();
    }
  };

  const primaryLabel = connecting
    ? 'Connecting…'
    : allConnected
    ? 'Continue to Controls'
    : 'Connect Devices';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Connect Your Devices</Text>
        <Text style={styles.subtitle}>Choose which parts of your kit to use this session.</Text>

        <View style={styles.cardGroup}>
          <View style={styles.card}>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>Pulsators</Text>
              <Text style={styles.cardSubtitle}>Two wireless tactile pulsators</Text>
            </View>
            <Switch
              value={pulsatorsEnabled}
              onValueChange={togglePulsators}
              disabled={connecting}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>

          <View style={styles.card}>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>Light Bar</Text>
              <Text style={styles.cardSubtitle}>Visual sweep stimulation</Text>
            </View>
            <Switch
              value={lightBarEnabled}
              onValueChange={toggleLightBar}
              disabled={connecting}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
        </View>

        {bleErrorText && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{bleErrorText}</Text>
          </View>
        )}

        {hasAttemptedConnect && (
          <>
            <Text style={styles.sectionLabel}>Connection Status</Text>
            <View style={styles.statusGroup}>
              {activeRoles.map(role => (
                <View key={role} style={styles.statusRow}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor(statuses[role]) }]} />
                  <Text style={styles.statusRoleLabel}>{DEVICE_ROLE_NAMES[role]}</Text>
                  <Text style={[styles.statusText, { color: statusColor(statuses[role]) }]}>
                    {statuses[role] ? STATUS_LABEL[statuses[role] as DeviceStatus] : ''}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        <View style={styles.flexSpacer} />

        <Pressable
          style={[styles.button, (nothingEnabled || connecting) && styles.buttonDisabled]}
          onPress={onPrimaryAction}
          disabled={nothingEnabled || connecting}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{primaryLabel}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, padding: 24, paddingTop: 40 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 14, color: colors.textMuted, marginTop: 6 },
  cardGroup: { gap: 12, marginTop: 24 },
  errorBanner: {
    backgroundColor: '#FDECEC',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
  },
  errorBannerText: { fontSize: 13, color: colors.danger, fontWeight: '600' },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  cardText: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  cardSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 32,
    marginBottom: 12,
  },
  statusGroup: { gap: 10 },
  statusRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusRoleLabel: { flex: 1, fontSize: 14, fontWeight: '500', color: colors.text },
  statusText: { fontSize: 13, fontWeight: '600' },
  flexSpacer: { minHeight: 24, flexGrow: 1 },
  button: {
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
});
