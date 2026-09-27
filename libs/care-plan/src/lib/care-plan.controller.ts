import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import {
  AddActivityDto,
  AddGoalDto,
  ChangePlanStatusDto,
  CreateCarePlanDto,
  DueActivitiesDto,
  ListCarePlansDto,
  ProgressNoteDto,
  UpdateActivityDto,
  UpdateGoalDto,
} from "./care-plan.dto";
import { CarePlanService } from "./care-plan.service";

@ApiTags("care plans")
@ApiBearerAuth()
@Controller({ path: "care-plans", version: "1" })
export class CarePlanController {
  constructor(private readonly plans: CarePlanService) {}

  @Post()
  @RequirePermissions("care-plan.manage")
  @ApiOperation({ summary: "Create a care plan with problems, goals and activities" })
  create(@CurrentActor() actor: Actor, @Body() body: CreateCarePlanDto) {
    return this.plans.create(actor, body);
  }

  @Get()
  @RequirePermissions("care-plan.read")
  list(@CurrentActor() actor: Actor, @Query() query: ListCarePlansDto) {
    return this.plans.listForPatient(actor, query.patientId, query.includeClosed === "true");
  }

  @Get("activities/due")
  @RequirePermissions("care-plan.read")
  @ApiOperation({ summary: "Recall list: overdue and upcoming follow-ups across open care plans" })
  due(@CurrentActor() actor: Actor, @Query() query: DueActivitiesDto) {
    return this.plans.dueActivities(actor, query);
  }

  @Get(":carePlanId")
  @RequirePermissions("care-plan.read")
  get(@CurrentActor() actor: Actor, @Param("carePlanId", ParseUUIDPipe) id: string) {
    return this.plans.get(actor, id);
  }

  @Post(":carePlanId/status")
  @HttpCode(200)
  @RequirePermissions("care-plan.manage")
  status(@CurrentActor() actor: Actor, @Param("carePlanId", ParseUUIDPipe) id: string, @Body() body: ChangePlanStatusDto) {
    return this.plans.changeStatus(actor, id, body);
  }

  @Post(":carePlanId/goals")
  @RequirePermissions("care-plan.manage")
  addGoal(@CurrentActor() actor: Actor, @Param("carePlanId", ParseUUIDPipe) id: string, @Body() body: AddGoalDto) {
    return this.plans.addGoal(actor, id, body);
  }

  @Patch(":carePlanId/goals/:goalId")
  @RequirePermissions("care-plan.manage")
  updateGoal(
    @CurrentActor() actor: Actor,
    @Param("carePlanId", ParseUUIDPipe) id: string,
    @Param("goalId", ParseUUIDPipe) goalId: string,
    @Body() body: UpdateGoalDto,
  ) {
    return this.plans.updateGoal(actor, id, goalId, body);
  }

  @Post(":carePlanId/activities")
  @RequirePermissions("care-plan.manage")
  addActivity(@CurrentActor() actor: Actor, @Param("carePlanId", ParseUUIDPipe) id: string, @Body() body: AddActivityDto) {
    return this.plans.addActivity(actor, id, body);
  }

  @Patch(":carePlanId/activities/:activityId")
  @RequirePermissions("care-plan.manage")
  @ApiOperation({ summary: 'Update an activity; "scheduled" links the follow-up appointment' })
  updateActivity(
    @CurrentActor() actor: Actor,
    @Param("carePlanId", ParseUUIDPipe) id: string,
    @Param("activityId", ParseUUIDPipe) activityId: string,
    @Body() body: UpdateActivityDto,
  ) {
    return this.plans.updateActivity(actor, id, activityId, body);
  }

  @Post(":carePlanId/progress-notes")
  @RequirePermissions("care-plan.manage")
  progressNote(@CurrentActor() actor: Actor, @Param("carePlanId", ParseUUIDPipe) id: string, @Body() body: ProgressNoteDto) {
    return this.plans.addProgressNote(actor, id, body.note);
  }
}
