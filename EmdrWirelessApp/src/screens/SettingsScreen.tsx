import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, ScrollView, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, CommonActions } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useSession } from '../context/SessionContext';
import { useActivation } from '../auth/useActivation';
import { colors } from '../theme/colors';
import { LED_COUNT_MIN, LED_COUNT_MAX } from '../utils/rangeMapping';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

export default function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const { ledCount, setLedCount } = useSession();
  const { deactivate } = useActivation();

  const [confirming, setConfirming] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [working, setWorking] = useState(false);

  const onConfirmDeactivate = async () => {
    if (code.length !== 6 || working) return;
    setWorking(true);
    Keyboard.dismiss();
    const ok = await deactivate(code);
    setWorking(false);
    if (!ok) {
      setError(true);
      setCode('');
      return;
    }
    // Reset the stack so the device can never be navigated "back" into a
    // control screen it's no longer authorized to reach.
    navigation.dispatch(
      CommonActions.reset({ index: 0, routes: [{ name: 'Welcome' }] }),
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" hitSlop={12}>
            <Text style={styles.backText}>‹ Back</Text>
          </Pressable>
          <Text style={styles.title}>Settings</Text>
          <View style={styles.backSpacer} />
        </View>

        <Text style={styles.sectionLabel}>Light Strip</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>LED Count</Text>
          <Text style={styles.cardSubtitle}>
            Must match the physical strip length wired to the Light Bar. Used only to
            convert the Cycle Time slider into a per-LED delay - the firmware doesn't
            report its own count back, so this has to be kept in sync manually.
          </Text>
          <View style={styles.stepperRow}>
            <Pressable
              style={styles.stepperButton}
              onPress={() => setLedCount(ledCount - 1)}
              disabled={ledCount <= LED_COUNT_MIN}
              accessibilityRole="button"
            >
              <Text style={styles.stepperButtonText}>−</Text>
            </Pressable>
            <Text style={styles.stepperValue}>{ledCount}</Text>
            <Pressable
              style={styles.stepperButton}
              onPress={() => setLedCount(ledCount + 1)}
              disabled={ledCount >= LED_COUNT_MAX}
              accessibilityRole="button"
            >
              <Text style={styles.stepperButtonText}>+</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Device Access</Text>
        <View style={styles.card}>
          {!confirming ? (
            <>
              <Text style={styles.cardTitle}>Deactivate This Device</Text>
              <Text style={styles.cardSubtitle}>
                Removes this device's activation. The next time the app opens, it will
                ask for a new one-time code from your provider.
              </Text>
              <Pressable
                style={styles.dangerButton}
                onPress={() => {
                  setConfirming(true);
                  setError(false);
                  setCode('');
                }}
                accessibilityRole="button"
              >
                <Text style={styles.dangerButtonText}>Deactivate This Device</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.cardTitle}>Confirm with a current admin code</Text>
              <Text style={styles.cardSubtitle}>
                {error ? 'Incorrect code, try again.' : 'Enter the current 6-digit code to confirm.'}
              </Text>
              <TextInput
                style={[styles.codeInput, error && styles.codeInputError]}
                value={code}
                onChangeText={text => {
                  setError(false);
                  setCode(text.replace(/[^0-9]/g, '').slice(0, 6));
                }}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="000000"
                placeholderTextColor={colors.textMuted}
              />
              <View style={styles.confirmRow}>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => setConfirming(false)}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.dangerButton,
                    styles.dangerButtonInRow,
                    code.length !== 6 && styles.buttonDisabled,
                  ]}
                  onPress={onConfirmDeactivate}
                  disabled={code.length !== 6 || working}
                  accessibilityRole="button"
                >
                  <Text style={styles.dangerButtonText}>{working ? 'Checking…' : 'Confirm'}</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, padding: 24, paddingTop: 32, gap: 22 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backText: { fontSize: 16, color: colors.primary, fontWeight: '600' },
  backSpacer: { width: 44 },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: -10,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 18,
    gap: 10,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  cardSubtitle: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginTop: 6 },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonText: { fontSize: 22, fontWeight: '600', color: colors.primary },
  stepperValue: { fontSize: 22, fontWeight: '700', color: colors.text, minWidth: 48, textAlign: 'center' },
  dangerButton: {
    height: 50,
    borderRadius: 14,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  dangerButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  dangerButtonInRow: { flex: 1, marginTop: 0 },
  buttonDisabled: { opacity: 0.5 },
  codeInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 20,
    letterSpacing: 6,
    color: colors.text,
    textAlign: 'center',
  },
  codeInputError: { borderColor: colors.danger },
  confirmRow: { flexDirection: 'row', gap: 10 },
  secondaryButton: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
});
