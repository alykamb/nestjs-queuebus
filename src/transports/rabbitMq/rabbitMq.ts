import { Inject, Injectable, OnModuleInit } from '@nestjs/common'
import { Channel, connect, Connection, Message, Options, Replies } from 'amqplib'
import { BehaviorSubject, forkJoin, interval, merge, of, race, Subject, Subscription } from 'rxjs'
import { filter, map, mapTo, mergeMap, scan, take } from 'rxjs/operators'
import { v4 } from 'uuid'

import { QUEUE_CONFIG_SERVICE, TIMEOUT } from '../../constants'
import { JobException } from '../../exceptions'
import { TimeoutException } from '../../exceptions/timeout.exception'
import { IQueueConfigService } from '../../interfaces'
import { IPubEvent } from '../../interfaces/events/jobEvent.interface'
import { IExecutionOptions } from '../../interfaces/executionOptions.interface'
import { EventCallback, ITransport } from '../../interfaces/transport.interface'
import { Callback } from '../../types/callback'

enum WORKERS_EVENTS {
    CHANNEL = 'WORKERS',
}

enum EVENTS {
    CHANNEL = 'EVENTS',
    PUBLISH = 'PUBLISH',
}

type ConsumerCallback = (error: Error, v: any, message: Message) => void
type ConsumerCallbackOptions =
    | ConsumerCallback
    | { callback: ConsumerCallback; removeOnCall: boolean }

@Injectable()
export class RabbitMq implements ITransport, OnModuleInit {
    private closing = false
    private publisher: Connection
    private consumer: Connection
    private workers = new Map<string, Channel>()
    private effects = new Map<string, { callback: EventCallback; parallel?: boolean }>()
    private eventListeners = new Map<string, EventCallback>()
    private effectsEvents = new Map<
        string,
        { name: string; projectName: string; eventBusName: string }
    >()
    private publisherChannel: Channel
    private consumerChannel: Channel
    private consumerCallbacks = new Map<string, ConsumerCallbackOptions>()
    private consumerQueue: Replies.AssertQueue
    private eventPublisherChannel: Channel
    private eventListenerChannel: Channel

    private numberOfActiveJobs$ = new BehaviorSubject<number>(0)
    private addJob$ = new Subject<void>()
    private workersJobs = new Map<string, BehaviorSubject<number>>()
    private removeJob$ = new Subject<void>()
    private numberOfActiveJobsSub: Subscription

    private init = false

    constructor(@Inject(QUEUE_CONFIG_SERVICE) private readonly queueConfig: IQueueConfigService) {
        this.numberOfActiveJobsSub = merge(
            this.addJob$.pipe(
                map(
                    () =>
                        (s: number): number =>
                            s + 1,
                ),
            ),
            this.removeJob$.pipe(
                map(
                    () =>
                        (s: number): number =>
                            s - 1,
                ),
            ),
        )
            .pipe(scan((s, f) => f(s), 0))
            .subscribe((n) => this.numberOfActiveJobs$.next(n))
    }

    public async getPublisher(): Promise<Connection> {
        if (!this.publisher) {
            this.publisher = await connect(this.connectionObject)
        }
        return this.publisher
    }

    protected get connectionObject(): Options.Connect {
        return {
            hostname: this.queueConfig.host,
            port: this.queueConfig.port,
            username: this.queueConfig.username,
            password: this.queueConfig.password,
            heartbeat: this.queueConfig.heartbeat,
        }
    }

    public async getConsumer(): Promise<Connection> {
        if (!this.consumer) {
            this.consumer = await connect(this.connectionObject)
        }
        return this.consumer
    }

    public async getPublisherChannel(): Promise<Channel> {
        await this.getPublisher()
        if (!this.publisherChannel) {
            this.publisherChannel = await this.publisher.createChannel()
        }
        return this.publisherChannel
    }

    public async getConsumerChannel(): Promise<Channel> {
        await this.getConsumer()
        if (!this.consumerChannel) {
            this.consumerChannel = await this.consumer.createChannel()
        }
        return this.consumerChannel
    }

    private async getConsummerQueue(): Promise<Replies.AssertQueue> {
        const consumerChannel = await this.getConsumerChannel()
        if (!this.consumerQueue) {
            this.consumerQueue = await consumerChannel.assertQueue('', { exclusive: true })
        }

        return this.consumerQueue
    }

