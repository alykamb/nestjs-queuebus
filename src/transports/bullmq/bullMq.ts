import { Inject, Injectable, OnModuleInit } from '@nestjs/common'
import {
    ConnectionOptions,
    Job,
    JobsOptions,
    Queue,
    QueueEvents,
    QueueOptions,
    Worker,
    WorkerOptions,
} from 'bullmq'
import Redis from 'ioredis'
import { BehaviorSubject, merge, noop, Subject, Subscription } from 'rxjs'
import { map, scan } from 'rxjs/operators'
import { v4 } from 'uuid'

import { EXTRA_SEPARATOR, JobEventType, QUEUE_CONFIG_SERVICE } from '../../constants'
import { JobException } from '../../exceptions/job.exception'
import {
    ICompletedEvent,
    IFailedEvent,
    IPubEvent,
} from '../../interfaces/events/jobEvent.interface'
import { IQueueConfigService } from '../../interfaces/queueConfigService.interface'
import { ITransport } from '../../interfaces/transport.interface'
import { EventCallback } from '../../interfaces/transport.interface'
import { Callback } from '../../types/callback'
import { EVENTS } from '../rabbitMq/rabbitMq.constants'

const EVENT_CHANNEL_NAME = 'nestjs_queuebus_events'

@Injectable()
export class BullMq implements ITransport, OnModuleInit {
    /** Mantém a referência do worker para cada queue */
    private workers = new Map<string, Worker>()

    /** Mantém referências da instância da queue com seu nome */
    private queues = new Map<string, Queue>()

    /** Mantém referencia dos listeners e eventos das queues */
    private queueEvents = new Map<string, QueueEvents>()

    private numberOfActiveJobs$ = new BehaviorSubject<number>(0)
    private addJob$ = new Subject<void>()
    private removeJob$ = new Subject<void>()
    private numberOfActiveJobsSub: Subscription

    private callbacks = new Map<string, Callback>()

    private publisher: Redis.Redis
    private subscriber: Redis.Redis

    private effects = new Map<string, EventCallback>()
    private eventListeners = new Map<string, EventCallback>()
    private effectsEvents = new Map<string, { name: string; module: string }>()

    /** conexão com redis */
    private redis: ConnectionOptions

    private closing = false

    constructor(@Inject(QUEUE_CONFIG_SERVICE) private readonly queueConfig: IQueueConfigService) {
        this.redis = {
            host: this.queueConfig?.host || 'localhost',
            port: this.queueConfig?.port || 6379,
        }

        this.publisher = new Redis(this.redis.port, this.redis.host)
        this.subscriber = new Redis(this.redis.port, this.redis.host)

        this.numberOfActiveJobsSub = merge(
            this.addJob$.pipe(map(() => (s: number): number => s + 1)),
            this.removeJob$.pipe(map(() => (s: number): number => s - 1)),
        )
            .pipe(scan((state, f) => f(state), 0))
            .subscribe((n) => {
                this.numberOfActiveJobs$.next(n)
            })
    }
    private get from(): IPubEvent['from'] {
        return {
            name: this.queueConfig.name,
            environment: this.queueConfig.environment || '',
            id: this.queueConfig.id,
        }
    }

