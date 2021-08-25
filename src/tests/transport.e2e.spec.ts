import { Inject, Injectable, Type } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import {
    BehaviorSubject,
    bufferTime,
    filter,
    firstValueFrom,
    lastValueFrom,
    merge,
    Observable,
    take,
    takeUntil,
    timer,
} from 'rxjs'
import { setTimeout } from 'timers/promises'
import { v4 } from 'uuid'

import { IQueueConfigService } from '..'
import { QUEUE_CONFIG_SERVICE, Transport } from '../constants'
import { createDecorators, Event, eventOnReceive, NameQueue } from '../decorators'
import { EventBusBase } from '../eventBusBase'
import { InvalidQueueHandlerException, JobException } from '../exceptions'
import { IEffect, IQueueHandler } from '../interfaces'
import { IPubEvent } from '../interfaces/events/jobEvent.interface'
import { Command } from '../models/command'
import { QueueModule } from '../queue.module'
import { QueueBusBase } from '../queueBusBase'
import { HooksService } from '../services/hooks.service'

interface ICounterService {
    commands$: BehaviorSubject<{ data: number; test: string }>
    events$: BehaviorSubject<{ data: number; test: string }>
    effects$: BehaviorSubject<{ effect: string; test: string; provider: any }>
}

type QueueModuleRef = {
    queueBus1: QueueBusBase
    queueBus2: QueueBusBase
    eventBus1: EventBusBase
    eventBus2: EventBusBase
    commandHandlers: Array<IQueueHandler<any>>
    commands: Array<Type<any>>
    events: Array<Type<any>>
    effects: any[]
    app: TestingModule
    config: IQueueConfigService
    counter: ICounterService
}

jest.setTimeout(30000)

