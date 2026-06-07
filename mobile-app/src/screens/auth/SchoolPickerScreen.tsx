import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { searchSchools } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/providers/AuthProvider';
import type { RootStackParamList } from '@/navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'SchoolPicker'>;

export function SchoolPickerScreen({ navigation }: Props) {
  const [search, setSearch] = useState('');
  const { setTenant } = useAuth();
  const query = useQuery({
    queryKey: ['schools', search],
    queryFn: () => searchSchools(search),
    enabled: search.trim().length >= 2,
  });

  return (
    <Screen scroll={false}>
      <AppText variant="label">SISMU Mobile</AppText>
      <AppText variant="title">Pilih sekolah</AppText>
      <AppText>Cari berdasarkan nama sekolah, slug, atau subdomain. Minimal 2 karakter.</AppText>
      <TextInput
        placeholder="contoh: sman3bogor"
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        style={styles.input}
      />
      <FlatList
        data={query.data || []}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={search.trim().length < 2
          ? <EmptyState title="Cari sekolah" description="Ketik nama atau kode sekolah dulu." />
          : query.isLoading
            ? <EmptyState title="Mencari sekolah..." />
            : <EmptyState title="Tidak ada sekolah" description="Periksa kembali kata kunci." />}
        renderItem={({ item }) => (
          <Pressable
            onPress={async () => {
              await setTenant(item);
              navigation.replace('Login');
            }}
          >
            <Card>
              <AppText variant="subtitle">{item.name}</AppText>
              <AppText>{item.slug} - {item.host || item.apiBaseUrl}</AppText>
              <Button label="Gunakan sekolah ini" />
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    height: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
    fontSize: 16,
  },
  list: {
    gap: 12,
    paddingBottom: 32,
  },
});
