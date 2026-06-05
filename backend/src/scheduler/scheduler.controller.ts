import { Controller, Get, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';

@Controller('api/plan')
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Get('today')
  getTodayPlan() {
    return this.schedulerService.getTodayPlan();
  }

  @Post('update')
  @HttpCode(HttpStatus.OK)
  updateSlot(
    @Body('id') id: string,
    @Body('label') label?: string,
    @Body('mood') mood?: string,
    @Body('genres') genres?: string[],
    @Body('startHour') startHour?: number,
    @Body('endHour') endHour?: number,
  ) {
    if (!id) return { status: 'error', message: 'Slot id is required' };

    const update: any = {};
    if (label) update.label = label;
    if (mood) update.mood = mood;
    if (genres) update.genres = genres;
    if (startHour !== undefined) update.startHour = startHour;
    if (endHour !== undefined) update.endHour = endHour;

    const ok = this.schedulerService.updateSlot(id, update);
    return ok
      ? { status: 'success', slots: this.schedulerService.getAllSlots() }
      : { status: 'error', message: `Slot '${id}' not found` };
  }
}
