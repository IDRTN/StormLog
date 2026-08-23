// Storm-chasing dark theme colors
export const Colors = {
  background: '#0D1117',
  surface: '#161B22',
  surfaceVariant: '#21262D',
  primary: '#58A6FF',
  primaryDark: '#1F6FEB',
  secondary: '#3FB950',
  warning: '#F0883E',
  danger: '#F85149',
  text: '#C9D1D9',
  textSecondary: '#8B949E',
  white: '#F0F6FC',

  temperature: '#F85149',
  humidity: '#58A6FF',
  pressure: '#3FB950',
  wind: '#F0883E',
  dewPoint: '#BC8CFF',
  precipitation: '#79C0FF',

  loggingActive: '#3FB950',
  loggingPulse: 'rgba(63, 185, 80, 0.5)',
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const BORDER_RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
} as const;
