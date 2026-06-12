import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/providers/AuthProvider';
import { useColors } from '@/providers/ThemeProvider';

export function ProfileScreen() {
  const { session, signOut } = useAuth();
  const colors = useColors();
  const avatarAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.spring(avatarAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 8,
      bounciness: 10,
    }).start();
  }, [avatarAnim]);

  const isGuru = session?.profile.role === 'guru';

  return (
    <Screen>
      {/* Profile Header */}
      <View style={styles.header}>
        <Animated.View style={[styles.avatar, { backgroundColor: colors.primaryLight, transform: [{ scale: avatarAnim }] }]}>
          <AppText style={styles.avatarEmoji}>{isGuru ? '👨‍🏫' : '🎒'}</AppText>
        </Animated.View>
        <AppText variant="hero">{session?.profile.nama || 'Pengguna'}</AppText>
        <View style={[styles.roleBadge, { backgroundColor: colors.primary }]}>
          <AppText style={styles.roleText}>{isGuru ? 'Guru' : 'Siswa'}</AppText>
        </View>
      </View>

      {/* Info Card */}
      <Card tone="white">
        <ProfileRow icon="✉️" label="Email" value={session?.profile.email || '-'} />
        <ProfileRow icon="🏫" label="Sekolah" value={session?.tenant.name || '-'} />
        {session?.profile.kelas ? (
          <ProfileRow icon="🏷️" label="Kelas" value={session.profile.kelas} />
        ) : null}
        {session?.profile.nis ? (
          <ProfileRow icon="🔢" label="NIS" value={session.profile.nis} />
        ) : null}
      </Card>

      {/* Actions */}
      <View style={styles.actions}>
        <Button label="Logout" tone="danger" icon="🚪" onPress={() => signOut(true)} />
        <Button label="Ganti sekolah" tone="secondary" icon="🔄" onPress={() => signOut(false)} />
      </View>

      {/* App Info */}
      <Card tone="white">
        <AppText variant="caption" style={[styles.appInfo, { color: colors.textMuted }]}>
          SISMU Mobile v0.1.0 • Edusmart Presensi
        </AppText>
      </Card>
    </Screen>
  );
}

function ProfileRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.row}>
      <AppText style={styles.rowIcon}>{icon}</AppText>
      <View style={styles.rowContent}>
        <AppText variant="caption">{label}</AppText>
        <AppText variant="body" style={[styles.rowValue, { color: colors.text }]}>{value}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    gap: 8,
    paddingTop: 16,
    paddingBottom: 8,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
    marginBottom: 8,
  },
  avatarEmoji: {
    fontSize: 36,
  },
  roleBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  roleText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 6,
  },
  rowIcon: {
    fontSize: 20,
    width: 28,
    textAlign: 'center',
  },
  rowContent: {
    flex: 1,
    gap: 1,
  },
  rowValue: {
    fontWeight: '600',
  },
  actions: {
    gap: 10,
  },
  appInfo: {
    textAlign: 'center',
  },
});
