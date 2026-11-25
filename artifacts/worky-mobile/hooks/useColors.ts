import colors from '@/constants/colors';
import { useTheme } from '@/context/ThemeContext';

/**
 * Returns the design tokens for the user's saved Worky appearance.
 *
 * The returned object contains all color tokens for the active palette
 * plus scheme-independent values like `radius`.
 */
export function useColors() {
  const { mode } = useTheme();
  const palette = mode === 'dark' ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius };
}
