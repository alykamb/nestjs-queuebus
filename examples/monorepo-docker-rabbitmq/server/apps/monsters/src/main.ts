import { NestFactory } from '@nestjs/core';
import { MonstersModule } from './monsters.module';

async function bootstrap() {
  const app = await NestFactory.create(MonstersModule);
  await app.listen(3000);
}
bootstrap();
