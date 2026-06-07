import React, { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { loginMobile } from '@/api/mobileApi';
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
  const [error, setError] = useState('');

  async function submit() {
    if (!tenant) return navigation.replace('SchoolPicker');
    setLoading(true);
    setError('');
    try {
      const session = await loginMobile(tenant, identifier.trim(), password);
      await signIn(session);
      navigation.replace(session.profile.role === 'guru' ? 'Guru' : 'Siswa');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login gagal');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <AppText variant="label">Masuk sekolah</AppText>
      <AppText variant="title">{tenant?.name || 'Pilih sekolah dulu'}</AppText>
      <Card>
        <TextInput placeholder="Email guru atau NIS siswa" value={identifier} onChangeText={setIdentifier} autoCapitalize="none" style={styles.input} />
        <TextInput placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry style={styles.input} />
        {error ? <AppText color="#dc2626">{error}</AppText> : null}
        <Button label="Masuk" loading={loading} disabled={!identifier || !password || !tenant} onPress={submit} />
        <View style={styles.row}>
          <Button label="Ganti sekolah" tone="secondary" onPress={async () => {
            await signOut(false);
            navigation.replace('SchoolPicker');
          }} />
        </View>
      </Card>
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
  row: {
    marginTop: 4,
  },
});