    private log(message: string, error = false): void {
        if (this.queueConfig.verbose) {
            if (this.queueConfig.logger) {
                try {
                    this.queueConfig.logger(message, error)
                } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error('error on logging:', err)
                }
            }
            if (error) {
                // eslint-disable-next-line no-console
                console.error(`nesjs_queubus___: ${message}`)
                return
            }
            // eslint-disable-next-line no-console
            console.log(`nesjs_queubus___: ${message}`)
        }
    }

    private environmentName(name: string): string {
        return this.from.environment?.length ? `${name}_${this.from.environment}` : name
    }

    public async onModuleInit(): Promise<void> {
        await this.subscriber.subscribe(this.environmentName(EVENT_CHANNEL_NAME))

        void this.listenToEvents()
    }

    private listenToEvents<EventBase extends IPubEvent = IPubEvent>(): void {
        this.subscriber.on('message', (channel, message) => {
            if (channel !== this.environmentName(EVENT_CHANNEL_NAME)) {
                return
            }
            try {
                const value: EventBase = JSON.parse(message)

                this.log(`received event - ${value.data.name} from ${value.data.module}`)

                for (const cb of this.eventListeners.values()) {
                    try {
                        cb(value)
                    } catch (err) {}
                }

                const effects = Array.from(this.effectsEvents.entries()).filter(
                    (effect) =>
                        effect[1].module === value.data.module &&
                        effect[1]?.name === value.data.name &&
                        this.from.environment === value.from.environment,
                )

                if (!effects?.length) {
                    return
                }

                this.log(
                    `event: - ${value.data.name} from ${
                        value.data.module
                    }, registered effects: ${effects.map(([name]) => name)}`,
                )

                effects.forEach(([effectName]) => {
                    const keyName = `${effectName}_${value.data.name}_${value.from.id}_${value.data.timestamp}_${this.from.environment}`
                    const id = v4()
                    const removeKey = (): void => {
                        //holds the key for one more second, just to be safe in case a late effect gets triggered
                        setTimeout(() => {
                            this.publisher.del(keyName).catch(noop)
                        }, 1000)
                    }

                    void this.publisher
                        .setnx(keyName, id)
                        .then((hasBeenSet) => {
                            if (!hasBeenSet) {
                                this.log(
                                    `event: - ${value.data.name} from ${value.data.module}, effect cannot run: ${keyName}`,
                                )
                                throw new Error()
                            }

                            this.log(
                                `event: - ${value.data.name} from ${value.data.module}, running effect: ${keyName}`,
                            )
                            this.addJob$.next()
                            try {
                                const res = this.effects.get(effectName)(value.data)

                                if (res instanceof Promise) {
                                    void res.then(() => {
                                        this.log(
                                            `event: - ${value.data.name} from ${value.data.module}, effect finished running: ${keyName}`,
                                        )

                                        this.removeJob$.next()
                                        removeKey()
                                    })
                                } else {
                                    this.log(
                                        `event: - ${value.data.name} from ${value.data.module}, effect finished running: ${keyName}`,
                                    )

                                    this.removeJob$.next()
                                    removeKey()
                                }
                            } catch (err) {
                                this.log(
                                    `event: - ${value.data.name} from ${value.data.module}, effect execution error: ${keyName}`,
                                )

                                this.removeJob$.next()
                                removeKey()
                            }
                        })
                        .catch((err) => {
                            this.log(`error running effect: - ${keyName} - ${err?.message || err}`)
                            // eslint-disable-next-line no-console
                        })
                })
            } catch (err) {
                this.log(`error listening to  events: ${err?.message || err}`)
            }
        })
    }

    /**
     * Adiciona um trabalho, criando uma referência da queue se el
     * ainda não existe
     *
     * @param module - nome da módulo para criar a queue
     * @param name - nome do trabalho
     * @param data - dados que serão enviados
     * @param options - opções de Jobs do bulljs
     */
    public addJob<TRet = any, TData = any>(
        module: string,
        name: string,
        data: TData,
        onFinish: Callback<TRet>,
        options?: JobsOptions,
    ): void {
        if (this.closing) {
            throw new Error('This BullMq instance is closing')
        }
        const queueName = this.environmentName(module)
        //cria queue se ela ainda não existe
        if (!this.queueEvents.has(queueName)) {
            this.createQueue(queueName)
        }

        void this.queues
            .get(queueName)
            .add(name, data, options)
            .then((job) => {
                this.addJob$.next()
                this.callbacks.set(job.id, onFinish)
            })
    }

    private endJob(j: IFailedEvent | ICompletedEvent, event: JobEventType): void {
        const cb = this.callbacks.get(j.jobId)
        if (!cb) {
            return
        }
        this.removeJob$.next()
        this.callbacks.delete(j.jobId)

        if (event === JobEventType.completed) {
            cb(null, (j as ICompletedEvent).returnvalue)
        } else if (event === JobEventType.failed) {
            let extra = {}
            let message: string = (j as IFailedEvent).failedReason
            const extraIndex = message.indexOf(EXTRA_SEPARATOR)
            if (extraIndex > -1) {
                const extraJson = message.slice(extraIndex + EXTRA_SEPARATOR.length)
                message = message.slice(0, extraIndex)
                try {
                    extra = JSON.parse(extraJson)
                } catch (err) {
                    extra = {}
                }
            }

            cb(new JobException(message, extra))
        }
    }

    public async publishEvent<EventBase extends IPubEvent = IPubEvent>(
        event: EventBase,
    ): Promise<void> {
        void this.publisher
            .publish(
                this.environmentName(EVENT_CHANNEL_NAME),
                JSON.stringify({
                    event: EVENTS.PUBLISH,
                    from: this.from,
                    data: event,
                }),
            )
            .catch(noop)
    }

    /**
     * Cria a queue e todas as referências necessárias
     * @param module
     */
    private createQueue(module: string): void {
        const queueName = module
        const queueOptions: QueueOptions = {
            connection: this.redis,
            defaultJobOptions: {
                removeOnComplete: true,
                removeOnFail: true,
            },
        }
        //cria a queue
        this.queues.set(queueName, new Queue(queueName, queueOptions))

        this.queueEvents.set(queueName, new QueueEvents(queueName, { connection: this.redis }))

        //ouve os eventos e popula os streams com os resultados
        this.queueEvents.get(queueName).on('completed', (job) => {
            this.endJob(job, JobEventType.completed)
        })
        this.queueEvents.get(queueName).on('failed', (job) => {
            this.endJob(job, JobEventType.failed)
        })
    }

    /**
     * Cria o Worker responsável por processar Jobs da queue
     *
     * @param module
     * @param callback
     */

    public async createWorker(module: string, callback: (job: Job) => Promise<any>): Promise<void> {
        const queueName = this.environmentName(module)
        const workerOptions: WorkerOptions = {
            connection: this.redis,
        }

        if (!this.queueEvents.has(queueName)) {
            this.createQueue(queueName)
        }

        this.workers.set(
            queueName,
            new Worker(
                queueName,
                (job: Job) => {
                    return callback(job).catch((err) => {
                        const entries = Object.entries(err)
                        let entriesText = ''
                        if (entries.length) {
                            const extra = entries.reduce(
                                (acc, [name, value]) => ({ ...acc, [name]: value }),
                                {},
                            )
                            entriesText = `${EXTRA_SEPARATOR}${JSON.stringify(extra)}`
                        }

                        throw new Error(err.message + entriesText)
                    })
                },
                workerOptions,
            ),
        )
    }

    public registerEffect<EventBase extends IPubEvent = IPubEvent>(
        name: string,
        callback: EventCallback<EventBase>,
        ...events: Array<{ name: string; module: string }>
    ): void {
        const effectName = name
        this.effects.set(effectName, callback)
        events.forEach((e) => {
            this.effectsEvents.set(effectName, {
                name: e.name,
                module: e.module,
            })
        })
    }

    public removeEffect(name: string): void {
        this.effects.delete(name)
    }

    public registerEventListener<EventBase extends IPubEvent = IPubEvent>(
        name: string,
        cb: EventCallback<EventBase>,
    ): void {
        const eventListenerName = this.environmentName(name)
        this.eventListeners.set(eventListenerName, cb)
    }

    public removeEventListener(name: string): void {
        const eventListenerName = this.environmentName(name)
        this.eventListeners.delete(eventListenerName)
    }

    public async onModuleDestroy(): Promise<boolean> {
        this.closing = true

        //Parar workers
        await Promise.all(Array.from(this.workers.values()).map((worker) => worker.close()))

        //espera todos os trabalhos em andamento terminarem
        await new Promise((resolve) => {
            const sub = this.numberOfActiveJobs$.subscribe((n) => {
                if (n === 0) {
                    resolve(null)
                    sub.unsubscribe()
                }
            })
        })
        this.numberOfActiveJobsSub.unsubscribe()

        //remover listeners
        this.queueEvents.forEach((queueEvents) => {
            queueEvents.removeAllListeners()
        })

        //fecha as filas
        await Promise.all(Array.from(this.queues.values()).map((queue) => queue.close()))

        return true
    }
}
