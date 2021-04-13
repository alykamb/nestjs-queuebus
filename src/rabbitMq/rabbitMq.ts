import { Inject, Injectable, OnModuleInit } from '@nestjs/common'
import { Channel, connect, Connection } from 'amqplib'
import { BehaviorSubject, forkJoin, interval, merge, of, race, Subject, Subscription } from 'rxjs'
import { filter, map, mapTo, mergeMap, scan, take } from 'rxjs/operators'
import { v4 } from 'uuid'

import { QUEUE_CONFIG_SERVICE, TIMEOUT } from '../constants'
import { JobException } from '../exceptions'
import { TimeoutException } from '../exceptions/timeout.exception'
import { IQueueConfigService } from '../interfaces'
import { IPubEvent } from '../interfaces/events/jobEvent.interface'
import { IExecutionOptions } from '../interfaces/executionOptions.interface'
import { EventCallback, ITransport } from '../interfaces/transport.interface'
import { Callback } from '../types/callback'

enum WORKERS_EVENTS {
    CHANNEL = 'WORKERS',
}

enum EVENTS {
    CHANNEL = 'EVENTS',
    PUBLISH = 'PUBLISH',
}

@Injectable()
export class RabbitMq implements ITransport, OnModuleInit {
    private closing = false
    private publisher: Connection
    private consumer: Connection
    private consumersChannels = new Map<string, Channel>()
    private workers = new Map<string, Channel>()
    private effects = new Map<string, EventCallback>()
    private eventListeners = new Map<string, EventCallback>()
    private queueEffects = new Map<string, string>()
    private effectsEvents = new Map<string, string>()
    private publisherChannel: Channel
    private eventPublisherChannel: Channel
    private eventListenerChannel: Channel

    private numberOfActiveJobs$ = new BehaviorSubject<number>(0)
    private addJob$ = new Subject<null>()
    private workersJobs = new Map<string, BehaviorSubject<number>>()
    private removeJob$ = new Subject<null>()
    private numberOfActiveJobsSub: Subscription

    constructor(@Inject(QUEUE_CONFIG_SERVICE) private readonly queueConfig: IQueueConfigService) {
        this.numberOfActiveJobsSub = merge(
            this.addJob$.pipe(map(() => (s: number): number => s + 1)),
            this.removeJob$.pipe(map(() => (s: number): number => s - 1)),
        )
            .pipe(scan((s, f) => f(s), 0))
            .subscribe((n) => this.numberOfActiveJobs$.next(n))
    }

    public async getPublisher(): Promise<Connection> {
        if (!this.publisher) {
            this.publisher = await connect(
                `amqp://${this.queueConfig.host}:${this.queueConfig.port}`,
            )
        }
        return this.publisher
    }

    public async getConsumer(): Promise<Connection> {
        if (!this.consumer) {
            this.consumer = await connect(
                `amqp://${this.queueConfig.host}:${this.queueConfig.port}`,
            )
        }
        return this.consumer
    }

    public async createConsumerChannel(name?: string): Promise<Channel> {
        await this.getConsumer()
        if (!name) {
            return this.consumer.createChannel()
        }

        let channel = this.consumersChannels.get(name)
        if (!channel) {
            channel = await this.consumer.createChannel()
            this.consumersChannels.set(name, channel)
        }
        return channel
    }

