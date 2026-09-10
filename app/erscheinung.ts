import type { Appearance } from '@clerk/types';

/**
 * Clerk im AufmaßX-Design. Die Werte sind dieselben Tokens wie in
 * legacy-app/core.css – die Anmeldung soll aussehen wie die App, in die sie
 * führt, und nicht wie ein fremdes Formular davor.
 */
export const clerkErscheinung: Appearance = {
  variables: {
    colorPrimary: '#4CC9F0',
    colorBackground: '#16213A',
    colorText: '#F2F6FF',
    colorTextSecondary: '#9FB3C8',
    colorInputBackground: '#111B2E',
    colorInputText: '#F2F6FF',
    colorDanger: '#FF6B6B',
    colorSuccess: '#3DDC97',
    colorWarning: '#FFB454',
    borderRadius: '12px',
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  },
  elements: {
    rootBox: { width: '100%' },
    cardBox: { width: '100%', boxShadow: '0 24px 60px rgba(0,0,0,.46)' },
    card: { border: '1px solid rgba(255,255,255,.08)' },
    headerTitle: { fontFamily: "'Space Grotesk', 'Inter', sans-serif" },
    // Baustellen-Handschuhe: nichts Anfassbares unter 44 px.
    formButtonPrimary: { minHeight: '44px', textTransform: 'none', fontSize: '15px' },
    formFieldInput: { minHeight: '44px' },
    socialButtonsBlockButton: { minHeight: '44px' },
    footerActionLink: { color: '#4CC9F0' }
  }
};
