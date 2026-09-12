import { describe, it, expect } from 'vitest';
import { normalizeRequisite, requisiteError, requisiteLength } from './requisites';

describe('requisite input', () => {
  it.each([['company',10,13],['ip',12,15]] as const)('uses %s lengths', (kind,inn,registration) => {
    expect(requisiteLength('inn',kind)).toBe(inn);
    expect(requisiteLength('registration',kind)).toBe(registration);
  });
  it('preserves leading zeroes and all account digits when pasting', () => {
    expect(normalizeRequisite(' 00123\u00a045678\u202f90123 45678\n')).toBe('00123456789012345678');
    expect(requisiteError('00123456789012345678',20)).toBeUndefined();
  });
  it('detects short and overlong input without truncation and clears after correction', () => {
    expect(requisiteError('12345678',9)).toContain('введено 8');
    expect(requisiteError('1234567890',9)).toContain('введено 10');
    expect(requisiteError('012345678',9)).toBeUndefined();
    expect(requisiteError('',9)).toBeUndefined();
  });
  it('does not silently remove letters or punctuation', () => {
    for (const value of ['12345a789','12345-789','１２３４５６７８９']) expect(requisiteError(value,9)).toContain('только цифры');
  });
});
