import { Inject, Injectable, OnModuleInit } from '@nestjs/common'
import { Channel, connect, Connection } from 'amqplib'
import { BehaviorSubject, merge, Subject, Subscription } from 'rxjs'
import { map, scan } from 'rxjs/operators'
import { v4 } from 'uuid'

import { QUEUE_CONFIG_SERVICE } from '../constants'
import { JobException } from '../exceptions'
import { IQueueConfigService } from '../interfaces'
import { PubEvent } from '../interfaces/events/jobEvent.interface'
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
    private publisher: Connection
    private consumer: Connection
    private workers = new Map<string, Channel>()
    private sagas = new Map<string, EventCallback>()
    private queueSagas = new Map<string, string>()
    private sagasEvents = new WeakMap<EventCallback, string>()
    private publisherChannel: Channel
    private eventPublisherChannel: Channel
    private eventListenerChannel: Channel

    private numberOfActiveJobs$ = new BehaviorSubject<number>(0)
    private addJob$ = new Subject<null>()
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

    public async createConsumerChannel(): Promise<Channel> {
        await this.getConsumer()
        return this.consumer.createChannel()
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

    public async publishEvent<EventBase extends PubEvent = PubEvent>(
        event: EventBase,
    ): Promise<void> {
        const eventPublisher = await this.getEventPublisherChannel()
        await eventPublisher.assertExchange(EVENTS.CHANNEL, 'fanout', { durable: false })

        const [consumerChannel, publisherChannel] = await Promise.all([
            this.createConsumerChannel(),
            this.getPublisherChannel(),
        ])

        const id = v4()
        void consumerChannel.assertQueue('', { exclusive: true }).then((queue) => {
            const sagas = new Map<string, string[]>()
            let timeout

            const sendToSaga = (v: { sagaName: string; id: string }): void => {
                sagas.forEach((value) => {
                    const chosen = Math.floor(Math.random() * value.length)

                    value.forEach((val, i) => {
                        publisherChannel.sendToQueue(
                            val,
                            Buffer.from(JSON.stringify(i === chosen ? event : false), 'utf-8'),
                            {
                                correlationId: v.id,
                            },
                        )
                    })
                })
                void consumerChannel.close()
            }

            void consumerChannel.consume(
                queue.queue,
                (message) => {
                    if (message?.properties?.correlationId !== id) {
                        void consumerChannel.deleteQueue(queue.queue)
                        void consumerChannel.close()
                        return
                    }

                    const value = JSON.parse(message.content.toString())
                    if (!sagas.has(value.sagaName)) {
                        sagas.set(value.sagaName, [message.properties.replyTo])
                    } else {
                        sagas.get(value.sagaName).push(message.properties.replyTo)
                    }

                    if (timeout) {
                        clearTimeout(timeout)
                    }
                    timeout = setTimeout(sendToSaga, 2000, value)
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

    public registerSaga<EventBase extends PubEvent = PubEvent>(
        queueBusName: string,
        name: string,
        callback: EventCallback<EventBase>,
        ...events: string[]
    ): void {
        this.queueSagas.set(name, queueBusName)
        this.sagas.set(name, callback)
        events.forEach((e) => this.sagasEvents.set(callback, e))
    }

    public removeSaga(name: string): void {
        this.sagas.delete(name)
    }

    public listenToEvents(): void {
        void Promise.all([this.getEventListenerChannel(), this.getEventPublisherChannel()]).then(
            ([listener]) => {
                return listener.assertQueue('', { exclusive: true }).then((q) => {
                    void listener.bindQueue(q.queue, WORKERS_EVENTS.CHANNEL, '')

                    void listener.consume(
                        q.queue,
                        (msg) => {
                            if (msg.content) {
                                const value: PubEvent = JSON.parse(msg.content.toString())
                                if (value.from.id === this.from.id && !value?.data?.queueName) {
                                    return
                                }

                                const sagaName = Array.from(this.queueSagas.entries()).find(
                                    (name) => name[1] === value.data.queueName,
                                )?.[0]

                                if (!sagaName) {
                                    return
                                }

                                const id = v4()

                                void Promise.all([
                                    this.createConsumerChannel(),
                                    this.getPublisherChannel(),
                                ]).then(([consumer, worker]) => {
                                    void consumer
                                        .assertQueue('', { exclusive: true })
                                        .then((queue) => {
                                            void consumer.consume(
                                                queue.queue,
                                                (message) => {
                                                    try {
                                                        const value = JSON.parse(
                                                            message.content.toString('utf-8'),
                                                        )

                                                        if (value) {
                                                            void this.sagas.get(sagaName)(value)
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
                                                    JSON.stringify({ sagaName, id }),
                                                    'utf-8',
                                                ),
                                                {
                                                    correlationId: msg.properties.correlationId,
                                                    replyTo: queue.queue,
                                                },
                                            )
                                        })
                                })
                            }
                        },
                        {
                            noAck: true,
                        },
                    )
                })
            },
        )
    }

    private get from(): PubEvent['from'] {
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
                                onFinish(error, result)
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
            },
        )
    }

    public async getWorkerChannel(name: string): Promise<Channel> {
        let channel = this.workers.get(name)
        if (!channel) {
            channel = await this.createConsumerChannel()
            this.workers.set(name, channel)

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
                            })
                            return
                        }
                        publisher.sendToQueue(message.properties.replyTo, result, {
                            correlationId: message.properties.correlationId,
                        })
                        workerChannel.ack(message)
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
        if (this.eventListenerChannel) {
            await this.eventListenerChannel.close()
        }
        return true
    }
}
