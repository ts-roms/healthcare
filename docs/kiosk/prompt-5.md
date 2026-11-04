# Phase 5 — Digital Queue Display and Hardware Integration

Implement hardware integrations for the Healthcare Management Platform.

## A. Public Queue Display

Create:
PublicQueueDisplayPage

Features:
- Full-screen TV interface.
- Now Serving section.
- Multiple department queues.
- Counter assignments.
- Recently called numbers.
- Configurable hospital branding.
- Responsive layout.
- WebSocket updates.
- Automatic reconnect.
- Polling fallback.

Never expose patient names, patient IDs, or sensitive personal information.

## B. Voice Announcement

Implement:
- Text-to-speech announcements.
- Queue number announcement.
- Counter announcement.
- Configurable language.
- Volume configuration.
- Announcement playback queue.
- Duplicate event prevention.
- Audio failure fallback.

Example:
"Queue number OPD-025, please proceed to Counter 01."

## C. Thermal Printer

Implement support for:
- 80mm thermal printers.
- Optional 58mm printers.
- USB/network printer configurations.
- Ticket templates.
- Print status.
- Paper error handling.
- Restricted reprinting.

Prefer a local print agent for unattended printing.

The print agent must authenticate requests, validate print jobs, restrict network exposure, and support health monitoring.

## D. Device Monitoring

Implement:
- Device registration.
- Device heartbeat.
- Online/offline status.
- Last activity.
- Printer availability.
- Display availability.
- Kiosk maintenance status.

## E. Testing

Test:
- Display updates.
- Voice announcements.
- WebSocket recovery.
- Printer availability.
- Print failures.
- Duplicate announcements.
- Device disconnection and reconnection.

Do not claim hardware functionality is complete until tested against actual target devices.