    private listenResponseMessages(): void {
        void this.getConsummerQueue().then((queue) => {
            return this.consumerChannel.consume(
                queue.queue,
                (message) => {
                    if (!message?.content) {
                        return
                    }
                    const options = this.consumerCallbacks.get(message.properties.correlationId)
                    const cb: ConsumerCallback =
                        (options as { callback: ConsumerCallback; removeOnCall: boolean })
                            ?.callback || (options as ConsumerCallback)
                    if (cb) {
                        try {
                            const value = JSON.parse(message.content.toString('utf8'))
                            cb(null, value, message)
                            if (
                                (options as { callback: ConsumerCallback; removeOnCall: boolean })
                                    ?.removeOnCall === false
                            ) {
                                return
                            }
                            this.consumerCallbacks.delete(message.properties.correlationId)
                        } catch (err) {
                            cb(err, null, message)
                        }
                    }
                },
                {
                    noAck: true,
                },
            )
        })
    }

    public async getEventPublisherChannel(): Promise<Channel> {
        await this.getPublisher()
        if (!this.eventPublisherChannel) {
            this.eventPublisherChannel = await this.publisher.createChannel()
        }
        return this.eventPublisherChannel
    }

    public async getEventListenerChannel(): Promise<Channel> {
        await this.getPublisher()
        if (!this.eventListenerChannel) {
            this.eventListenerChannel = await this.publisher.createChannel()
            await this.eventListenerChannel.assertExchange(
                this.environmentName(WORKERS_EVENTS.CHANNEL),
                'fanout',
                {
                    durable: false,
                },
            )
        }
        return this.eventListenerChannel
    }

    public async publishEvent<EventBase extends IPubEvent = IPubEvent>(
        eventBusName: string,
        event: EventBase,
    ): Promise<void> {
        const eventPublisher = await this.getEventPublisherChannel()
        await eventPublisher.assertExchange(EVENTS.CHANNEL, 'fanout', { durable: false })

        const [queue, publisherChannel] = await Promise.all([
            this.getConsummerQueue(),
            this.getPublisherChannel(),
        ])

        const id = v4()

        const effects = new Map<
            string,
            Array<{
                replyTo: string
                correlationId: string
                parallel: boolean
                instanceId: string
            }>
        >()

        let timeout

        const sendToEffect = (): void => {
            const countPerInstance = new Map<string, number>()

            effects.forEach((value) =>
                value.forEach((val) => {
                    countPerInstance.set(val.instanceId, 0)
                }),
            )

            effects.forEach((value) => {
                let chosen = Math.floor(Math.random() * value.length)

                if (countPerInstance.size) {
                    const values = Array.from(countPerInstance.values())
                    const min = Math.min(...values)

                    const instances = Array.from(countPerInstance.entries())
                        .filter((i) => i[1] === min)
                        .map((i) => i[0])
                    const available = value.reduce((acc, value, i) => {
                        if (instances.includes(value.instanceId)) {
                            acc.push(i)
                        }
                        return acc
                    }, [])

                    chosen = available[Math.floor(Math.random() * available.length)]
                }

                value.forEach((val, i) => {
                    const sendValue = val.parallel || i === chosen ? event : false

                    if (sendValue) {
                        countPerInstance.set(
                            val.instanceId,
                            (countPerInstance.get(val.instanceId) ?? 0) + 1,
                        )
                    }

                    publisherChannel.sendToQueue(
                        val.replyTo,
                        Buffer.from(JSON.stringify(sendValue), 'utf-8'),
                        {
                            correlationId: val.correlationId,
                        },
                    )
                })
            })
        }

        this.consumerCallbacks.set(id, {
            callback: (err, value, message) => {
                if (!effects.has(value.effecName)) {
                    effects.set(value.effecName, [
                        {
                            replyTo: message.properties.replyTo,
                            correlationId: value.id,
                            parallel: value.parallel,
                            instanceId: value.instanceId,
                        },
                    ])
                } else {
                    effects.get(value.effecName).push({
                        replyTo: message.properties.replyTo,
                        correlationId: value.id,
                        parallel: value.parallel,
                        instanceId: value.instanceId,
                    })
                }

                if (timeout) {
                    clearTimeout(timeout)
                }
                timeout = setTimeout(() => {
                    sendToEffect()
                    this.consumerCallbacks.delete(message.properties.correlationId)
                }, 2000)
            },
            removeOnCall: false,
        })

        eventPublisher.publish(
            this.environmentName(WORKERS_EVENTS.CHANNEL),
            '',
            Buffer.from(
                JSON.stringify({
                    event: EVENTS.PUBLISH,
                    from: this.from,
                    data: event,
                    eventBusName,
                }),
            ),
            { replyTo: queue.queue, correlationId: id },
        )
    }

