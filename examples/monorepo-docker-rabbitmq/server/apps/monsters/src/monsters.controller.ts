import { Controller, Get } from '@nestjs/common';
import { MonstersService } from './monsters.service';

@Controller()
export class MonstersController {
  constructor(private readonly monstersService: MonstersService) {}

  @Get()
  getHello(): string {
    return this.monstersService.getHello();
  }
}
