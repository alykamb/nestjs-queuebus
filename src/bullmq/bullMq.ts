import { BehaviorSubject, Subject, Subscription, merge, Observable, from, throwError } from 'rxjs'
import { CompletedEvent, FailedEvent } from '../interfaces/events/jobEvent.interface'

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
import { EXTRA_SEPARATOR, JobEventType, QUEUE_CONFIG_SERVICE } from '../constants'
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common'
import { JobException } from '../exceptions/job.exception'
import { catchError, filter, map, scan, switchMap, take, tap } from 'rxjs/operators'
import { IQueueConfigService } from '../interfaces/queueConfigService.interface'
import { Callback } from '../types/callback'

@Injectable()
export class BullMq implements OnModuleDestroy {
    /** Mantém a referência do worker para cada queue */
    private workers = new Map<string, Worker>()

    /** Mantém referências da instância da queue com seu nome */
    private queues = new Map<string, Queue>()

    /** Mantém referencia dos listeners e eventos das queues */
    private queueEvents = new Map<string, QueueEvents>()

    /** Mantém referências de streams de Jobs completados  */
    // private completedJobs = new Map<string, Subject<CompletedEvent>>()

    /** Mantém referências de streams de Jobs que falharam  */
    // private failedJobs = new Map<string, Subject<FailedEvent>>()

    // private jobs = new Map<string, Observable<FailedEvent | CompletedEvent>>()

    private numberOfActiveJobs$ = new BehaviorSubject<number>(0)
    private addJob$ = new Subject<null>()
    private removeJob$ = new Subject<null>()
    private numberOfActiveJobsSub: Subscription

    private callbacks = new Map<string, Callback>()

    /** conexão com redis */
    private redis: ConnectionOptions

    private closing = false

    constructor(@Inject(QUEUE_CONFIG_SERVICE) private readonly queueConfig: IQueueConfigService) {
        this.redis = {
            host: this.queueConfig?.host || 'localhost',
            port: this.queueConfig?.port || 6379,
        }

        this.numberOfActiveJobsSub = merge(
            this.addJob$.pipe(map(() => (s: number): number => s + 1)),
            this.removeJob$.pipe(map(() => (s: number): number => s - 1)),
        )
            .pipe(scan((state, f) => f(state), 0))
            .subscribe((n) => {
                this.numberOfActiveJobs$.next(n)
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
        //cria queue se ela ainda não existe
        if (!this.queueEvents.has(module)) {
            this.createQueue(module)
        }

        
        this.queues.get(module).add(name, data, options).then((job) => {
            this.addJob$.next()
            this.callbacks.set(job.id, onFinish)
        })
        // cria o trabalho

        //combina os streams de Jobs completos e falhos em um único stream
        

        // return from(this.queues.get(module).add(name, data, options)).pipe(
        //     tap(() => this.addJob$.next()),
        //     switchMap((job) => {
        //         return this.getJobsEvents(module).pipe(
        //             //filtra somente os com o id atual
        //             filter((j) => j.jobId === job.id),
        //             //só pega o primeiro resultado
        //             take(1),
        //             //retorna o valor se sucesso, e throw se ouver erro
        //             map((j) => {
        //                 if (j.event === JobEventType.completed) {
        //                     return (j as CompletedEvent).returnvalue
        //                 } else if (j.event === JobEventType.failed) {
        //                     let extra = {}
        //                     let message: string = (j as FailedEvent).failedReason
        //                     const extraIndex = message.indexOf(EXTRA_SEPARATOR)
        //                     if (extraIndex > -1) {
        //                         const extraJson = message.slice(extraIndex + EXTRA_SEPARATOR.length)
        //                         message = message.slice(0, extraIndex)
        //                         try {
        //                             extra = JSON.parse(extraJson)
        //                         } catch (err) {
        //                             extra = {}
        //                         }
        //                     }
        //                     throw new JobException(message, extra)
        //                 }
        //             }),
        //         )
        //     }),
        //     tap(() => this.removeJob$.next()),
        //     catchError((err) => {
        //         this.removeJob$.next()
        //         return throwError(err)
        //     }),
        // )
    }

    private endJob(j: FailedEvent | CompletedEvent, event: JobEventType): void {
        const cb = this.callbacks.get(j.jobId)
        if(!cb) {
            return
        }
        this.removeJob$.next()
        this.callbacks.delete(j.jobId)

        if (event === JobEventType.completed) {
            cb(null, (j as CompletedEvent).returnvalue)
        } else if (event === JobEventType.failed) {
            let extra = {}
            let message: string = (j as FailedEvent).failedReason
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

    // private getJobsEvents(module: string): Observable<FailedEvent | CompletedEvent> {
    //     let jobs: Observable<FailedEvent | CompletedEvent> = this.jobs.get(module)
    //     if (!jobs) {
    //         jobs = merge(this.failedJobs.get(module), this.completedJobs.get(module))
    //         this.jobs.set(module, jobs)
    //     }
    //     return jobs
    // }

    /**
     * Cria a queue e todas as referências necessárias
     * @param module
     */
    public createQueue(module: string): void {
        const queueOptions: QueueOptions = {
            connection: this.redis,
            defaultJobOptions: {
                removeOnComplete: true,
                removeOnFail: true,
            },
            ...(this.queueConfig.defaultQueueOptions || {}),
        }
        //cria a queue
        this.queues.set(module, new Queue(module, queueOptions))

        this.queueEvents.set(module, new QueueEvents(module, { connection: this.redis }))

        //ouve os eventos e popula os streams com os resultados
        this.queueEvents.get(module).on('completed', (job) => {
            this.endJob(job, JobEventType.completed)
            // this.completedJobs.get(module).next({ ...job, event: JobEventType.completed })
        })
        this.queueEvents.get(module).on('failed', (job) => {
            this.endJob(job, JobEventType.failed)
        })
    }

    /**
     * Cria o Worker responsável por processar Jobs da queue
     *
     * @param module
     * @param callback
     */
    public createWorker(module: string, callback: (job: Job) => Promise<any>): void {
        const workerOptions: WorkerOptions = {
            connection: this.redis,
            ...(this.queueConfig.defaultWorkerOptions || {}),
        }

        if (!this.queueEvents.has(module)) {
            this.createQueue(module)
        }

        this.workers.set(
            module,
            new Worker(
                module,
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
