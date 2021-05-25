import { Inject, Injectable, Type } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { Job } from 'bullmq'

import { BusBase } from './busBase'
import { MESSAGE_BROOKER, QUEUE_CONFIG_SERVICE, QUEUE_DEFAULT_NAME, TIMEOUT } from './constants'
import {
    JOB_AFTER_EXECUTION_METADATA,
    JOB_BEFORE_EXECUTION_METADATA,
    JOB_INTERSEPTION_EXECUTION_METADATA,
    NAME_QUEUE_METADATA,
    QUEUE_HANDLER_METADATA,
} from './decorators/constants'
import { EventBusBase } from './eventBusBase'
import { compose } from './helpers/compose'
import { InvalidQueueHandlerException } from './index'
import { IExecutionOptions } from './interfaces/executionOptions.interface'
import { IJobExecutionInterceptors } from './interfaces/jobExecutionInterceptors.interface'
import { IQueueConfigService } from './interfaces/queueConfigService.interface'
import { IQueueBus } from './interfaces/queues/queueBus.interface'
import { IQueueHandler } from './interfaces/queues/queueHandler.interface'
import { IImpl } from './interfaces/queues/queueImpl.interface'
import { ITransport } from './interfaces/transport.interface'

export type HandlerType = Type<IQueueHandler<IImpl>>

/**
 * CqrsBus registra handlers para implementações e os executa quando chamado
 */
@Injectable()
export class QueueBusBase<ImplBase = any>
    extends BusBase<IJobExecutionInterceptors>
    implements IQueueBus<ImplBase> {
    protected handlers = new Map<string, IQueueHandler<ImplBase>>()
    protected metadataName = QUEUE_HANDLER_METADATA
    protected timeout = TIMEOUT
    public readonly name = ''

    constructor(
        protected readonly moduleRef: ModuleRef,
        @Inject(MESSAGE_BROOKER) protected readonly messageBrooker: ITransport,
        @Inject(QUEUE_CONFIG_SERVICE) protected readonly queueConfig: IQueueConfigService,
        @Inject(QUEUE_DEFAULT_NAME) name = '',
    ) {
        super(queueConfig)

        this.name =
            Reflect.getMetadata(NAME_QUEUE_METADATA, Object.getPrototypeOf(this).constructor) ||
            name

        void this.messageBrooker.createWorker(this.queueConfig.name + this.name, (job: Job) =>
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
    ): Promise<Ret> {
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
    ): Promise<Ret> {
        const { moveToQueue = false, module = this.queueConfig.name, ...o } = options

        const run = (name: string, d: T): Promise<Ret> => {
            if (module === this.queueConfig.name && this.handlers.has(name) && !moveToQueue) {
                return this.executeHandler(name, d)
            }

            return new Promise((resolve, reject) => {
                this.messageBrooker.addJob(
                    module + this.name,
                    name,
                    d,
                    (err, data) => {
                        if (err) {
                            return reject(err)
                        }
                        return resolve(data)
                    },
                    { timeout: this.timeout, ...(o || {}) },
                )
            })
        }

        const hooks = this.getHooks()
        const context = { name, module, bus: this }

        return compose(
            hooks.before && this.runHooks(hooks.before, context),
            hooks.interceptor.length
                ? this.runHooks(hooks.interceptor, { ...context, data }, (d) => run(name, d))
                : // if no interceptor hooks exist, we just run the command
                  (data): Promise<any> => run(name, data),
            hooks.after && this.runHooks(hooks.after, context),
        )(data)
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
        return this.executeHandler(job.name, job.data)
    }

    protected executeHandler(name: string, data: any): Promise<any> {
        if (!this.handlers.has(name)) {
            throw new InvalidQueueHandlerException(name)
        }

        const handler: IQueueHandler<ImplBase, any> & {
            eventBus?: EventBusBase
        } = this.handlers.get(name)

        try {
            const result = handler.execute(data)
            if (result?.toPromise) {
                return result.toPromise()
            }
            if (!(result instanceof Promise)) {
                return Promise.resolve(result)
            }
            return result
        } catch (err) {
            return Promise.reject(err)
        }
    }

    protected getHooks(): IJobExecutionInterceptors {
        return super.getHooks({
            before: JOB_BEFORE_EXECUTION_METADATA,
            after: JOB_AFTER_EXECUTION_METADATA,
            interceptor: JOB_INTERSEPTION_EXECUTION_METADATA,
        })
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
