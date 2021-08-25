import {
    DynamicModule,
    Global,
    Inject,
    Module,
    ModuleMetadata,
    OnApplicationBootstrap,
    Provider,
    Type,
} from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'

import { QueueBusBase } from '.'
import { MESSAGE_BROOKER, QUEUE_CONFIG_SERVICE, QUEUE_DEFAULT_NAME, Transport } from './constants'
import { EventBusBase } from './eventBusBase'
import { IQueueConfigService } from './interfaces/queueConfigService.interface'
import { ITransport } from './interfaces/transport.interface'
import { ExplorerService } from './services/explorer.service'

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
            controllers: moduleOptions?.controllers || [],
            providers: [
                this.messageBrookerProvider,
                ExplorerService,
                queueConfigService,
                ...queues,
                ...(moduleOptions?.providers || []),
                {
                    provide: QUEUE_DEFAULT_NAME,
                    useValue: '',
                },
            ],
            exports: [...queues, ...(moduleOptions?.exports || []), queueConfigService],
            imports: [...(moduleOptions?.imports || [])],
        }
    }

    private static get messageBrookerProvider(): Provider {
        return {
            provide: MESSAGE_BROOKER,
            useFactory: async (queueConfig: IQueueConfigService): Promise<ITransport> => {
                if (queueConfig.messageBrooker === Transport.rabbitMQ) {
                    if (!require('amqplib')) {
                        throw new Error(
                            'amqplib node package is missing. use: npm install --save amqplib',
                        )
                    }

                    const { RabbitMq } = await import('./transports/rabbitMq/rabbitMq')
                    return new RabbitMq(queueConfig)
                }
            },
            inject: [QUEUE_CONFIG_SERVICE],
        }
    }
    public onApplicationBootstrap(): void {
        const { queuesBuses, eventsBuses } = this.explorerService.getBuses()

        const queueBusesProviders = queuesBuses
        const eventBusesProviders = eventsBuses

        const { effects, queues } = this.explorerService.explore(
            queueBusesProviders,
            eventBusesProviders,
        )

        queueBusesProviders.forEach((q, i) => {
            q.register(queues[i])
        })

        eventBusesProviders.forEach((e, i) => {
            e.registerEffects(effects[i])
        })
    }
}
