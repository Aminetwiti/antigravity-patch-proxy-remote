import { describe, it, expect, beforeEach } from 'vitest';
import { t, setLocale, getLocale, TRANSLATIONS } from './i18n';

describe('ag-doctor-ui i18n Engine', () => {
  beforeEach(() => {
    setLocale('en');
  });

  it('translates known keys in English', () => {
    expect(t('status.ready')).toBe('Ready');
    expect(t('btn.runDoctor')).toBe('Run doctor');
  });

  it('translates known keys in French after switching locale', () => {
    setLocale('fr');
    expect(getLocale()).toBe('fr');
    expect(t('status.ready')).toBe('Prêt');
    expect(t('btn.runDoctor')).toBe('Lancer le diagnostic');
  });

  it('falls back to key or fallback string when translation is missing', () => {
    expect(t('non_existent_key', 'Fallback Value')).toBe('Fallback Value');
    expect(t('non_existent_key')).toBe('non_existent_key');
  });
});
