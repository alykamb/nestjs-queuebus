import { Module } from '@nestjs/common';
import { MonstersController } from './monsters.controller';
import { MonstersService } from './monsters.service';

@Module({
  imports: [],
  controllers: [MonstersController],
  providers: [MonstersService],
})
export class MonstersModule {}
