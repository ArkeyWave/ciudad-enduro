import type { CSSProperties } from 'react';

export const LIME = '#CCFF00';

export const primaryButton: CSSProperties = {
  background: LIME,
  color: '#0A0A0A',
  border: 0,
  borderRadius: 6,
  padding: '10px 16px',
  fontWeight: 700,
  cursor: 'pointer',
};

export const secondaryButton: CSSProperties = {
  ...primaryButton,
  background: 'transparent',
  color: '#F5F5F5',
  border: '1px solid #2A2A2A',
};

export const linkButton: CSSProperties = {
  background: 'none',
  border: 0,
  padding: 0,
  color: LIME,
  cursor: 'pointer',
  font: 'inherit',
};

export const input: CSSProperties = {
  background: '#141414',
  color: '#F5F5F5',
  border: '1px solid #2A2A2A',
  borderRadius: 6,
  padding: 10,
  fontSize: 16,
};
