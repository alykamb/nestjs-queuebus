import { BullMq } from './bullmq/bullMq'
import { EventBusBase } from './eventBusBase'
import { IQueueBus } from './interfaces/queues/queueBus.interface'
import { IQueueHandler } from './interfaces/queues/queueHandler.interface'
import { IExecutionOptions } from './interfaces/executionOptions.interface'
import { IImpl } from './interfaces/queues/queueImpl.interface'
import { InvalidQueueHandlerException } from './index'
import { Job } from 'bullmq'
import { ModuleRef } from '@nestjs/core'
import { Inject, Injectable, Type } from '@nestjs/common'
import {
    JOB_AFTER_EXECUTION_METADATA,
    JOB_BEFORE_EXECUTION_METADATA,
    JOB_INTERSECTION_EXECUTION_METADATA,
    NAME_QUEUE_METADATA,
    QUEUE_HANDLER_METADATA,
} from './decorators/constants'
import { QUEUE_CONFIG_SERVICE } from './constants'
import { IQueueConfigService } from './interfaces/queueConfigService.interface'
import { IJobExecutionInterceptors } from './interfaces/jobExecutionInterceptors.interface'
import { from, Observable, of } from 'rxjs'
import { mergeMap, mergeScan, scan, startWith } from 'rxjs/operators'
import { Hook } from './types/hooks.type'
import { asObservable } from './helpers/asObservable'

export type HandlerType = Type<IQueueHandler<IImpl>>

/**
 * CqrsBus registra handlers para implementações e os executa quando chamado
 */
@Injectable()
export class QueueBusBase<ImplBase = any> implements IQueueBus<ImplBase> {
    protected handlers = new Map<string, IQueueHandler<ImplBase>>()
    protected metadataName = QUEUE_HANDLER_METADATA
    protected name = ''

    constructor(
        protected readonly moduleRef: ModuleRef,
        protected bullMq: BullMq,
        @Inject(QUEUE_CONFIG_SERVICE) protected readonly queueConfig: IQueueConfigService,
    ) {
        this.name =
            Reflect.getMetadata(NAME_QUEUE_METADATA, Object.getPrototypeOf(this).constructor) || ''

        this.bullMq.createQueue(this.queueConfig.name + this.name)
        this.bullMq.createWorker(this.queueConfig.name + this.name, (job: Job) =>
            this.handleJob(job),
        )
    }

    /**
     * Executa o handler registrado para a implementação de
     * acordo com o nome da classe
     *
     * @param impl - implementação
     * @param [options] - opções para criação do command
     */
    public execute<Ret = any, T extends ImplBase = ImplBase>(
        impl: T,
        options: IExecutionOptions = {},
    ): Observable<Ret> {
        const implName = this.getConstructorName(impl as any)
        return this.executeByName(implName, impl, options)
    }

    /**
     * Executa o handler registrado para a implementação de
     * acordo com o nome
     *
     * @param name - nome do comando
     * @param data - dados que serão passados ao execute do handler
     * @param [options] - opções para criação do command
     */
    protected executeByName<Ret, T extends ImplBase = ImplBase>(
        name: string,
        data: T,
        options: IExecutionOptions = {},
    ): Observable<Ret> {
        const { moveToQueue = false, module = this.name, jobOptions } = options

        if (module === this.name && this.handlers.has(name) && !moveToQueue) {
            return this.executeHandler(name, data)
        }

        return this.bullMq.addJob(module + this.name, name, data, jobOptions)
    }

    /**
     * Usa a instância do handler com o nome do command salvá-lo como referência,
     * criar a queue do BullMq e criar o worker que vai executar o handler caso
     * o command venha pelo redis no BullMq (provavelmente de outro serviço na rede)
     *
     * @param handler - handler que vai executar o command
     * @param name - nome do command
     */
    protected bind<T extends ImplBase>(handler: IQueueHandler<T>, name: string): void {
        this.handlers.set(name, handler)
    }

    /**
     * Registra todos os handlers criados com o @decorator CommandHandler
     *
     * @param handlers - Lista de handlers
     */
    public register(handlers: HandlerType[] = []): void {
        handlers.forEach((handler) => this.registerHandler(handler))
    }

    /**
     * Faz a execução do trabalho com o handler registrado
     *
     * @param job - trabalho do bullMq
     */
    public handleJob(job: Job): Promise<any> {
        return this.executeHandler(job.name, job.data).toPromise()
    }

    protected executeHandler(name: string, data: any): Observable<any> {
        if (!this.handlers.has(name)) {
            throw new InvalidQueueHandlerException(name)
        }

        const handler: IQueueHandler<ImplBase, any> & {
            eventBus?: EventBusBase
        } = this.handlers.get(name)

        const hooks = this.getHooks()

        console.log(hooks)

        // return asObservable(handler.execute(data))
        return of(data).pipe(
            mergeMap(this.runHooks(hooks.before, handler)),
            mergeMap((data) => 
                hooks.interceptor.length 
                ? this.runHooks(hooks.interceptor, handler, (d => asObservable(handler.execute(d))))(data)
                : asObservable(handler.execute(data))
            ),
            mergeMap(this.runHooks(hooks.after, handler)),
        )
    }

    protected runHooks(
        hooks: Hook[],
        handler, 
        cb?: (d: any) =>  any | Observable<any> | Promise<any>,
    ): (data: any) => Observable<any> {
        return (data: any): Observable<any> =>
            from(hooks).pipe(
                mergeScan((value, func) => asObservable(func(value, handler, cb)), data),
            )
    }

    protected getHooks(): IJobExecutionInterceptors {
        const constructor = Reflect.getPrototypeOf(this).constructor
        const map = (property: string) => this.queueConfig[property]
        return {
            before: (Reflect.getMetadata(JOB_BEFORE_EXECUTION_METADATA, constructor) || []).map(map),
            after: (Reflect.getMetadata(JOB_AFTER_EXECUTION_METADATA, constructor) || []).map(map),
            interceptor: (Reflect.getMetadata(JOB_INTERSECTION_EXECUTION_METADATA, constructor) || []).map(map),
        }
    }

    /**
     * Registra o handler
     *
     * Pega a instância da classe através do ModuleRef do nest,
     * depois o nome do command através do metadado criado pelo @decorator CommandHandler
     * e passa os dois para o @function bind
     *
     * @param handler - handler decorado com CommandHandler
     */
    protected registerHandler(handler: HandlerType): void {
        const instancia = this.moduleRef.get(handler, { strict: false })
        if (!instancia) {
            return
        }
        const target = this.reflectMetadataName(handler)
        if (!target) {
            throw new InvalidQueueHandlerException()
        }
        this.bind(instancia as IQueueHandler<ImplBase>, target.data.name)
    }

    /**
     * Pega o nome da classe (que é uma função) através do construtor no prototype
     *
     * @param func
     */
    public getConstructorName<T = any>(func: T): string {
        const { constructor } = Object.getPrototypeOf(func)
        return constructor.name
    }

    /**
     * Retorna o nome registrado pelo metadata. ex: classe de impl de Command ou Query
     *
     * @param handler - instancia da classe handler
     */
    protected reflectMetadataName<T = any>(
        handler: T,
    ): { data: FunctionConstructor; bus: QueueBusBase } {
        return Reflect.getMetadata(this.metadataName, handler)
    }
}