describe('transports', () => {
    Injectable()
    @NameQueue('_1')
    class QueueBus1 extends QueueBusBase {}

    Injectable()
    @NameQueue('_2')
    class QueueBus2 extends QueueBusBase {}

    Injectable()
    class EventBus1 extends EventBusBase {}

    Injectable()
    class EventBus2 extends EventBusBase {}

    const queues = {
        queues: [QueueBus1, QueueBus2],
        events: [EventBus1, EventBus2],
    }

    const {
        queues: [Queue1Handler, Queue2Handler],
        events: [[Effect1, ParallelEffect1], [Effect2, ParallelEffect2]],
    } = createDecorators(queues)

    // commands
    class Command1 extends Command<number> {
        constructor(public data: number, public test: string) {
            super()
        }
    }

    @Event('app1')
    class Command1RunEvent {
        constructor(public data: number, public test: string) {}
    }

    class Command2 extends Command<number> {
        constructor(public data: number, public test: string) {
            super()
        }
    }

    @Event('app2')
    class Command2RunEvent {
        constructor(public data: number, public test: string) {}
    }

    @Injectable()
    class CounterService implements ICounterService {
        public commands$ = new BehaviorSubject<Command1 | Command2>(null)
        public events$ = new BehaviorSubject<Command1RunEvent | Command2RunEvent>(null)
        public effects$ = new BehaviorSubject<{ effect: string; test: string; provider: any }>(null)
    }

    @Queue1Handler(Command1)
    class Command1Handler implements IQueueHandler<Command1> {
        constructor(
            public eventBus1: EventBus1,
            public eventBus2: EventBus2,
            public counter: CounterService,
            @Inject(QUEUE_CONFIG_SERVICE) private readonly queueConfig: IQueueConfigService,
        ) {}
        public execute(command: Command1): Promise<number> {
            this.counter.commands$.next(command)
            return setTimeout(2000)
                .then(() => command.data * 2)
                .then((result) => {
                    this.eventBus1.publish(new Command1RunEvent(result, command.test))
                    this.eventBus2.publish(new Command1RunEvent(result, command.test))
                    return result
                })
        }
    }

    @Queue2Handler(Command2)
    class Command2Handler implements IQueueHandler<Command2> {
        constructor(public eventBus2: EventBus2, public counter: CounterService) {}
        public execute(command: Command2): Promise<number> {
            this.counter.commands$.next(command)
            return setTimeout(2000)
                .then(() => command.data * 3)
                .then((result) => {
                    this.eventBus2.publish(new Command2RunEvent(result, command.test))
                    return result
                })
        }
    }

    @Injectable()
    class EffectProvider2 {
        @Effect2(Command2RunEvent)
        public handleCommand2RunEvent: IEffect<Command2RunEvent> = (event): number => {
            this.counter.effects$.next({
                effect: 'handleCommand2RunEvent',
                provider: this,
                test: event.test,
            })
            return event.data + 2
        }
        @ParallelEffect2(Command2RunEvent)
        public parallelHandleCommand2RunEvent: IEffect<Command2RunEvent> = (event): number => {
            this.counter.effects$.next({
                effect: 'parallelHandleCommand2RunEvent',
                provider: this,
                test: event.test,
            })
            return event.data * 20
        }
        @Effect1(Command1RunEvent)
        public handleCommand1RunEvent: IEffect<Command1RunEvent> = (event): number => {
            this.counter.effects$.next({
                effect: 'handleCommand1RunEvent',
                provider: this,
                test: event.test,
            })

            throw new Error('teste')
        }
        @ParallelEffect1(Command1RunEvent)
        public parallelHandleCommand1RunEvent: IEffect<Command1RunEvent> = (event): number => {
            this.counter.effects$.next({
                effect: 'parallelHandleCommand1RunEvent',
                provider: this,
                test: event.test,
            })
            return event.data * 200
        }
        constructor(public counter: CounterService) {}
    }

    @Injectable()
    class EffectProvider1 {
        @Effect2(Command2RunEvent)
        public handleCommand2RunEvent: IEffect<Command2RunEvent> = (event): number => {
            this.counter.effects$.next({
                effect: 'handleCommand2RunEvent',
                provider: this,
                test: event.test,
            })
            return event.data + 2
        }
        @ParallelEffect2(Command2RunEvent)
        public parallelHandleCommand2RunEvent: IEffect<Command2RunEvent> = (event): number => {
            this.counter.effects$.next({
                effect: 'parallelHandleCommand2RunEvent',
                provider: this,
                test: event.test,
            })
            return event.data * 20
        }
        @Effect1(Command1RunEvent)
        public handleCommand1RunEvent: IEffect<Command1RunEvent> = (event): number => {
            this.counter.effects$.next({
                effect: 'handleCommand1RunEvent',
                provider: this,
                test: event.test,
            })
            return event.data + 0.2
        }
        @ParallelEffect1(Command1RunEvent)
        public parallelHandleCommand1RunEvent: IEffect<Command1RunEvent> = (event): number => {
            this.counter.effects$.next({
                effect: 'parallelHandleCommand1RunEvent',
                provider: this,
                test: event.test,
            })
            return event.data * 200
        }
        constructor(public counter: CounterService) {}
    }

    const createConfig =
        (port: number, transport: Transport) =>
        (name: string, id = v4()): Type<IQueueConfigService> => {
            @Injectable()
            class QueueConfigService implements IQueueConfigService {
                public environment = ''
                public name = name
                public id = `${name}_${id}`
                public host = 'localhost'
                public messageBrooker = transport
                public port = port

                @eventOnReceive(EventBus1)
                public onReceiveEvent = (event: IPubEvent): void => {
                    this.counter.events$.next(event.data.event)
                }
                constructor(public counter: CounterService) {}
            }
            return QueueConfigService
        }

    // configs factories
    const rabbitConfig = createConfig(5672, Transport.rabbitMQ)
    // const bullConfig = createConfig(6379, Transport.bullMQ)

    let app1: QueueModuleRef
    let app1a: QueueModuleRef
    let app2: QueueModuleRef

    const createModuleRef = (config: Type<IQueueConfigService>): Promise<TestingModule> => {
        const queueModule = QueueModule.register(
            config,
            [QueueBus1, QueueBus2, EventBus1, EventBus2],
            true,
            {
                providers: [
                    Command1Handler,
                    Command2Handler,
                    EffectProvider2,
                    EffectProvider1,
                    CounterService,
                    HooksService,
                ],
            },
        )

        return Test.createTestingModule({
            imports: [queueModule],
        }).compile()
    }

    const beforeAllHelper =
        (config: (name: string, p?: string) => Type<IQueueConfigService>) =>
        async (): Promise<void> => {
            const p = async (n: string, p?: string): Promise<QueueModuleRef> => {
                const app = await createModuleRef(config(n, p))
                await app.init()
                return {
                    queueBus1: app.get<QueueBusBase>(QueueBus1),
                    queueBus2: app.get<QueueBusBase>(QueueBus2),
                    eventBus1: app.get<EventBusBase>(EventBus1),
                    eventBus2: app.get<EventBusBase>(EventBus2),
                    commands: [Command1, Command2],
                    events: [Command2RunEvent, Command1RunEvent],
                    effects: [
                        app.get<EffectProvider1>(EffectProvider1),
                        app.get<EffectProvider2>(EffectProvider2),
                    ],
                    commandHandlers: [
                        app.get<Command1Handler>(Command1Handler),
                        app.get<Command2Handler>(Command2Handler),
                    ],
                    app,
                    config: app.get<IQueueConfigService>(QUEUE_CONFIG_SERVICE),
                    counter: app.get<CounterService>(CounterService),
                }
            }

            ;[app1, app2, app1a] = await Promise.all([
                p('app1', 'a'),
                p('app2', 'a'),
                p('app1', 'b'),
            ])
        }

    const testsWrapper = (
        name: string,
        config: (name: string) => Type<IQueueConfigService>,
    ): void => {
        describe(name, () => {
            beforeAll(beforeAllHelper(config))

            describe('single app', () => {
                describe('queueModule', () => {
                    test('if instances are valid', () => {
                        ;[app1, app2, app1a].forEach((app) => {
                            expect(app.queueBus1).toBeDefined()
                            expect(app.queueBus2).toBeDefined()
                            expect(app.eventBus1).toBeDefined()
                            expect(app.eventBus2).toBeDefined()
                            app.commandHandlers.forEach((handler) => {
                                expect(handler).toBeDefined()
                            })
                            app.effects.forEach((effect) => {
                                expect(effect).toBeDefined()
                            })
                            app.events.forEach((event) => {
                                expect(event).toBeDefined()
                            })
                            app.commands.forEach((command) => {
                                expect(command).toBeDefined()
                            })
                        })
                    })

                    it('should have registered all commandHandlers for the commands', () => {
                        ;[app1, app2, app1a].forEach((app) => {
                            expect(app.queueBus1['handlers'].get(app.commands[0].name)).toBe(
                                app.commandHandlers[0],
                            )
                            expect(app.queueBus2['handlers'].get(app.commands[1].name)).toBe(
                                app.commandHandlers[1],
                            )
                        })
                    })
                    it('should have registered all effects for the events', () => {
                        ;[app1, app2, app1a].forEach((app) => {
                            ;[1, 2].forEach((i) => {
                                ;[0, 1].forEach((j) => {
                                    const effectProvider = app[`eventBus${i}`]['effects'].get(
                                        app.effects[j],
                                    )

                                    expect(effectProvider).toBeDefined()

                                    expect(
                                        effectProvider.get(
                                            (app.effects[j] as EffectProvider1)[
                                                `handleCommand${i}RunEvent`
                                            ],
                                        ),
                                    ).toBeDefined()
                                    expect(
                                        effectProvider.get(
                                            (app.effects[j] as EffectProvider1)[
                                                `parallelHandleCommand${i}RunEvent`
                                            ],
                                        ),
                                    ).toBeDefined()
                                })
                            })
                        })
                    })
                })

                describe('commands', () => {
                    it('should run the command handler for the command', async () => {
                        const fn = jest.spyOn(app1.commandHandlers[0], 'execute')
                        const t = v4()
                        const data = new Command1(10, t)
                        await expect(app1.queueBus1.execute(data)).resolves.toBe(20)
                        expect(fn).toBeCalledWith(data)
                    })

                    it('should run the command handler for the command in another instance', async () => {
                        const t1 = v4()
                        const t2 = v4()
                        const data1 = new Command1(13, t1)
                        const data2 = new Command1(10, t2)
                        await Promise.all([
                            expect(
                                app1.queueBus1.execute(data2, { projectName: 'app2' }),
                            ).resolves.toBe(20),
                            expect(
                                app2.queueBus1.execute(data1, { projectName: 'app1' }),
                            ).resolves.toBe(26),
                            expect(
                                firstValueFrom(
                                    app2.counter.commands$.pipe(filter((c) => c?.test === t2)),
                                ),
                            ).resolves.toBeDefined(),
                            expect(
                                lastValueFrom(
                                    merge(app1.counter.commands$, app1a.counter.commands$).pipe(
                                        filter((c) => c?.test === t1),
                                        bufferTime(3000),
                                        take(1),
                                    ),
                                ),
                            ).resolves.toHaveLength(1),
                        ])
                    })

                    it('should throw if command handler does not exists', async () => {
                        class NonExistingCommand extends Command<number> {
                            constructor(public data: number) {
                                super()
                            }
                        }
                        await Promise.all([
                            expect(
                                app1.queueBus1.execute(new NonExistingCommand(2), {
                                    projectName: 'app2',
                                }),
                            ).rejects.toThrowError(JobException),
                            expect(
                                app1.queueBus1.execute(new NonExistingCommand(2)),
                            ).rejects.toThrowError(
                                new InvalidQueueHandlerException('NonExistingCommand').message,
                            ),
                        ])
                    })
                })

                describe('command errors', () => {
                    it('should throw if the command handler throws', async () => {
                        const fn = jest
                            .spyOn(app2.commandHandlers[0], 'execute')
                            .mockImplementation(async (): Promise<number> => {
                                throw new Error('aha')
                            })

                        const t = v4()
                        const data = new Command1(10, t)
                        await Promise.all([
                            expect(
                                app1.queueBus1.execute(data, { projectName: 'app2' }),
                            ).rejects.toThrowError('aha'),
                            expect(app2.queueBus1.execute(data)).rejects.toThrowError('aha'),
                        ])
                        fn.mockRestore()
                    })
                })

                describe('events', () => {
                    test('events should reach each app once', async () => {
                        const t = v4()
                        const data = new Command1(10, t)

                        await Promise.all([
                            expect(
                                lastValueFrom(
                                    app1.counter.events$.pipe(
                                        filter((e) => e?.test === t),
                                        bufferTime(10000),
                                        take(1),
                                    ),
                                ),
                            ).resolves.toBeDefined(),
                            expect(
                                lastValueFrom(
                                    app1a.counter.events$.pipe(
                                        filter((e) => e?.test === t),
                                        bufferTime(10000),
                                        take(1),
                                    ),
                                ),
                            ).resolves.toBeDefined(),
                            expect(
                                lastValueFrom(
                                    app2.counter.events$.pipe(
                                        filter((e) => e?.test === t),
                                        bufferTime(10000),
                                        take(1),
                                    ),
                                ),
                            ).resolves.toBeDefined(),

                            expect(app1.queueBus1.execute(data)).resolves.toBe(20),
                        ])
                    })

                    it('should be able to create observable to listen to events', (done) => {
                        const events$ = app1.eventBus1.fromEvent(app1.events[0])

                        const t = v4()
                        const data = new Command1(87, t)
                        events$.pipe(takeUntil(timer(3000))).subscribe({
                            next: (value) => {
                                console.log(value)
                            },
                            complete: done,
                        })

                        void expect(app1.queueBus1.execute(data)).resolves.toBe(87 * 2)
                    })
                })
                describe('effects', () => {
                    let appEffects$: Observable<{ effect: string; test: string; provider: any }>

                    beforeAll(() => {
                        appEffects$ = merge(
                            app1.counter.effects$,
                            app2.counter.effects$,
                            app1a.counter.effects$,
                        )
                    })

                    it('should run the effect only once per event', async () => {
                        const t = v4()
                        const data = new Command1(10, t)

                        await Promise.all([
                            expect(
                                lastValueFrom(
                                    appEffects$.pipe(
                                        filter((e) => {
                                            return (
                                                e?.test === t &&
                                                e.effect === 'handleCommand1RunEvent'
                                            )
                                        }),
                                        bufferTime(15000),
                                        take(1),
                                    ),
                                ),
                            ).resolves.toHaveLength(2),
                            expect(app1.queueBus1.execute(data)).resolves.toBe(20),
                        ])
                    })
                    it('should run all the parallel effects', async () => {
                        const t = v4()
                        const data = new Command1(10, t)

                        await Promise.all([
                            expect(
                                lastValueFrom(
                                    appEffects$.pipe(
                                        filter((e) => {
                                            return (
                                                e?.test === t &&
                                                e.effect === 'parallelHandleCommand1RunEvent'
                                            )
                                        }),
                                        bufferTime(15000),
                                        take(1),
                                    ),
                                ),
                            ).resolves.toHaveLength(6),
                            expect(app1.queueBus1.execute(data)).resolves.toBe(20),
                        ])
                    })
                })
            })

            describe('multiple apps in different environments', () => {
                it.todo('should run the command a single time')
                it.todo('should multiple commands in multiple apps')
                it.todo('should not run command in different enviroment')
                it.todo('should emmit event')
                it.todo('should receive event in all modules')
                it.todo('should not receive event in different enviroment')
                it.todo('should run effect only once per event')
            })

            describe('hooks', () => {
                describe('effect hooks', () => {
                    test.todo('effect hooks')
                })
                describe('job hooks', () => {
                    test.todo('effect hooks')
                })
                describe('event hooks', () => {
                    test.todo('effect hooks')
                })
            })

            describe('streams', () => {
                test.todo('should send itens from observable until completion')
                test.todo('should catch and send error from rxjs stream through the message')
                test.todo('should be able to await execute, even if it returns an obsersavable')
            })
        })
    }

    testsWrapper('rabbitMq', rabbitConfig)
    // testsWrapper('bullMq', bullConfig)
})
