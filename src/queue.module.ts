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
    ModuleMetadata,
} from '@nestjs/common'
import { PubSubController } from './pubsub/pubSub.controller'
import { RedisPubSub } from './pubsub/pubsub'
import { IQueueConfigService } from './interfaces/queueConfigService.interface'
import { QUEUE_CONFIG_SERVICE, MESSAGE_BROOKER, MessageBrooker } from './constants'
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
        global = false,
        moduleOptions?: ModuleMetadata,
    ): DynamicModule {
        const queueConfigService: Provider<IQueueConfigService> = {
            provide: QUEUE_CONFIG_SERVICE,
            useClass: QueueConfigService,
        }

        return {
            global,
            module: QueueModule,
            controllers: [PubSubController, ...(moduleOptions?.controllers || []),],
            providers: [this.messageBrookerProvider, ExplorerService, RedisPubSub, queueConfigService, ...queues, ...(moduleOptions?.providers || []),],
            exports: [...queues, ...(moduleOptions?.exports || []),],
            imports: [...(moduleOptions?.imports || []),]
        }
    }

    private static get messageBrookerProvider(): Provider {
        return {
            provide: MESSAGE_BROOKER,
            useFactory: (queueConfig: IQueueConfigService) => {
                if(queueConfig.messageBrooker === MessageBrooker.bullMQ) {
                    if(!require('bullmq')) {
                        throw new Error('bullMq')
                    }
                    return new BullMq(queueConfig)
                }
            },
            inject: [QUEUE_CONFIG_SERVICE]
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
