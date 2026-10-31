import { describe, it, expect, beforeEach } from 'vitest';
import {
  setSessionEffortAffinity,
  getSessionEffortAffinity,
  clearSessionEffortAffinity,
  clearAllSessionEffortAffinities,
  clearSessionAffinities,
} from '../proxy';

describe('Session Effort Affinity', () => {
  beforeEach(() => {
    clearAllSessionEffortAffinities();
  });

  it('records and retrieves session effort affinity', () => {
    setSessionEffortAffinity('session-100', 'high');
    expect(getSessionEffortAffinity('session-100')).toBe('high');
  });

  it('normalizes effort levels to lowercase', () => {
    setSessionEffortAffinity('session-200', 'Medium');
    expect(getSessionEffortAffinity('session-200')).toBe('medium');
  });

  it('clears session effort affinity individually', () => {
    setSessionEffortAffinity('session-300', 'high');
    expect(getSessionEffortAffinity('session-300')).toBe('high');
    clearSessionEffortAffinity('session-300');
    expect(getSessionEffortAffinity('session-300')).toBeUndefined();
  });

  it('clears all session effort affinities on clearSessionAffinities', () => {
    setSessionEffortAffinity('session-400', 'high');
    setSessionEffortAffinity('session-401', 'low');
    clearSessionAffinities();
    expect(getSessionEffortAffinity('session-400')).toBeUndefined();
    expect(getSessionEffortAffinity('session-401')).toBeUndefined();
  });

  it('ignores empty sessionId or effort values', () => {
    setSessionEffortAffinity('', 'high');
    expect(getSessionEffortAffinity('')).toBeUndefined();

    setSessionEffortAffinity('session-500', '');
    expect(getSessionEffortAffinity('session-500')).toBeUndefined();
  });
});
