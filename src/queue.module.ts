import { BullMq } from './bullmq/bullMq'
import { ExplorerService } from './services/explorer.service'
import {
    DynamicModule,
    Global,
    Inject,
    OnApplicationBootstrap,
    Provider,
    Module,
    Type,
} from '@nestjs/common'
import { PubSubController } from './pubsub/pubSub.controller'
import { RedisPubSub } from './pubsub/pubsub'
import { IQueueConfigService } from './interfaces/queueConfigService.interface'
import { QUEUE_CONFIG_SERVICE } from './constants'
import { ModuleRef } from '@nestjs/core'
import { QueueBusBase } from '.'
import { EventBusBase } from './eventBusBase'

@Global()
@Module({})
export class QueueModule implements OnApplicationBootstrap {
    constructor(
        private readonly explorerService: ExplorerService,
        private readonly moduleRef: ModuleRef,
        @Inject(QUEUE_CONFIG_SERVICE) private readonly queueConfigService: IQueueConfigService,
    ) {}

    public static register(
        QueueConfigService: {
            new (...args: any[]): IQueueConfigService
        },
        queues: Array<Type<QueueBusBase> | Type<EventBusBase>>,
        global = false
    ): DynamicModule {
        const queueConfigService: Provider<IQueueConfigService> = {
            provide: QUEUE_CONFIG_SERVICE,
            useClass: QueueConfigService,
        }

        return {
            global,
            module: QueueModule,
            controllers: [PubSubController],
            providers: [BullMq, ExplorerService, RedisPubSub, queueConfigService, ...queues],
            exports: [...queues],
        }
    }
    public onApplicationBootstrap(): void {
        const queuesBuses = this.queueConfigService.getQueues()

        const queueBusesProviders = queuesBuses.queues.map((q) => this.moduleRef.get(q))
        const eventBusesProviders = queuesBuses.events.map((q) => this.moduleRef.get(q))

        const { events, sagas, queues } = this.explorerService.explore(
            queueBusesProviders,
            eventBusesProviders,
        )

        queueBusesProviders.forEach((q, i) => {
            q.register(queues[i])
        })
        eventBusesProviders.forEach((e, i) => {
            e.register(events[i])
            e.registerSagas(sagas[i])
        })
    }
}
