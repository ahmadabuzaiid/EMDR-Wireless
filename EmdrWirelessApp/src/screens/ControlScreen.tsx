import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ColorPicker from 'react-native-wheel-color-picker';
import StepSlider from '../components/StepSlider';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useSession } from '../context/SessionContext';
import { colors } from '../theme/colors';
import { rgbToHex, hexToRgb } from '../utils/color';
import {
  INTENSITY_USER_MIN,
  INTENSITY_USER_MAX,
  FULL_DELAY_USER_MIN,
  FULL_DELAY_USER_MAX,
  MOTOR_DELAY_USER_MIN,
  MOTOR_DELAY_USER_MAX,
} from '../utils/rangeMapping';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Control'>;

export default function ControlScreen() {
  const navigation = useNavigation<Nav>();
  const {
    pulsatorsEnabled,
    lightBarEnabled,
    statuses,
    intensityUser,
    setIntensityUser,
    fullDelayUser,
    setFullDelayUser,
    motorDelayUser,
    setMotorDelayUser,
    color,
    setColor,
    running,
    toggleRunning,
    disconnect,
    lastError,
    clearLastError,
  } = useSession();

  const connectedCount = useMemo(
    () => Object.values(statuses).filter(s => s === 'connected').length,
    [statuses],
  );
  const activeCount = (pulsatorsEnabled ? 2 : 0) + (lightBarEnabled ? 1 : 0);

  const timingValue = lightBarEnabled ? fullDelayUser : motorDelayUser;
  const timingMin = lightBarEnabled ? FULL_DELAY_USER_MIN : MOTOR_DELAY_USER_MIN;
  const timingMax = lightBarEnabled ? FULL_DELAY_USER_MAX : MOTOR_DELAY_USER_MAX;
  const timingLabel = lightBarEnabled ? 'Full Delay' : 'Motor Delay';
  const onTimingChange = lightBarEnabled ? setFullDelayUser : setMotorDelayUser;

  const onDisconnect = async () => {
    // Best-effort: disconnect() itself never throws, but this still guarantees
    // navigation happens regardless, so a BLE hiccup can never strand the user
    // on this screen with no way back to Device Select.
    try {
      await disconnect();
    } catch (err) {
      console.warn('Disconnect failed:', err);
    }
    navigation.replace('DeviceSelect');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Session Control</Text>
          <View style={styles.headerActions}>
            <View style={styles.badge}>
              <View style={styles.badgeDot} />
              <Text style={styles.badgeText}>
                {connectedCount}/{activeCount} connected
              </Text>
            </View>
            <Pressable
              style={styles.settingsButton}
              onPress={() => navigation.navigate('Settings')}
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <View style={styles.settingsIcon} />
            </Pressable>
          </View>
        </View>

        {lastError && (
          <Pressable style={styles.errorBanner} onPress={clearLastError} accessibilityRole="button">
            <Text style={styles.errorBannerText}>{lastError}</Text>
            <Text style={styles.errorBannerDismiss}>Tap to dismiss</Text>
          </Pressable>
        )}

        {pulsatorsEnabled && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Pulsator Intensity</Text>
              <Text style={styles.cardValue}>{intensityUser}</Text>
            </View>
            <StepSlider
              min={INTENSITY_USER_MIN}
              max={INTENSITY_USER_MAX}
              value={intensityUser}
              onChange={setIntensityUser}
            />
          </View>
        )}

        {(pulsatorsEnabled || lightBarEnabled) && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{timingLabel}</Text>
              <Text style={styles.cardValue}>{timingValue}</Text>
            </View>
            <StepSlider
              min={timingMin}
              max={timingMax}
              value={timingValue}
              onChange={onTimingChange}
            />
          </View>
        )}

        {lightBarEnabled && (
          <View style={styles.card}>
            <Text style={styles.colorTitle}>Light Color</Text>
            <View style={styles.colorPicker}>
              <ColorPicker
                color={rgbToHex(color.r, color.g, color.b)}
                onColorChangeComplete={(hex: string) => setColor(hexToRgb(hex))}
                thumbSize={28}
                sliderSize={28}
                noSnap
                row={false}
                swatches={false}
              />
            </View>
          </View>
        )}

        <View style={styles.flexSpacer} />

        <View style={styles.actions}>
          <Pressable
            style={[styles.button, running && styles.buttonStop]}
            onPress={toggleRunning}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{running ? 'Stop Session' : 'Start Session'}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={onDisconnect} accessibilityRole="button">
            <Text style={styles.secondaryButtonText}>Disconnect</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, padding: 24, paddingTop: 32, gap: 22 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  settingsButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsIcon: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 4,
    borderColor: colors.textMuted,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E9F7EF',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  badgeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  badgeText: { fontSize: 12, fontWeight: '600', color: colors.success },
  errorBanner: {
    backgroundColor: '#FDECEC',
    borderRadius: 12,
    padding: 14,
  },
  errorBannerText: { fontSize: 13, color: colors.danger, fontWeight: '600' },
  errorBannerDismiss: { fontSize: 11, color: colors.danger, marginTop: 4, opacity: 0.7 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 18,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  colorTitle: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 12 },
  colorPicker: { height: 260 },
  cardValue: { fontSize: 14, fontWeight: '600', color: colors.primary },
  flexSpacer: { minHeight: 12, flexGrow: 1 },
  actions: { gap: 10 },
  button: {
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonStop: { backgroundColor: colors.danger },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  secondaryButton: {
    height: 48,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
});
