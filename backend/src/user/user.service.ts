import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async upsert(phone: string, data: Partial<Pick<User, 'cookie' | 'nickname'>>): Promise<User> {
    let user = await this.userRepo.findOneBy({ phone });
    if (user) {
      if (data.cookie !== undefined) user.cookie = data.cookie;
      if (data.nickname !== undefined) user.nickname = data.nickname;
      return this.userRepo.save(user);
    }
    return this.userRepo.save(this.userRepo.create({ phone, ...data }));
  }

  async findByPhone(phone: string): Promise<User | null> {
    return this.userRepo.findOneBy({ phone });
  }

  async findLatest(): Promise<User | null> {
    const users = await this.userRepo.find({ order: { updatedAt: 'DESC' }, take: 1 });
    return users[0] || null;
  }

  async clearCookie(phone: string): Promise<void> {
    await this.userRepo.update({ phone }, { cookie: '' });
  }
}