    public registerEffect<EventBase extends IPubEvent = IPubEvent>(
        name: string,
        callback: EventCallback<EventBase>,
        parallel: boolean,
        ...events: Array<{ name: string; projectName: string; eventBusName: string }>
    ): void {
        this.effects.set(name, { callback, parallel })
        events.forEach((e) => {
            this.effectsEvents.set(name, e)
        })
    }

    public removeEffect(name: string): void {
        this.effects.delete(name)
    }

    public registerEventListener<EventBase extends IPubEvent = IPubEvent>(
        name: string,
        cb: EventCallback<EventBase>,
    ): void {
        this.eventListeners.set(name, cb)
    }

    public removeEventListener(name: string): void {
        this.eventListeners.delete(name)
    }

    public listenToEvents(): void {
        void Promise.all([this.getEventListenerChannel(), this.getEventPublisherChannel()]).then(
            ([listener]) => {
                return listener.assertQueue('', { exclusive: true }).then((q) => {
                    void listener.bindQueue(
                        q.queue,
                        this.environmentName(WORKERS_EVENTS.CHANNEL),
                        '',
                    )

                    void listener.consume(
                        q.queue,
                        (msg) => {
                            if (!msg?.content) {
                                return
                            }

                            if (this.closing) {
                                return
                            }

                            const value: IPubEvent = JSON.parse(msg.content.toString())
                            if (value.from.id === this.from.id && !value?.data?.projectName) {
                                return
                            }

                            for (const [name, cb] of this.eventListeners.entries()) {
                                try {
                                    if (name === value.eventBusName) {
                                        cb(value.data)
                                    }
                                } catch (err) {}
                            }

                            const effects = Array.from(this.effectsEvents.entries()).filter(
                                (effect) =>
                                    effect[1].eventBusName === value.eventBusName &&
                                    effect[1].projectName === value.data.projectName &&
                                    this.effectsEvents.get(effect[0])?.name === value.data.name,
                            )

                            if (!effects?.length) {
                                return
                            }
                            effects.forEach(([effecName]) => {
                                const id = v4()
                                const { callback, parallel } = this.effects.get(effecName)

                                void Promise.all([
                                    this.getConsummerQueue(),
                                    this.getPublisherChannel(),
                                ]).then(([queue, worker]) => {
                                    this.consumerCallbacks.set(id, (err, value) => {
                                        if (err || !value) {
                                            return
                                        }
                                        this.addJob$.next()
                                        try {
                                            const res = callback(value)

                                            if (res instanceof Promise) {
                                                void res.then(() => {
                                                    this.removeJob$.next()
                                                })
                                            } else {
                                                this.removeJob$.next()
                                            }
                                        } catch (err) {
                                            this.removeJob$.next()
                                        }
                                    })

                                    worker.sendToQueue(
                                        msg.properties.replyTo,
                                        Buffer.from(
                                            JSON.stringify({
                                                effecName,
                                                parallel,
                                                id,
                                                instanceId: this.queueConfig.id,
                                            }),
                                            'utf-8',
                                        ),
                                        {
                                            correlationId: msg.properties.correlationId,
                                            replyTo: queue.queue,
                                        },
                                    )
                                })
                            })
                        },
                        {
                            noAck: true,
                        },
                    )
                })
            },
        )
    }

    private get from(): IPubEvent['from'] {
        return {
            name: this.queueConfig.name,
            id: this.queueConfig.id,
            environment: this.queueConfig.environment || '',
        }
    }
    private environmentName(name: string): string {
        return this.from.environment?.length ? `${name}_${this.from.environment}` : name
    }

    public addJob<TRet = any, TData = any>(
        projectName: string,
        name: string,
        data: TData,
        onFinish: Callback<TRet>,
        options: IExecutionOptions = {},
    ): void {
        const queueName = this.environmentName(projectName)
        void Promise.all([this.getConsummerQueue(), this.getPublisherChannel()]).then(
            ([queue, worker]) => {
                const id = options?.id || v4()

                return Promise.race([
                    new Promise((resolve) => {
                        this.consumerCallbacks.set(id, (error, value) => {
                            this.removeJob$.next()
                            if (error || value.error) {
                                return resolve({
                                    error: error || new JobException(value.error, value.extra),
                                })
                            }
                            return resolve({ result: value.data })
                        })

                        worker.sendToQueue(
                            queueName,
                            Buffer.from(JSON.stringify({ name, data }), 'utf-8'),
                            {
                                correlationId: id,
                                replyTo: queue.queue,
                            },
                        )
                        this.addJob$.next()
                    }),
                    new Promise((resolve) =>
                        setTimeout(
                            () =>
                                resolve({
                                    error: new TimeoutException(
                                        queueName,
                                        name,
                                        data,
                                        options.timeout || TIMEOUT,
                                    ),
                                }),
                            options.timeout || TIMEOUT,
                        ),
                    ),
                ]).then(({ error, result }) => onFinish(error, result))
            },
        ).catch(error => onFinish(error))
    }

