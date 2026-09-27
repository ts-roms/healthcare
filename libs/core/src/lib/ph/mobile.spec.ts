import { maskEmail, maskPhone, normalizePhMobile } from './mobile';

describe('normalizePhMobile', () => {
  it.each([
    ['09171234567', '+639171234567'],
    ['0917 123 4567', '+639171234567'],
    ['0917-123-4567', '+639171234567'],
    ['+63 917 123 4567', '+639171234567'],
    ['639171234567', '+639171234567'],
    ['9171234567', '+639171234567'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePhMobile(input)).toBe(expected);
  });

  it.each(['0281234567', '12345', '+6591234567', '091712345678', ''])('rejects %s', (input) => {
    expect(normalizePhMobile(input)).toBeUndefined();
  });
});

describe('masking', () => {
  it('keeps only the last four digits of a phone number', () => {
    expect(maskPhone('+639171234567')).toBe('********4567');
  });

  it('keeps the first letter and domain of an email address', () => {
    expect(maskEmail('juan.delacruz@example.ph')).toBe('j***@example.ph');
  });
});
