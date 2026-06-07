import type { UserProfile } from '@/types/mobile';

function isMobileRole(profile: Pick<UserProfile, 'role'>) {
  return profile.role === 'guru' || profile.role === 'siswa';
}

it('allows only guru and siswa roles for mobile', () => {
  expect(isMobileRole({ role: 'guru' })).toBe(true);
  expect(isMobileRole({ role: 'siswa' })).toBe(true);
  expect(isMobileRole({ role: 'admin' as never })).toBe(false);
});
