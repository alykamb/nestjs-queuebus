import { Test, TestingModule } from '@nestjs/testing';
import { MonstersController } from './monsters.controller';
import { MonstersService } from './monsters.service';

describe('MonstersController', () => {
  let monstersController: MonstersController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [MonstersController],
      providers: [MonstersService],
    }).compile();

    monstersController = app.get<MonstersController>(MonstersController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(monstersController.getHello()).toBe('Hello World!');
    });
  });
});
