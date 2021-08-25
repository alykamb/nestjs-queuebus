import { Injectable } from '@nestjs/common';

@Injectable()
export class MonstersService {
  getHello(): string {
    return 'Hello World!';
  }
}
