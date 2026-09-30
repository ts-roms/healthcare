import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { CalendarRangeDto, CancelCalendarEventDto, CreateCalendarEventDto, UpdateCalendarEventDto } from "./calendar.dto";
import { CalendarService } from "./calendar.service";

@ApiTags("calendar")
@ApiBearerAuth()
@Controller({ path: "calendar/events", version: "1" })
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  @RequirePermissions("calendar.read")
  @ApiOperation({ summary: "Meetings, events and blocked time of a facility overlapping a range (≤ 42 days); invitee-only events only for their people" })
  list(@CurrentActor() actor: Actor, @Query() query: CalendarRangeDto) {
    return this.calendar.list(actor, query);
  }

  @Post()
  @RequirePermissions("calendar.manage")
  @ApiOperation({ summary: "Add an event; the caller is its organizer (audited)" })
  create(@CurrentActor() actor: Actor, @Body() body: CreateCalendarEventDto) {
    return this.calendar.create(actor, body);
  }

  @Get(":eventId")
  @RequirePermissions("calendar.read")
  get(@CurrentActor() actor: Actor, @Param("eventId", ParseUUIDPipe) id: string) {
    return this.calendar.get(actor, id);
  }

  @Put(":eventId")
  @RequirePermissions("calendar.manage")
  @ApiOperation({ summary: "Change an event (organizer, or clinic.configure); 409 version_conflict when it changed meanwhile" })
  update(@CurrentActor() actor: Actor, @Param("eventId", ParseUUIDPipe) id: string, @Body() body: UpdateCalendarEventDto) {
    return this.calendar.update(actor, id, body);
  }

  @Post(":eventId/cancel")
  @RequirePermissions("calendar.manage")
  @ApiOperation({ summary: "Cancel an event with a reason; it stays listed, marked" })
  cancel(@CurrentActor() actor: Actor, @Param("eventId", ParseUUIDPipe) id: string, @Body() body: CancelCalendarEventDto) {
    return this.calendar.cancel(actor, id, body);
  }
}
