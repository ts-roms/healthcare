import { Module } from '@nestjs/common';
import { CarePlanController } from './care-plan.controller';
import { CarePlanService } from './care-plan.service';

@Module({
  controllers: [CarePlanController],
  providers: [CarePlanService],
  exports: [CarePlanService],
})
export class CarePlanModule {}
