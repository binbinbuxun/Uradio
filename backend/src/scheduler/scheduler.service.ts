import { Injectable } from '@nestjs/common';

export interface TimeSlot {
  id: string;
  startHour: number;
  endHour: number;
  label: string;
  mood: string;
  genres: string[];
}

@Injectable()
export class SchedulerService {
  private readonly timeSlots: TimeSlot[] = [
    {
      id: 'morning',
      startHour: 6,
      endHour: 10,
      label: '晨间唤醒',
      mood: '轻松、清新、提神',
      genres: ['pop', 'acoustic', 'light-electronic'],
    },
    {
      id: 'forenoon',
      startHour: 10,
      endHour: 12,
      label: '上午专注',
      mood: '平静、专注、轻快',
      genres: ['lo-fi', 'ambient', 'jazz'],
    },
    {
      id: 'noon',
      startHour: 12,
      endHour: 14,
      label: '午间休憩',
      mood: '舒缓、温暖、放松',
      genres: ['bossa-nova', 'soft-rock', 'r&b'],
    },
    {
      id: 'afternoon',
      startHour: 14,
      endHour: 18,
      label: '下午能量',
      mood: '活力、节奏感、提神',
      genres: ['hip-hop', 'dance', 'indie'],
    },
    {
      id: 'evening',
      startHour: 18,
      endHour: 21,
      label: '傍晚放松',
      mood: '慵懒、浪漫、怀旧',
      genres: ['soul', 'funk', 'classic-rock'],
    },
    {
      id: 'night',
      startHour: 21,
      endHour: 24,
      label: '夜间静谧',
      mood: '安静、深沉、治愈',
      genres: ['ambient', 'piano', 'classical'],
    },
    {
      id: 'late-night',
      startHour: 0,
      endHour: 6,
      label: '深夜独处',
      mood: '孤独、思考、电子',
      genres: ['electronic', 'trip-hop', 'shoegaze'],
    },
  ];

  getTodayPlan() {
    const now = new Date();
    const currentHour = now.getHours();

    return {
      date: now.toISOString().split('T')[0],
      slots: this.timeSlots,
      currentSlot: this.getCurrentSlot(currentHour),
      nextSlot: this.getNextSlot(currentHour),
    };
  }

  getCurrentSlot(hour: number): TimeSlot | null {
    return this.timeSlots.find(
      (slot) => hour >= slot.startHour && hour < slot.endHour,
    ) || null;
  }

  getNextSlot(hour: number): TimeSlot | null {
    const currentIndex = this.timeSlots.findIndex(
      (slot) => hour >= slot.startHour && hour < slot.endHour,
    );
    if (currentIndex === -1 || currentIndex === this.timeSlots.length - 1) {
      return this.timeSlots[0]; // 循环到第一个
    }
    return this.timeSlots[currentIndex + 1];
  }

  updateSlot(id: string, update: Partial<Omit<TimeSlot, 'id'>>): boolean {
    const index = this.timeSlots.findIndex(s => s.id === id);
    if (index === -1) return false;
    this.timeSlots[index] = { ...this.timeSlots[index], ...update };
    return true;
  }

  getAllSlots(): TimeSlot[] {
    return [...this.timeSlots];
  }
}
