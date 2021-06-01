import { Injectable, Type } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { setTimeout } from 'timers/promises'
import { v4 } from 'uuid'

import { IQueueConfigService } from '..'
import { Transport } from '../constants'
import { createDecorators, Event, NameQueue, UseQueueBus } from '../decorators'
import { EventBusBase } from '../eventBusBase'
import { IEffect, IQueueHandler } from '../interfaces'
import { QueueModule } from '../queue.module'
import { QueueBusBase } from '../queueBusBase'

type QueueModuleRef = {
    queueBus1: QueueBusBase
    queueBus2: QueueBusBase
    eventBus1: EventBusBase
    eventBus2: EventBusBase
    commandHandlers: Array<IQueueHandler<any>>
    commands: Array<Type<any>>
    events: Array<Type<any>>
    sagas: Array<Type<any>>
}

describe('transports', () => {
    class QueueBus1 extends QueueBusBase {}
    class QueueBus2 extends QueueBusBase {}
    class EventBus1 extends EventBusBase {}
    class EventBus2 extends EventBusBase {}

    Reflect.decorate([NameQueue('_1')], QueueBus1)
    Reflect.decorate([NameQueue('_2')], QueueBus2)
    Reflect.decorate([UseQueueBus(QueueBus1)], EventBus1)
    Reflect.decorate([UseQueueBus(QueueBus2)], EventBus2)
    Reflect.decorate([Injectable()], EventBus1)
    Reflect.decorate([Injectable()], EventBus2)
    Reflect.decorate([Injectable()], QueueBus1)
    Reflect.decorate([Injectable()], QueueBus2)

    const queues = {
        queues: [QueueBus1, QueueBus2],
        events: [EventBus1, EventBus2],
    }

    const {
        queues: [Queue1Handler],
        events: [Effect1, Effect2],
    } = createDecorators(queues)
    // commands
    class Command1 {
        constructor(public data: number) {}
    }

    class Command1Handler implements IQueueHandler<Command1> {
        public execute(command: Command1): number {
            return command.data * 2
        }
    }

    Reflect.decorate([Queue1Handler(Command1)], Command1Handler)

    class Command2RunEvent {
        constructor(public data: number) {}
    }

    Reflect.decorate([Event('')], Command2RunEvent)

    class Command2 {
        constructor(public data: number) {}
    }

    class Command2Handler implements IQueueHandler<Command1> {
        constructor(public eventBus2: EventBus2) {}
        public execute(command: Command1): Promise<number> {
            return setTimeout(2000)
                .then(() => command.data * 3)
                .then((result) => {
                    this.eventBus2.publish(new Command2RunEvent(result))
                    return result
                })
        }
    }

    Reflect.decorate([Queue1Handler(Command2)], Command2Handler)
    Reflect.decorate([Injectable()], Command2Handler)

    class Saga2 {
        public handleCommand2RunEvent: IEffect<Command2RunEvent> = (event): number => {
            return event.data
        }
    }

    Reflect.decorate([Effect2(Command2RunEvent)], Saga2, 'handleCommand2RunEvent')
    Reflect.decorate([Injectable()], Saga2)

    // configs
    class QueueConfigServiceRabbit implements IQueueConfigService {
        public environment = ''

        public name = 'rabbit_module'
        public id = 'rabbit_module_' + v4()

        public host = 'localhost'

        public messageBrooker = Transport.rabbitMQ
        public port = 5672

        public getQueues(): ReturnType<IQueueConfigService['getQueues']> {
            return queues
        }
    }

    class QueueConfigServiceBullmq implements IQueueConfigService {
        public environment = ''
        public name = 'bull_module'
        public id = 'bull_module_' + v4()
        public host = 'localhost'

        public messageBrooker = Transport.bullMQ
        public port = 6379
        public getQueues(): ReturnType<IQueueConfigService['getQueues']> {
            return queues
        }
    }

    Reflect.decorate([Injectable()], QueueConfigServiceBullmq)
    Reflect.decorate([Injectable()], QueueConfigServiceRabbit)

    let modules: QueueModuleRef[]

    const createModuleRef = (config: Type<IQueueConfigService>): Promise<TestingModule> => {
        const queueModule = QueueModule.register(
            config,
            [QueueBus1, QueueBus2, EventBus1, EventBus2],
            true,
            {
                providers: [Command1Handler, Command2Handler, Saga2],
            },
        )

        return Test.createTestingModule({
            imports: [queueModule],
        }).compile()
    }

    const beforeAllHelper = (
        ...configs: Array<Type<IQueueConfigService>>
    ) => async (): Promise<void> => {
        modules = await Promise.all(
            configs.map((config) =>
                createModuleRef(config).then((moduleRef) => {
                    void moduleRef.resolve<Command2Handler>(Command2Handler).then(console.log)
                    return {
                        queueBus1: moduleRef.get<QueueBusBase>(QueueBus1),
                        queueBus2: moduleRef.get<QueueBusBase>(QueueBus2),
                        eventBus1: moduleRef.get<EventBusBase>(EventBus1),
                        eventBus2: moduleRef.get<EventBusBase>(EventBus2),
                        commands: [Command1, Command2],
                        events: [Command2RunEvent],
                        sagas: [Saga2],
                        commandHandlers: [
                            moduleRef.get<Command1Handler>(Command1Handler),
                            moduleRef.get<Command2Handler>(Command2Handler),
                        ],
                    }
                }),
            ),
        )
    }

    const testsWrapper = (name: string, ...configs: Array<Type<IQueueConfigService>>): void => {
        describe(name, () => {
            beforeAll(beforeAllHelper(...configs))

            describe('single module', () => {
                describe('queueModule', () => {
                    test('if instances are valid', () => {
                        modules.forEach((module) => {
                            expect(module.queueBus1).toBeDefined()
                            expect(module.queueBus2).toBeDefined()
                            expect(module.eventBus1).toBeDefined()
                            expect(module.eventBus2).toBeDefined()
                            module.commandHandlers.forEach((handler) => {
                                expect(handler).toBeDefined()
                            })
                            module.sagas.forEach((saga) => {
                                expect(saga).toBeDefined()
                            })
                            module.events.forEach((event) => {
                                expect(event).toBeDefined()
                            })
                            module.commands.forEach((command) => {
                                expect(command).toBeDefined()
                            })
                        })
                    })

                    it('should have registered all commandHandlers for the commands', () => {
                        modules.forEach((module) => {
                            console.log(module.eventBus2)
                            console.log(module.commandHandlers[1])
                        })
                    })
                    it.todo('should have registered all effects for the events')
                })

                describe('commands', () => {
                    it.todo('should run the command handler for the command')
                    it.todo('should run the command handler for the command in another instance')
                    it.todo('should throw if command handler does not exists')
                    it.todo('should throw if the command handler throws')
                })

                describe('events', () => {
                    it.todo('should emmit event')
                })

                describe('effects', () => {
                    it.todo('it should run the effect')
                })
            })

            describe('multiple modules in same environment', () => {
                it.todo('should run the command a single time')
                it.todo('should multiple commands in multiple modules')
                it.todo('should emmit event')
                it.todo('should receive event in all modules')
                it.todo('should run effect only once per event')
            })

            describe('multiple modules in different environments', () => {
                it.todo('should run the command a single time')
                it.todo('should multiple commands in multiple modules')
                it.todo('should not run command in different enviroment')
                it.todo('should emmit event')
                it.todo('should receive event in all modules')
                it.todo('should not receive event in different enviroment')
                it.todo('should run effect only once per event')
            })
        })
    }

    testsWrapper('rabbitMq', QueueConfigServiceRabbit)
    testsWrapper('bullMq', QueueConfigServiceBullmq)
})
