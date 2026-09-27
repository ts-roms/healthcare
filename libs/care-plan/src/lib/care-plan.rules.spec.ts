import { canChangeActivityStatus, canChangePlanStatus, nextDueDate } from './care-plan.rules';

describe('care plan rules', () => {
  it('follows the plan lifecycle', () => {
    expect(canChangePlanStatus('draft', 'active')).toBe(true);
    expect(canChangePlanStatus('active', 'on_hold')).toBe(true);
    expect(canChangePlanStatus('completed', 'active')).toBe(false);
    expect(canChangePlanStatus('cancelled', 'active')).toBe(false);
  });

  it('follows the activity lifecycle', () => {
    expect(canChangeActivityStatus('planned', 'scheduled')).toBe(true);
    expect(canChangeActivityStatus('scheduled', 'planned')).toBe(true);
    expect(canChangeActivityStatus('completed', 'planned')).toBe(false);
  });

  it('schedules the next occurrence of recurring monitoring', () => {
    expect(nextDueDate('2026-01-15', 90)).toBe('2026-04-15');
    expect(nextDueDate('2026-12-20', 30)).toBe('2027-01-19');
  });
});
