import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import Slider from '@react-native-community/slider';
import ColorPicker from 'react-native-wheel-color-picker';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useSession } from '../context/SessionContext';
import { colors } from '../theme/colors';
import { rgbToHex, hexToRgb } from '../utils/color';
import {
  INTENSITY_USER_MIN,
  INTENSITY_USER_MAX,
  CYCLE_MS_MIN,
  CYCLE_MS_MAX,
  PULSATOR_DELAY_MIN_MS,
  PULSATOR_DELAY_MAX_MS,
  msToSecondsLabel,
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
    cycleMs,
    setCycleMs,
    pulsatorOnlyDelayMs,
    setPulsatorOnlyDelayMs,
    color,
    setColor,
    running,
    toggleRunning,
    disconnect,
  } = useSession();

  const connectedCount = useMemo(
    () => Object.values(statuses).filter(s => s === 'connected').length,
    [statuses],
  );
  const activeCount = (pulsatorsEnabled ? 2 : 0) + (lightBarEnabled ? 1 : 0);

  const timingMs = lightBarEnabled ? cycleMs : pulsatorOnlyDelayMs;
  const timingMin = lightBarEnabled ? CYCLE_MS_MIN : PULSATOR_DELAY_MIN_MS;
  const timingMax = lightBarEnabled ? CYCLE_MS_MAX : PULSATOR_DELAY_MAX_MS;
  const timingLabel = lightBarEnabled ? 'Cycle Time' : 'Pulsator Delay';
  const onTimingChange = lightBarEnabled ? setCycleMs : setPulsatorOnlyDelayMs;

  const onDisconnect = async () => {
    await disconnect();
    navigation.replace('DeviceSelect');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Session Control</Text>
          <View style={styles.badge}>
            <View style={styles.badgeDot} />
            <Text style={styles.badgeText}>
              {connectedCount}/{activeCount} connected
            </Text>
          </View>
        </View>

        {pulsatorsEnabled && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Pulsator Intensity</Text>
              <Text style={styles.cardValue}>{intensityUser}</Text>
            </View>
            <Slider
              minimumValue={INTENSITY_USER_MIN}
              maximumValue={INTENSITY_USER_MAX}
              step={1}
              value={intensityUser}
              onValueChange={setIntensityUser}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.border}
              thumbTintColor={colors.primary}
            />
            <View style={styles.rangeRow}>
              <Text style={styles.rangeLabel}>{INTENSITY_USER_MIN}</Text>
              <Text style={styles.rangeLabel}>{INTENSITY_USER_MAX}</Text>
            </View>
          </View>
        )}

        {(pulsatorsEnabled || lightBarEnabled) && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{timingLabel}</Text>
              <Text style={styles.cardValue}>{msToSecondsLabel(timingMs)}</Text>
            </View>
            <Slider
              minimumValue={timingMin / 1000}
              maximumValue={timingMax / 1000}
              step={0.01}
              value={timingMs / 1000}
              onValueChange={seconds => onTimingChange(Math.round(seconds * 1000))}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.border}
              thumbTintColor={colors.primary}
            />
            <View style={styles.rangeRow}>
              <Text style={styles.rangeLabel}>{msToSecondsLabel(timingMin)}</Text>
              <Text style={styles.rangeLabel}>{msToSecondsLabel(timingMax)}</Text>
            </View>
          </View>
        )}

        {lightBarEnabled && (
          <View style={styles.card}>
            <Text style={[styles.cardTitle, { marginBottom: 12 }]}>Light Color</Text>
            <View style={{ height: 260 }}>
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
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 18,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  cardValue: { fontSize: 14, fontWeight: '600', color: colors.primary },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  rangeLabel: { fontSize: 11, color: colors.textMuted },
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
