# Phase 4 — Receptionist Queue Management Dashboard

Implement a complete Receptionist Queue Management Dashboard.

Technology:
React + TypeScript + NestJS + PostgreSQL.

## Dashboard Features

### Queue Overview
- Total waiting.
- Currently serving.
- Completed.
- Skipped.
- No-show.

### Queue Operations
- Call Next.
- Recall.
- Skip.
- Mark No-show.
- Complete.
- Transfer.
- Requeue.
- Manual Walk-in.

### Patient Registration Review
- View submitted patient registration.
- Verify identity.
- Check for duplicates.
- Approve registration.
- Reject registration with reason.
- Correct information through authorized staff workflows.
- Link existing patient records.

### Counter Management
- Multiple counters.
- Counter assignment.
- Department assignment.
- Counter availability.
- Receptionist assignment.

### Real-Time Updates

Integrate Socket.IO.

Listen for:
- queue.ticket.created
- queue.ticket.called
- queue.ticket.recalled
- queue.ticket.skipped
- queue.ticket.completed
- queue.ticket.transferred
- queue.counter.updated

Implement reconnection and authoritative state synchronization.

## UX Requirements

Create a professional hospital operations interface.

Include:
- Queue statistics.
- Waiting queue table.
- Now Serving card.
- Patient verification modal.
- Queue action panel.
- Transfer modal.
- Search and filtering.
- Empty states.
- Loading states.
- Error handling.

## Security

Respect existing authentication and authorization.

Receptionists must only access authorized facilities, departments, counters, and patient records.

## Testing

Test all queue actions, concurrent requests, permissions, and real-time synchronization.

Deliver production-quality implementations integrated with existing platform conventions.