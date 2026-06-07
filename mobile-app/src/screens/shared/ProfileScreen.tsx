import React from 'react';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/providers/AuthProvider';

export function ProfileScreen() {
  const { session, signOut } = useAuth();

  return (
    <Screen>
      <AppText variant="label">Profil</AppText>
      <AppText variant="title">{session?.profile.nama || 'Pengguna'}</AppText>
      <Card>
        <AppText>Email: {session?.profile.email || '-'}</AppText>
        <AppText>Role: {session?.profile.role || '-'}</AppText>
        <AppText>Kelas: {session?.profile.kelas || '-'}</AppText>
        <AppText>Sekolah: {session?.tenant.name || '-'}</AppText>
      </Card>
      <Button label="Logout" tone="danger" onPress={() => signOut(true)} />
      <Button label="Ganti sekolah" tone="secondary" onPress={() => signOut(false)} />
    </Screen>
  );
}
