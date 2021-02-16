import { BullMq } from './bullMq'
import { Job, Queue, QueueEvents, Worker } from 'bullmq'
import { Subject, Subscription } from 'rxjs'
import { Test } from '@nestjs/testing'
import { filter } from 'rxjs/operators'
import { QUEUE_CONFIG_SERVICE } from '../constants'
import { IQueueConfigService } from '../interfaces/queueConfigService.interface'

let id = 0
function* jobId(): Generator<number, void> {
    while (true) {
        ++id
        yield id
    }
}
const jobs$ = new Subject<any>()
const completedJobs$ = new Subject<any>()
const failedJobs$ = new Subject<any>()
const subs: Subscription[] = []
const timeout = 0

const clearSubs = (): void => subs.forEach((sub) => sub.unsubscribe())
jest.mock('bullmq', () => {
    return {
        Queue: jest.fn().mockImplementation((module: string) => {
            return {
                name: module,
                add: (name: string, data: any): Job => {
                    const id = jobId().next().value + ''
                    const job: any = {
                        data,
                        id,
                        jobId: id,
                        name,
                        module,
                    }
                    jobs$.next(job)
                    return job as Job
                },
            }
        }),
        QueueEvents: jest.fn().mockImplementation((module: string) => {
            return {
                name: module,
                on: (event: string, callback: (job: any) => void): void => {
                    if (event === 'completed') {
                        subs.push(
                            completedJobs$
                                .pipe(filter(({ module: m }) => m === module))
                                .subscribe((j) => callback(j)),
                        )
                    } else {
                        subs.push(
                            failedJobs$
                                .pipe(filter(({ module: m }) => m === module))
                                .subscribe((j) => callback(j)),
                        )
                    }
                },
            }
        }),
        Worker: jest.fn().mockImplementation((module: string, callback: (job: any) => any) => {
            subs.push(
                jobs$.pipe(filter(({ module: m }) => m === module)).subscribe((j: any) => {
                    new Promise((resolve) => {
                        setTimeout(resolve, timeout)
                    })
                        .then(() => callback(j))
                        .then((returnvalue) => {
                            completedJobs$.next({ ...j, returnvalue })
                        })
                        .catch((failedReason) => {
                            failedJobs$.next({ ...j, failedReason })
                        })
                }),
            )

            return {
                close: (): Promise<boolean> =>
                    new Promise((resolve) => setTimeout(resolve, 2000)).then(() => true),
            }
        }),
    }
})

describe('BullMq', () => {
    let bullMq: BullMq

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [
                BullMq,
                {
                    provide: QUEUE_CONFIG_SERVICE,
                    useValue: {
                        name: 'testing_bullmq',
                    } as Partial<IQueueConfigService>,
                },
            ],
        }).compile()

        bullMq = moduleRef.get<BullMq>(BullMq)
        clearSubs()
    })

    it('deve iniciar o behavior subject de trabalhos ativos com 0', () => {
        expect(bullMq['numberOfActiveJobs$'].getValue()).toBe(0)
    })

    describe('createQueue', () => {
        it('deve criar uma queue, seus listeners e streams de eventos', () => {
            bullMq.createQueue('teste')
            expect(Queue).toHaveBeenCalledTimes(1)
            expect(QueueEvents).toHaveBeenCalledTimes(1)
            expect(bullMq['completedJobs'].size).toBe(1)
            expect(bullMq['failedJobs'].size).toBe(1)
            expect(bullMq['queues'].get('teste')).toBeTruthy()
        })
    })

    describe('createWorker', () => {
        it('deve criar um worker', () => {
            bullMq.createWorker('teste', async () => true)
            expect(Worker).toHaveBeenCalledTimes(1)
            expect(bullMq['workers'].size).toBe(1)
            expect(bullMq['workers'].get('teste')).toBeTruthy()
        })
    })

    describe('addJob', () => {
        it('deve disparar exceção se o trabalho falhar', () => {
            const moduleName = 'teste'
            const jobName = 'jobName'

            const error = new Error('Job Failed')

            bullMq.createWorker(moduleName, () => {
                throw error
            })
            void expect(bullMq.addJob(moduleName, jobName, null)).rejects.toThrow()
        })

        it('deve retornar dados se o trabalho executar com sucesso', () => {
            clearSubs()
            const moduleName = 'teste'
            const jobName = 'jobName'

            const dados = { return: 1 }

            bullMq.createWorker(moduleName, async () => dados)
            void expect(bullMq.addJob(moduleName, jobName, null)).resolves.toBe(dados)
        })

        it('deve disparar erro se o módulo está fechando', () => {
            clearSubs()

            const moduleName = 'teste'
            const jobName = 'jobName'

            const dados = { return: 1 }

            bullMq.createWorker(moduleName, async () => dados)

            void expect(bullMq.addJob(moduleName, jobName, null)).resolves.toBe(dados)
            void bullMq.onModuleDestroy()
            void expect(bullMq.addJob(moduleName, jobName, null)).rejects.toThrow()
        })

        it('deve criar queue se ainda não existe', () => {
            clearSubs()

            const moduleName = 'teste'
            const jobName = 'jobName'

            const dados = { return: 1 }

            bullMq.createWorker(moduleName, async () => dados)

            void expect(bullMq.addJob(moduleName, jobName, null)).resolves.toBe(dados)
            expect(bullMq['queues'].has(moduleName)).toBeTruthy()
        })

        it('deve subir e diminuir o número de trabalhos ativos', async () => {
            clearSubs()

            const moduleName = 'teste'
            const jobName = 'jobName'

            const dados = { return: 1 }

            bullMq.createWorker(moduleName, () =>
                new Promise((resolve) => {
                    expect(bullMq['numberOfActiveJobs$'].value).toBe(1)
                    setTimeout(resolve, 2000)
                }).then(() => dados),
            )
            await bullMq.addJob(moduleName, jobName, null).toPromise()

            expect(bullMq['numberOfActiveJobs$'].value).toBe(0)
        })
    })
})
