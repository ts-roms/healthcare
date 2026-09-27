import { checkAllergies } from './allergy-check';
import type { AllergyContext } from './ports';

const context: AllergyContext = {
  status: 'has_allergies',
  allergies: [
    { id: 'a1', substance: 'Penicillin', category: 'medication', criticality: 'high', reaction: 'Anaphylaxis' },
    { id: 'a2', substance: 'Shrimp', category: 'food', criticality: 'low', reaction: 'Hives' },
    { id: 'a3', substance: 'Mefenamic acid', category: 'medication', criticality: 'low', reaction: null },
  ],
};

describe('checkAllergies (decision support)', () => {
  it('warns when a prescribed medicine matches a recorded medication allergy', () => {
    const warnings = checkAllergies([{ genericName: 'Benzathine penicillin G' }], context);
    expect(warnings).toEqual([expect.objectContaining({ allergyId: 'a1', medication: 'Benzathine penicillin G', criticality: 'high', basis: 'name_match' })]);
  });

  it('matches brand names and multi-word substances', () => {
    expect(checkAllergies([{ genericName: 'Mefenamic Acid', brandName: 'Ponstan' }], context).map((w) => w.allergyId)).toEqual(['a3']);
  });

  it('ignores food allergies and unrelated medicines', () => {
    expect(checkAllergies([{ genericName: 'Paracetamol' }, { genericName: 'Shrimp oil' }], context)).toEqual([]);
  });

  it('does not match on dosage-form words', () => {
    const tabletAllergy: AllergyContext = { status: 'has_allergies', allergies: [{ id: 'x', substance: 'Tablet coating', category: 'medication', criticality: 'low', reaction: null }] };
    expect(checkAllergies([{ genericName: 'Metformin tablet' }], tabletAllergy)).toEqual([]);
  });
});