    public async getWorkerChannel(name: string): Promise<Channel> {
        let channel = this.workers.get(name)
        if (!channel) {
            await this.getConsumer()
            channel = await this.consumer.createChannel()
            this.workers.set(name, channel)
            this.workersJobs.set(name, new BehaviorSubject(0))

            await channel.assertQueue(name, {
                durable: true,
            })
        }
        return channel
    }

    public async createWorker(name: string, callback: (data: any) => Promise<any>): Promise<void> {
        const queueName = this.environmentName(name)
        const [workerChannel, publisher] = await Promise.all([
            this.getWorkerChannel(queueName),
            this.getPublisherChannel(),
        ])

        void workerChannel.consume(
            queueName,
            (message) => {
                if (!message?.content) {
                    return
                }

                let value = null
                let result: Buffer | Promise<Buffer>
                try {
                    if (this.closing) {
                        workerChannel.nack(message)
                        return
                    }

                    this.workersJobs.get(queueName).next(this.workersJobs.get(queueName).value + 1)

                    value = JSON.parse(message.content.toString('utf-8'))
                    result = callback(value)
                        .then((data) => {
                            return Buffer.from(JSON.stringify({ data }), 'utf-8')
                        })
                        .catch((err) => {
                            const entries = Object.entries(err)
                            let extra = null
                            if (entries.length) {
                                extra = entries.reduce(
                                    (acc, [name, value]) => ({ ...acc, [name]: value }),
                                    {},
                                )
                            }

                            return Buffer.from(
                                JSON.stringify({ error: err.message, extra }),
                                'utf-8',
                            )
                        })
                } catch (err) {
                    result = Buffer.from(JSON.stringify({ error: err.message }), 'utf-8')
                } finally {
                    try {
                        if (result instanceof Promise) {
                            void result.then((value) => {
                                publisher.sendToQueue(message.properties.replyTo, value, {
                                    correlationId: message.properties.correlationId,
                                })
                                workerChannel.ack(message)
                                this.workersJobs
                                    .get(queueName)
                                    .next(this.workersJobs.get(queueName).value - 1)
                            })
                            return
                        }
                        publisher.sendToQueue(message.properties.replyTo, result, {
                            correlationId: message.properties.correlationId,
                        })
                        workerChannel.ack(message)
                        this.workersJobs
                            .get(queueName)
                            .next(this.workersJobs.get(queueName).value - 1)
                    } catch (err) {
                        // eslint-disable-next-line no-console
                        console.error('Error in responding job result: ')
                        // eslint-disable-next-line no-console
                        console.error(err)
                    }
                }
            },
            {
                noAck: false,
            },
        )
    }

    public onModuleInit(): void {
        if (!this.init) {
            this.init = true
            this.listenToEvents()
            this.listenResponseMessages()
        }
    }

    public async onModuleDestroy(): Promise<boolean> {
        this.closing = true

        //espera workers terminarem
        await of(Array.from(this.workersJobs.values()))
            .pipe(
                mergeMap((v) =>
                    forkJoin(
                        v.map((a) =>
                            race([
                                a.pipe(
                                    filter((v2) => v2 <= 0),
                                    take(1),
                                ),
                                interval(10000).pipe(take(1)),
                            ]),
                        ),
                    ),
                ),
                mapTo(true),
            )
            .toPromise()

        await Promise.all(
            Array.from(this.workers.entries()).map(async (worker) => {
                worker[1].nackAll()
                await worker[1].deleteQueue(worker[0])
                await worker[1].close()
            }),
        )

        this.numberOfActiveJobsSub?.unsubscribe?.()

        if (this.eventListenerChannel) {
            await this.eventListenerChannel.close()
        }
        if (this.consumerChannel) {
            await this.consumerChannel.close()
        }

        await this.consumer.close()
        await this.publisher.close()

        return true
    }
}
