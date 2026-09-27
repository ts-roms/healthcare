import { assessDuplicate, type MatchSignals, transposeDayMonth } from './duplicate-detection';

const none: MatchSignals = {
  nameSimilarity: 0,
  exactName: false,
  sameBirthDate: false,
  transposedBirthDate: false,
  sameBirthYear: false,
  identifierMatch: false,
  contactMatch: false,
};

describe('assessDuplicate', () => {
  it('returns nothing without meaningful signals', () => {
    expect(assessDuplicate(none)).toBeUndefined();
    expect(assessDuplicate({ ...none, nameSimilarity: 0.9 })).toBeUndefined();
    expect(assessDuplicate({ ...none, sameBirthDate: true, nameSimilarity: 0.2 })).toBeUndefined();
  });

  it('treats a shared identifier as certain', () => {
    expect(assessDuplicate({ ...none, identifierMatch: true })).toEqual({ level: 'certain', reasons: ['identifier_match'] });
  });

  it('treats the same name and birth date as high', () => {
    expect(assessDuplicate({ ...none, exactName: true, nameSimilarity: 1, sameBirthDate: true, sameBirthYear: true })).toEqual({
      level: 'high',
      reasons: ['exact_name_and_birth_date'],
    });
  });

  it('treats a similar name (spelling variant) and same birth date as high', () => {
    expect(assessDuplicate({ ...none, nameSimilarity: 0.7, sameBirthDate: true })?.level).toBe('high');
  });

  it('treats the same mobile and birth date as high even with a different name', () => {
    expect(assessDuplicate({ ...none, contactMatch: true, sameBirthDate: true })).toEqual({
      level: 'high',
      reasons: ['contact_and_birth_date'],
    });
  });

  it('flags transposed day/month as possible', () => {
    expect(assessDuplicate({ ...none, exactName: true, nameSimilarity: 1, transposedBirthDate: true, sameBirthYear: true })?.level).toBe(
      'possible',
    );
  });

  it('flags very similar names in the same birth year as possible', () => {
    expect(assessDuplicate({ ...none, nameSimilarity: 0.85, sameBirthYear: true })).toEqual({
      level: 'possible',
      reasons: ['similar_name_and_birth_year'],
    });
  });
});

describe('transposeDayMonth', () => {
  it('swaps day and month when valid', () => {
    expect(transposeDayMonth('1980-03-04')).toBe('1980-04-03');
  });

  it('returns undefined when the swap is invalid or identical', () => {
    expect(transposeDayMonth('1980-03-25')).toBeUndefined();
    expect(transposeDayMonth('1980-05-05')).toBeUndefined();
  });
});