    public async getPublisherChannel(): Promise<Channel> {
        await this.getPublisher()
        if (!this.publisherChannel) {
            this.publisherChannel = await this.publisher.createChannel()
        }
        return this.publisherChannel
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
            await this.eventListenerChannel.assertExchange(WORKERS_EVENTS.CHANNEL, 'fanout', {
                durable: false,
            })
        }
        return this.eventListenerChannel
    }

    public async publishEvent<EventBase extends IPubEvent = IPubEvent>(
        event: EventBase,
    ): Promise<void> {
        const eventPublisher = await this.getEventPublisherChannel()
        await eventPublisher.assertExchange(EVENTS.CHANNEL, 'fanout', { durable: false })

        const [consumerChannel, publisherChannel] = await Promise.all([
            this.createConsumerChannel('event_publisher'),
            this.getPublisherChannel(),
        ])

        const id = v4()
        void consumerChannel.assertQueue('', { exclusive: true }).then((queue) => {
            const effects = new Map<
                string,
                Array<{
                    replyTo: string
                    correlationId: string
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
                        const sendValue = i === chosen ? event : false

                        if (sendValue) {
                            countPerInstance.set(
                                val.instanceId,
                                (countPerInstance.get(val.instanceId) ?? 0) + 1,
                            )
                        }

                        publisherChannel.sendToQueue(
                            val.replyTo,
                            Buffer.from(JSON.stringify(i === chosen ? event : false), 'utf-8'),
                            {
                                correlationId: val.correlationId,
                            },
                        )
                    })
                })
                void consumerChannel.deleteQueue(queue.queue)
            }

            void consumerChannel.consume(
                queue.queue,
                (message) => {
                    if (message?.properties?.correlationId !== id) {
                        void consumerChannel.deleteQueue(queue.queue)
                        return
                    }

                    const value = JSON.parse(message.content.toString())
                    if (!effects.has(value.effecName)) {
                        effects.set(value.effecName, [
                            {
                                replyTo: message.properties.replyTo,
                                correlationId: value.id,
                                instanceId: value.instanceId,
                            },
                        ])
                    } else {
                        effects.get(value.effecName).push({
                            replyTo: message.properties.replyTo,
                            correlationId: value.id,
                            instanceId: value.instanceId,
                        })
                    }

                    if (timeout) {
                        clearTimeout(timeout)
                    }
                    timeout = setTimeout(sendToEffect, 2000)
                },
                {
                    noAck: true,
                },
            )

            eventPublisher.publish(
                WORKERS_EVENTS.CHANNEL,
                '',
                Buffer.from(
                    JSON.stringify({ event: EVENTS.PUBLISH, from: this.from, data: event }),
                ),
                { replyTo: queue.queue, correlationId: id },
            )
        })
    }

    public registerEffect<EventBase extends IPubEvent = IPubEvent>(
        queueBusName: string,
        name: string,
        callback: EventCallback<EventBase>,
        ...events: string[]
    ): void {
        this.queueEffects.set(name, queueBusName)
        this.effects.set(name, callback)
        events.forEach((e) => this.effectsEvents.set(name, e))
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
                    void listener.bindQueue(q.queue, WORKERS_EVENTS.CHANNEL, '')

                    void listener.consume(
                        q.queue,
                        (msg) => {
                            if (!msg.content) {
                                return
                            }

                            if (this.closing) {
                                return
                            }

                            const value: IPubEvent = JSON.parse(msg.content.toString())
                            if (value.from.id === this.from.id && !value?.data?.queueName) {
                                return
                            }

                            for (const cb of this.eventListeners.values()) {
                                try {
                                    cb(value)
                                } catch (err) {}
                            }

                            const effects = Array.from(this.queueEffects.entries()).filter(
                                (name) =>
                                    name[1] === value.data.queueName &&
                                    this.effectsEvents.get(name[0]) === value.data.name,
                            )

                            if (!effects?.length) {
                                return
                            }
                            effects.forEach(([effecName]) => {
                                const id = v4()

                                void Promise.all([
                                    this.createConsumerChannel('effect_consumer'),
                                    this.getPublisherChannel(),
                                ]).then(([consumer, worker]) => {
                                    void consumer
                                        .assertQueue('', { exclusive: true })
                                        .then((queue) => {
                                            void consumer.consume(
                                                queue.queue,
                                                (message) => {
                                                    if (message?.properties?.correlationId !== id) {
                                                        void consumer.deleteQueue(queue.queue)
                                                        return
                                                    }

                                                    try {
                                                        const value = JSON.parse(
                                                            message.content.toString('utf-8'),
                                                        )

                                                        if (value) {
                                                            this.addJob$.next()
                                                            try {
                                                                const res = this.effects.get(
                                                                    effecName,
                                                                )(value)

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
                                                        }
                                                    } catch (err) {}
                                                },
                                                {
                                                    noAck: true,
                                                },
                                            )

                                            worker.sendToQueue(
                                                msg.properties.replyTo,
                                                Buffer.from(
                                                    JSON.stringify({
                                                        effecName,
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
        }
    }

    public addJob<TRet = any, TData = any>(
        module: string,
        name: string,
        data: TData,
        onFinish: Callback<TRet>,
        options: IExecutionOptions = {},
    ): void {
        void Promise.all([this.createConsumerChannel(), this.getPublisherChannel()]).then(
            ([consumer, worker]) => {
                const id = options?.id || v4()

                return Promise.race([
                    new Promise((resolve) => {
                        void consumer.assertQueue('', { exclusive: true }).then((queue) => {
                            void consumer.consume(
                                queue.queue,
                                (message) => {
                                    if (message?.properties?.correlationId !== id) {
                                        void consumer.deleteQueue(queue.queue)
                                        void consumer.close()
                                        return
                                    }

                                    let error: Error
                                    let result: any = null
                                    try {
                                        const value = JSON.parse(message.content.toString('utf-8'))
                                        if (value.error) {
                                            error = new JobException(value.error, value.extra)
                                        } else {
                                            result = value.data
                                        }
                                    } catch (err) {
                                        error = err
                                    } finally {
                                        this.removeJob$.next()
                                        resolve({ error, result })
                                        void consumer.close()
                                    }
                                },
                                {
                                    noAck: true,
                                },
                            )

                            worker.sendToQueue(
                                module,
                                Buffer.from(JSON.stringify({ name, data }), 'utf-8'),
                                {
                                    correlationId: id,
                                    replyTo: queue.queue,
                                },
                            )
                            this.addJob$.next()
                        })
                    }),
                    new Promise((resolve) =>
                        setTimeout(
                            () =>
                                resolve({
                                    error: new TimeoutException(
                                        module,
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
        )
    }

    public async getWorkerChannel(name: string): Promise<Channel> {
        let channel = this.workers.get(name)
        if (!channel) {
            channel = await this.createConsumerChannel()
            this.workers.set(name, channel)
            this.workersJobs.set(name, new BehaviorSubject(0))

            await channel.assertQueue(name, {
                durable: true,
            })
        }
        return channel
    }

    public async createWorker(name: string, callback: (data: any) => Promise<any>): Promise<void> {
        const [workerChannel, publisher] = await Promise.all([
            this.getWorkerChannel(name),
            this.getPublisherChannel(),
        ])

        void workerChannel.consume(
            name,
            (message) => {
                let value = null
                let result: Buffer | Promise<Buffer>
                try {
                    if (this.closing) {
                        workerChannel.nack(message)
                        return
                    }

                    this.workersJobs.get(name).next(this.workersJobs.get(name).value + 1)

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
                                    .get(name)
                                    .next(this.workersJobs.get(name).value - 1)
                            })
                            return
                        }
                        publisher.sendToQueue(message.properties.replyTo, result, {
                            correlationId: message.properties.correlationId,
                        })
                        workerChannel.ack(message)
                        this.workersJobs.get(name).next(this.workersJobs.get(name).value - 1)
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
        this.listenToEvents()
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

        if (this.eventListenerChannel) {
            await this.eventListenerChannel.close()
        }
        return true
    }
}
