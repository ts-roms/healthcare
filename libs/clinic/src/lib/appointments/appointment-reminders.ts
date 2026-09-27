import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DomainEventHandlers, type DomainEventRecord, localTime, systemActor } from '@healthcare/core';
import { NotificationService } from '@healthcare/notification';
import { OrganizationService } from '@healthcare/organization';

const REMINDER_LEAD_MS = 24 * 3_600_000;
/** Too close to the appointment for a reminder to be useful. */
const MINIMUM_NOTICE_MS = 2 * 3_600_000;

export function reminderKey(appointmentId: string, startsAt: string): string {
  return `appointment-reminder:${appointmentId}:${startsAt}`;
}

/** When to send the reminder, or undefined if it is too late to bother. */
export function reminderTime(startsAt: Date, now: Date): Date | undefined {
  if (startsAt.getTime() - now.getTime() < MINIMUM_NOTICE_MS) return undefined;
  const at = new Date(startsAt.getTime() - REMINDER_LEAD_MS);
  return at > now ? at : now;
}

/**
 * Schedules an SMS reminder when an appointment is booked or rescheduled and
 * withdraws it when the appointment is cancelled, rescheduled or missed.
 * Idempotent: keys are derived from the appointment and its start time.
 * Consent and communication preferences are enforced by NotificationService.
 */
@Injectable()
export class AppointmentReminders implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly notifications: NotificationService,
    private readonly organizations: OrganizationService,
  ) {}

  onModuleInit(): void {
    this.handlers.on(['AppointmentBooked', 'AppointmentRescheduled'], 'appointment-reminders.schedule', (event) => this.schedule(event));
    this.handlers.on(['AppointmentRescheduled', 'AppointmentCancelled', 'AppointmentNoShow'], 'appointment-reminders.withdraw', (event) =>
      this.withdraw(event),
    );
  }

  private async schedule(event: DomainEventRecord): Promise<void> {
    const startsAtIso = String(event.payload['startsAt']);
    const startsAt = new Date(startsAtIso);
    const sendAt = reminderTime(startsAt, new Date());
    if (!sendAt || !event.patientId || !event.facilityId) return;
    const facility = await this.organizations.getFacility(event.organizationId, event.facilityId);
    await this.notifications.send(systemActor(event.organizationId, event.facilityId, 'appointment-reminder'), {
      recipient: { type: 'patient', patientId: event.patientId },
      channel: 'sms',
      templateKey: 'appointment.reminder',
      variables: {
        facilityName: facility.name.slice(0, 80),
        date: new Intl.DateTimeFormat('en-PH', { timeZone: facility.timezone, dateStyle: 'medium' }).format(startsAt),
        time: localTime(startsAt, facility.timezone),
      },
      scheduledFor: sendAt.toISOString(),
      idempotencyKey: reminderKey(event.aggregateId, startsAtIso),
    });
  }

  private async withdraw(event: DomainEventRecord): Promise<void> {
    const startsAt = event.eventType === 'AppointmentRescheduled' ? event.payload['previousStartsAt'] : event.payload['startsAt'];
    if (typeof startsAt !== 'string') return;
    await this.notifications.cancelByIdempotencyKey(
      systemActor(event.organizationId, event.facilityId, 'appointment-reminder'),
      reminderKey(event.aggregateId, startsAt),
      `Appointment ${event.eventType.replace('Appointment', '').toLowerCase()}`,
    );
  }
}
