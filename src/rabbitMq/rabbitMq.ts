import { Inject, Injectable } from '@nestjs/common'
import { Channel, connect, Connection, Options } from 'amqplib'
import { BehaviorSubject, Subject, Subscription } from 'rxjs'
import { v4 } from 'uuid'

import { QUEUE_CONFIG_SERVICE } from '../constants'
import { JobException } from '../exceptions'
import { IQueueConfigService } from '../interfaces'
import { ITransport } from '../interfaces/transport.interface'
import { Callback } from '../types/callback'

@Injectable()
export class RabbitMq implements ITransport {
    private connection: Connection

    private queues = new Map<string, Channel>()

    private workers = new Map<string, Channel>()

    private numberOfActiveJobs$ = new BehaviorSubject<number>(0)
    private addJob$ = new Subject<null>()
    private removeJob$ = new Subject<null>()
    private numberOfActiveJobsSub: Subscription

    private callbacks = new Map<string, Callback>()
    constructor(@Inject(QUEUE_CONFIG_SERVICE) private readonly queueConfig: IQueueConfigService) {}

    public async getConnection(): Promise<Connection> {
        if (!this.connection) {
            this.connection = await connect(
                `amqp://${this.queueConfig.host}:${this.queueConfig.port}`,
            )
        }
        return this.connection
    }

    public addJob<TRet = any, TData = any>(
        module: string,
        name: string,
        data: TData,
        onFinish: Callback<TRet>,
        options: Options.Publish = {},
    ): void {
        void this.getConnection()
            .then((connection) => connection.createChannel())
            .then((channel) => {
                const id = v4()

                void channel.assertQueue('', { exclusive: true }).then((queue) => {
                    void channel.consume(
                        queue.queue,
                        (message) => {
                            if (message.properties.correlationId !== id) {
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
                                onFinish(error, result)
                                void channel.close()
                            }
                        },
                        {
                            noAck: true,
                        },
                    )

                    channel.sendToQueue(
                        module,
                        Buffer.from(JSON.stringify({ name, data }), 'utf-8'),
                        {
                            ...options,
                            correlationId: id,
                            replyTo: queue.queue,
                        },
                    )
                })
            })
    }

    public async createWorker(name: string, callback: (data: any) => Promise<any>): Promise<void> {
        let channel = this.workers.get(name)
        if (!channel) {
            const connection = await this.getConnection()
            channel = await connection.createChannel()
            this.workers.set(name, channel)
            await channel.assertQueue(name, {
                durable: true,
            })
        }

        void channel.consume(name, (message) => {
            channel.ack(message)
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

                        return Buffer.from(JSON.stringify({ error: err.message, extra }), 'utf-8')
                    })
            } catch (err) {
                result = Buffer.from(JSON.stringify({ error: err.message }), 'utf-8')
            } finally {
                try {
                    if (result instanceof Promise) {
                        void result.then((value) => {
                            channel.sendToQueue(message.properties.replyTo, value, {
                                correlationId: message.properties.correlationId,
                            })
                        })
                        return
                    }
                    channel.sendToQueue(message.properties.replyTo, result, {
                        correlationId: message.properties.correlationId,
                    })
                } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error('Error in responding job result: ')
                    // eslint-disable-next-line no-console
                    console.error(err)
                }
            }
        })
    }

    public async onModuleDestroy(): Promise<boolean> {
        return true
    }
}
