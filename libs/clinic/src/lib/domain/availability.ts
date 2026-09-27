import { intervalsOverlap, zonedToUtc } from "@healthcare/core";

export interface ScheduleBlock {
  startTime: string; // HH:MM[:SS], local facility time
  endTime: string;
  slotMinutes: number;
  roomId: string | null;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
  roomId: string | null;
}

/**
 * Bookable slots for one practitioner on one local date: schedule blocks cut
 * into slots of the schedule's step, each lasting `durationMinutes`, minus
 * exceptions (leave, facility closures), existing appointments, and the past.
 */
export function availableSlots(input: {
  date: string;
  timeZone: string;
  blocks: ScheduleBlock[];
  durationMinutes: number;
  unavailable: Interval[];
  now: Date;
}): Slot[] {
  const slots: Slot[] = [];
  for (const block of input.blocks) {
    const blockStart = zonedToUtc(input.date, block.startTime, input.timeZone);
    const blockEnd = zonedToUtc(input.date, block.endTime, input.timeZone);
    for (let start = blockStart.getTime(); ; start += block.slotMinutes * 60_000) {
      const slot = { start: new Date(start), end: new Date(start + input.durationMinutes * 60_000) };
      if (slot.end > blockEnd) break;
      if (slot.start < input.now) continue;
      if (input.unavailable.some((busy) => intervalsOverlap(slot, busy))) continue;
      slots.push({ startsAt: slot.start, endsAt: slot.end, roomId: block.roomId });
    }
  }
  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
