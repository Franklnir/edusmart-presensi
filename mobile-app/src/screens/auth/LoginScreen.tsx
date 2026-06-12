import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Linking, StyleSheet, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { loginMobile } from '@/api/mobileApi';
import { apiBaseUrl, apiRequest } from '@/api/client';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { RootStackParamList } from '@/navigation/RootNavigator';
import { useAuth } from '@/providers/AuthProvider';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const { tenant, signIn, signOut } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [lockSeconds, setLockSeconds] = useState(0);

  // Animations
  const logoAnim = useRef(new Animated.Value(0)).current;
  const formAnim = useRef(new Animated.Value(30)).current;
  const formOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(logoAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(formAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(formOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    ]).start();
  }, [logoAnim, formAnim, formOpacity]);

  // Google OAuth — deep link flow
  // 1. Open browser to /api/auth/google/mobile/redirect?redirect_uri=edusmart-presensi://google-auth&X-Tenant=slug
  // 2. User authenticates with Google
  // 3. Backend redirects to edusmart-presensi://google-auth?google=success&ticket=xxx
  // 4. App exchanges ticket via POST /api/auth/google/mobile/exchange
  const handleGoogleLogin = useCallback(async () => {
    if (!tenant) return;
    setGoogleLoading(true);
    setError('');

    try {
      const redirectUri = 'edusmart-presensi://google-auth';
      const base = apiBaseUrl();
      const url = `${base}/api/auth/google/mobile/redirect?redirect_uri=${encodeURIComponent(redirectUri)}&X-Tenant=${encodeURIComponent(tenant.slug)}`;
      await Linking.openURL(url);
    } catch (err) {
      setError('Tidak bisa membuka browser untuk login Google.');
      setGoogleLoading(false);
    }
  }, [tenant]);

  // Handle deep link callback
  useEffect(() => {
    const handleUrl = async ({ url }: { url: string }) => {
      if (!url.includes('google-auth')) return;

      const params = new URL(url).searchParams;
      const googleStatus = params.get('google');
      const ticket = params.get('ticket');
      const googleError = params.get('google_error');

      if (googleStatus === 'success' && ticket) {
        setGoogleLoading(true);
        setError('');
        try {
          const data = await apiRequest<{
            access_token?: string;
            profile?: { id: string; nama?: string; role: 'guru' | 'siswa'; kelas?: string; email?: string };
          }>('/api/auth/google/mobile/exchange', {
            method: 'POST',
            body: JSON.stringify({ ticket }),
          });

          if (data.access_token && data.profile && tenant) {
            await signIn({
              token: data.access_token,
              tenant,
              profile: {
                id: data.profile.id,
                nama: data.profile.nama ?? null,
                email: data.profile.email ?? null,
                role: data.profile.role,
                kelas: data.profile.kelas ?? null,
              },
            });
            navigation.replace(data.profile.role === 'guru' ? 'Guru' : 'Siswa');
          } else {
            setError('Login Google berhasil tapi data profil tidak lengkap.');
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Gagal menukar tiket Google.');
        } finally {
          setGoogleLoading(false);
        }
      } else if (googleError) {
        setError(decodeURIComponent(googleError));
        setGoogleLoading(false);
      } else {
        setError('Login Google dibatalkan.');
        setGoogleLoading(false);
      }
    };

    const subscription = Linking.addEventListener('url', handleUrl);
    // Check if app was opened from a deep link
    Linking.getInitialURL().then(url => {
      if (url) handleUrl({ url });
    });

    return () => subscription.remove();
  }, [tenant, signIn, navigation]);

  // Rate limit countdown
  useEffect(() => {
    if (!lockUntil) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
      setLockSeconds(remaining);
      if (remaining <= 0) {
        setLockUntil(null);
        setAttempts(0);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lockUntil]);

  const isLocked = lockUntil != null && Date.now() < lockUntil;

  async function submit() {
    if (!tenant) return navigation.replace('SchoolPicker');
    if (isLocked) return;

    setLoading(true);
    setError('');
    try {
      const session = await loginMobile(tenant, identifier.trim(), password);
      setAttempts(0);
      await signIn(session);
      navigation.replace(session.profile.role === 'guru' ? 'Guru' : 'Siswa');
    } catch (err) {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      if (newAttempts >= 5) {
        const lockDuration = 30 * 1000; // 30 seconds
        setLockUntil(Date.now() + lockDuration);
        setError(`Terlalu banyak percobaan. Coba lagi dalam 30 detik.`);
      } else {
        setError(err instanceof Error ? err.message : 'Login gagal');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      {/* Header */}
      <Animated.View style={[styles.header, { opacity: logoAnim }]}>
        <View style={styles.logoCircle}>
          <AppText style={styles.logoText}>📚</AppText>
        </View>
        <AppText variant="hero">Masuk</AppText>
        <AppText>{tenant?.name || 'Pilih sekolah dulu'}</AppText>
      </Animated.View>

      {/* Form */}
      <Animated.View style={{ opacity: formOpacity, transform: [{ translateY: formAnim }] }}>
        <Card tone="white">
          <View style={styles.inputGroup}>
            <AppText variant="caption" style={styles.inputLabel}>EMAIL / NIS</AppText>
            <TextInput
              placeholder="Masukkan email guru atau NIS siswa"
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
              placeholderTextColor="#94a3b8"
            />
          </View>

          <View style={styles.inputGroup}>
            <AppText variant="caption" style={styles.inputLabel}>PASSWORD</AppText>
            <TextInput
              placeholder="Masukkan password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              style={styles.input}
              placeholderTextColor="#94a3b8"
            />
          </View>

          {error ? (
            <View style={styles.errorBanner}>
              <AppText style={styles.errorText}>⚠️ {error}</AppText>
            </View>
          ) : null}

          <Button
            label={isLocked ? `Terkunci (${lockSeconds}s)` : 'Masuk'}
            loading={loading}
            disabled={!identifier || !password || !tenant || isLocked}
            onPress={submit}
          />

          {/* Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <AppText variant="caption" style={styles.dividerText}>atau</AppText>
            <View style={styles.dividerLine} />
          </View>

          {/* Google Login */}
          <Button
            label="Masuk dengan Google"
            tone="google"
            icon="🔵"
            loading={googleLoading}
            disabled={!tenant}
            onPress={handleGoogleLogin}
          />
        </Card>

        <Button
          label="← Ganti sekolah"
          tone="ghost"
          onPress={async () => {
            await signOut(false);
            navigation.replace('SchoolPicker');
          }}
        />
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    gap: 8,
    paddingTop: 16,
    paddingBottom: 8,
  },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: '#4f46e5',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  logoText: {
    fontSize: 32,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontWeight: '700',
    letterSpacing: 1,
    color: '#64748b',
  },
  input: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    paddingHorizontal: 16,
    backgroundColor: '#f8fafc',
    fontSize: 15,
    color: '#0f172a',
  },
  errorBanner: {
    backgroundColor: '#fef2f2',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e2e8f0',
  },
  dividerText: {
    color: '#94a3b8',
    fontWeight: '600',
  },
});
