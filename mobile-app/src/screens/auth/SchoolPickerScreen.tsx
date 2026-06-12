import React, { useEffect, useRef, useState } from 'react';
import { Animated, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { searchSchools } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/providers/AuthProvider';
import type { RootStackParamList } from '@/navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'SchoolPicker'>;

export function SchoolPickerScreen({ navigation }: Props) {
  const [search, setSearch] = useState('');
  const { setTenant } = useAuth();

  // Animations
  const heroAnim = useRef(new Animated.Value(0)).current;
  const searchAnim = useRef(new Animated.Value(20)).current;
  const searchOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(heroAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(searchAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.timing(searchOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
    ]).start();
  }, [heroAnim, searchAnim, searchOpacity]);

  const query = useQuery({
    queryKey: ['schools', search],
    queryFn: () => searchSchools(search),
    enabled: search.trim().length >= 2,
  });

  const chooseSchool = async (item: Awaited<ReturnType<typeof searchSchools>>[number]) => {
    await setTenant(item);
    navigation.replace('Login');
  };

  return (
    <Screen scroll={false}>
      {/* Hero Header */}
      <Animated.View style={[styles.hero, { opacity: heroAnim }]}>
        <View style={styles.logoCircle}>
          <AppText style={styles.logoEmoji}>🏫</AppText>
        </View>
        <AppText variant="hero">SISMU Mobile</AppText>
        <AppText style={styles.heroSub}>
          Sistem Informasi Sekolah Modern{'\n'}Pilih sekolah untuk memulai
        </AppText>
      </Animated.View>

      {/* Search */}
      <Animated.View style={{ opacity: searchOpacity, transform: [{ translateY: searchAnim }] }}>
        <View style={styles.searchContainer}>
          <AppText style={styles.searchIcon}>🔍</AppText>
          <TextInput
            placeholder="Cari nama sekolah, slug, atau kode..."
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            style={styles.searchInput}
            placeholderTextColor="#94a3b8"
          />
        </View>
      </Animated.View>

      {/* Results */}
      <FlatList
        data={query.data || []}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          search.trim().length < 2
            ? <EmptyState icon="🏫" title="Cari sekolah" description="Ketik minimal 2 karakter untuk mencari." />
            : query.isLoading
              ? <EmptyState icon="⏳" title="Mencari sekolah..." />
              : <EmptyState icon="😕" title="Tidak ditemukan" description="Periksa kembali kata kunci." />
        }
        renderItem={({ item, index }) => (
          <SchoolCard item={item} index={index} onPress={() => chooseSchool(item)} />
        )}
      />
    </Screen>
  );
}

function SchoolCard({ item, index, onPress }: {
  item: { name: string; slug: string; host?: string | null; apiBaseUrl: string };
  index: number;
  onPress: () => void;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(anim, { toValue: 1, duration: 400, delay: index * 100, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 400, delay: index * 100, useNativeDriver: true }),
    ]).start();
  }, [anim, slide, index]);

  return (
    <Animated.View style={{ opacity: anim, transform: [{ translateY: slide }] }}>
      <Pressable onPress={onPress}>
        <Card tone="white">
          <View style={styles.schoolRow}>
            <View style={styles.schoolIcon}>
              <AppText style={{ fontSize: 24 }}>🎓</AppText>
            </View>
            <View style={styles.schoolInfo}>
              <AppText variant="subtitle">{item.name}</AppText>
              <AppText variant="caption">{item.slug} • {item.host || item.apiBaseUrl}</AppText>
            </View>
          </View>
        </Card>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: 8,
    paddingTop: 24,
    paddingBottom: 8,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
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
  logoEmoji: {
    fontSize: 36,
  },
  heroSub: {
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    color: '#64748b',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#0f172a',
  },
  list: {
    gap: 10,
    paddingBottom: 32,
    paddingTop: 4,
  },
  schoolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  schoolIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  schoolInfo: {
    flex: 1,
    gap: 2,
  },
});
