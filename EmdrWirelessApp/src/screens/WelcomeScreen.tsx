import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useActivation } from '../auth/useActivation';
import { colors } from '../theme/colors';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Welcome'>;

export default function WelcomeScreen() {
  const navigation = useNavigation<Nav>();
  const { activated, checking } = useActivation();

  const onGetStarted = () => {
    navigation.replace(activated ? 'DeviceSelect' : 'Otp');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.brandBlock}>
          <View style={styles.logo} />
          <Text style={styles.eyebrow}>EMDR Therapy Kits</Text>
        </View>

        <View style={styles.copyBlock}>
          <Text style={styles.title}>Welcome to{'\n'}EMDR Therapy Kits</Text>
          <Text style={styles.subtitle}>
            Coordinated control for your wireless pulsators and light bar, built for
            clinical bilateral stimulation sessions.
          </Text>
        </View>

        <View style={styles.actionBlock}>
          <Pressable
            style={styles.button}
            onPress={onGetStarted}
            disabled={checking}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Get Started</Text>
          </Pressable>
          <Text style={styles.footnote}>For use by trained EMDR therapists only.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 40,
  },
  brandBlock: { alignItems: 'center', gap: 8 },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.primary,
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 2,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  copyBlock: { alignItems: 'center', gap: 16, maxWidth: 300 },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.textMuted,
    textAlign: 'center',
  },
  actionBlock: { width: '100%', alignItems: 'center', gap: 14 },
  button: {
    width: '100%',
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  footnote: { fontSize: 12, color: colors.textMuted },
});
