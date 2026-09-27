import { effectivePermissions, grantApplies, type ScopedGrant } from './access.service';

const FACILITY_A = 'facility-a';
const FACILITY_B = 'facility-b';
const DEPT_LAB = 'dept-lab';

const grants: ScopedGrant[] = [
  { facilityId: null, departmentId: null, permissionKey: 'patient.search' },
  { facilityId: FACILITY_A, departmentId: null, permissionKey: 'patient.register' },
  { facilityId: FACILITY_A, departmentId: DEPT_LAB, permissionKey: 'document.upload' },
];

describe('grantApplies', () => {
  it('applies organization-wide grants everywhere', () => {
    expect(grantApplies(grants[0]!, {})).toBe(true);
    expect(grantApplies(grants[0]!, { facilityId: FACILITY_B })).toBe(true);
  });

  it('applies facility grants only within that facility', () => {
    expect(grantApplies(grants[1]!, { facilityId: FACILITY_A })).toBe(true);
    expect(grantApplies(grants[1]!, { facilityId: FACILITY_B })).toBe(false);
    expect(grantApplies(grants[1]!, {})).toBe(false);
  });

  it('applies department grants only within that department', () => {
    expect(grantApplies(grants[2]!, { facilityId: FACILITY_A, departmentId: DEPT_LAB })).toBe(true);
    expect(grantApplies(grants[2]!, { facilityId: FACILITY_A })).toBe(false);
  });
});

describe('effectivePermissions', () => {
  it('unions applicable grants', () => {
    expect([...effectivePermissions(grants, { facilityId: FACILITY_A })].sort()).toEqual(['patient.register', 'patient.search']);
    expect([...effectivePermissions(grants, { facilityId: FACILITY_B })]).toEqual(['patient.search']);
  });
});
