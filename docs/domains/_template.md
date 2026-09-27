# <Domain name>

## Purpose
What this domain is responsible for, and what it is explicitly not responsible for.

## Entities
Tables/aggregates, key fields, invariants, and relationships to other domains (by id only).

## Commands
State-changing operations, with preconditions and resulting events.

## Queries
Read operations and their consumers.

## Events
Published and consumed events; synchronous vs. asynchronous.

## Permissions
Permission keys and the organization/facility/department scope each applies to.

## API
Endpoints under `/api/v1/...`, with links to the OpenAPI spec.

## Database relationships
Foreign keys, constraints, history/amendment tables, retention rules.

## Integration points
Contracts with other domains and external adapters.

## Open questions / assumptions
