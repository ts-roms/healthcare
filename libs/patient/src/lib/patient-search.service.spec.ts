import { classifyQuery } from './patient-search.service';

describe('classifyQuery', () => {
  it('recognizes patient numbers and pads them', () => {
    expect(classifyQuery('P123')).toEqual({ kind: 'patient_number', value: 'P00000123' });
    expect(classifyQuery('p00000123')).toEqual({ kind: 'patient_number', value: 'P00000123' });
  });

  it('recognizes Philippine mobile numbers in any common format', () => {
    expect(classifyQuery('0917 123 4567')).toEqual({ kind: 'phone', value: '+639171234567' });
    expect(classifyQuery('+63-917-123-4567')).toEqual({ kind: 'phone', value: '+639171234567' });
  });

  it('treats everything else as a name', () => {
    expect(classifyQuery('Dela Cruz, Juan')).toEqual({ kind: 'name', value: 'dela cruz juan' });
    expect(classifyQuery('Peña')).toEqual({ kind: 'name', value: 'pena' });
  });
});
