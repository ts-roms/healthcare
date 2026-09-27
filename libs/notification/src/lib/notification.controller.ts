import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { ListNotificationsDto, SendNotificationDto } from "./notification.dto";
import { NotificationService } from "./notification.service";

@ApiTags("notifications")
@ApiBearerAuth()
@Controller({ version: "1" })
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Post("notifications")
  @RequirePermissions("notification.send")
  @ApiOperation({ summary: "Send a templated notification; honors consent and communication preferences" })
  send(@CurrentActor() actor: Actor, @Body() body: SendNotificationDto) {
    return this.notifications.send(actor, body);
  }

  @Get("notifications")
  @RequirePermissions("notification.read")
  @ApiOperation({ summary: "Communication history of a patient" })
  history(@CurrentActor() actor: Actor, @Query() query: ListNotificationsDto) {
    return this.notifications.historyForPatient(actor, query.patientId);
  }

  @Get("me/notifications")
  @ApiOperation({ summary: "In-app inbox of the signed-in user" })
  inbox(@CurrentActor() actor: Actor) {
    return this.notifications.inbox(actor);
  }

  @Post("me/notifications/:notificationId/read")
  @HttpCode(204)
  async markRead(@CurrentActor() actor: Actor, @Param("notificationId", ParseUUIDPipe) notificationId: string): Promise<void> {
    await this.notifications.markRead(actor, notificationId);
  }
}
