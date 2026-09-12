import React, { useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useActivation } from '../auth/useActivation';
import { colors } from '../theme/colors';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Otp'>;

const DIGIT_COUNT = 6;

export default function OtpScreen() {
  const navigation = useNavigation<Nav>();
  const { verify } = useActivation();
  const [digits, setDigits] = useState<string[]>(Array(DIGIT_COUNT).fill(''));
  const [error, setError] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const inputs = useRef<Array<React.ElementRef<typeof TextInput> | null>>([]);

  const code = digits.join('');
  const complete = code.length === DIGIT_COUNT;

  const onChangeDigit = (text: string, index: number) => {
    const value = text.replace(/[^0-9]/g, '').slice(-1);
    setError(false);
    setDigits(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    if (value && index < DIGIT_COUNT - 1) {
      inputs.current[index + 1]?.focus();
    }
  };

  const onKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const onVerify = async () => {
    if (!complete || verifying) return;
    setVerifying(true);
    Keyboard.dismiss();
    const ok = await verify(code);
    setVerifying(false);
    if (ok) {
      navigation.replace('DeviceSelect');
    } else {
      setError(true);
      setDigits(Array(DIGIT_COUNT).fill(''));
      inputs.current[0]?.focus();
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.iconCircle}>
          <View style={styles.iconLock} />
        </View>

        <Text style={styles.title}>Activate This App</Text>
        <Text style={styles.subtitle}>
          This is the first time the app has been opened on this device. Please contact
          your device provider to receive a one-time activation code.
        </Text>

        <View style={styles.digitsRow}>
          {digits.map((digit, index) => (
            <TextInput
              key={index}
              ref={ref => {
                inputs.current[index] = ref;
              }}
              style={[styles.digitBox, error && styles.digitBoxError]}
              value={digit}
              onChangeText={text => onChangeDigit(text, index)}
              onKeyPress={({ nativeEvent }) => onKeyPress(nativeEvent.key, index)}
              keyboardType="number-pad"
              maxLength={1}
              textAlign="center"
            />
          ))}
        </View>
        <Text style={styles.helperText}>
          {error ? 'Incorrect code, try again' : '6-digit code'}
        </Text>

        <View style={styles.flexSpacer} />

        <Pressable
          style={[styles.button, !complete && styles.buttonDisabled]}
          onPress={onVerify}
          disabled={!complete || verifying}
          accessibilityRole="button"
        >
          <Text style={[styles.buttonText, !complete && styles.buttonTextDisabled]}>
            {verifying ? 'Verifying…' : 'Verify Code'}
          </Text>
        </Pressable>

        <Text style={styles.footnote}>Need help? Contact your provider.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, alignItems: 'center', paddingHorizontal: 28, paddingVertical: 40 },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  iconLock: { width: 22, height: 16, borderRadius: 4, backgroundColor: colors.primary },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, textAlign: 'center' },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 12,
    maxWidth: 300,
  },
  digitsRow: { flexDirection: 'row', gap: 10, marginTop: 36 },
  digitBox: {
    width: 44,
    height: 56,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    fontSize: 22,
    fontWeight: '600',
    color: colors.text,
  },
  digitBoxError: { borderColor: colors.danger },
  helperText: { fontSize: 12, color: colors.textMuted, marginTop: 12 },
  flexSpacer: { flex: 1 },
  button: {
    width: '100%',
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { backgroundColor: colors.border },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  buttonTextDisabled: { color: colors.textMuted },
  footnote: { fontSize: 13, color: colors.textMuted, marginTop: 20, textAlign: 'center' },
});
