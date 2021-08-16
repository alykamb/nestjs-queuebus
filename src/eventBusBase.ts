import { Inject, Injectable, OnModuleDestroy, Type } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { filter, map, noop, Observable, Subject, Subscription } from 'rxjs'

import { BusBase } from './busBase'
import { MESSAGE_BROOKER, QUEUE_CONFIG_SERVICE, QUEUE_DEFAULT_NAME } from './constants'
import {
    EFFECT_AFTER_EXECUTION_METADATA,
    EFFECT_BEFORE_EXECUTION_METADATA,
    EFFECT_INTERSEPTION_EXECUTION_METADATA,
    EFFECT_METADATA,
    EVENT_AFTER_PUBLISH_METADATA,
    EVENT_BEFORE_PUBLISH_METADATA,
    EVENT_ON_RECEIVE_METADATA,
    EVENTS_METADATA,
    NAME_QUEUE_METADATA,
} from './decorators/constants'
import { InvalidEffectException } from './exceptions'
import { compose } from './helpers/compose'
import { EventHandler, IEffect, IEvent, IEventBus } from './interfaces'
import { IEventExecutionInterceptors } from './interfaces/eventExecutionInterceptors.interface'
import { IPubEvent } from './interfaces/events/jobEvent.interface'
import { IQueueConfigService } from './interfaces/queueConfigService.interface'
import { ITransport } from './interfaces/transport.interface'
import { EffectData } from './types/effectData.type'

export type EventHandlerType<EventBase extends IEvent = IEvent> = Type<EventHandler<EventBase>>

/**
 * Registra os handlers para as implementações de eventos.
 *
 * Executa handlers somente para eventos locais.
 * Eventos da rede passam somente pelos effects
 */
@Injectable()
export class EventBusBase<EventBase extends IEvent = IEvent>
    extends BusBase<IEventExecutionInterceptors>
    implements IEventBus<EventBase>, OnModuleDestroy
{
    /**
     * Mantem referência de todas subscrições para desativá-las.
     */
    protected readonly subscriptions: Subscription[] = []
    protected readonly effects = new WeakMap<Type, WeakMap<IEffect<IEvent>, Set<string>>>()
    public name = ''
    protected readonly events$ = new Subject<IPubEvent>()

    constructor(
        protected readonly moduleRef: ModuleRef,
        @Inject(QUEUE_CONFIG_SERVICE) protected readonly queueConfig: IQueueConfigService,
        @Inject(MESSAGE_BROOKER) protected readonly transport: ITransport,
        @Inject(QUEUE_DEFAULT_NAME) name = '',
    ) {
        super(queueConfig)

        const prototype = Object.getPrototypeOf(this)

        const decoratorName =
            Reflect.getMetadata(NAME_QUEUE_METADATA, prototype.constructor) || name

        this.name = prototype.constructor.name + (decoratorName ? `_${decoratorName}` : '')

        this.transport.registerEventListener(prototype.constructor.name, (event: IPubEvent) => {
            const hooks = this.getHooks()
            if (hooks.eventOnReceive?.length) {
                void this.runHooks(hooks.eventOnReceive, {
                    name: event.name,
                    projectName: event.projectName,
                    bus: this,
                })(event).catch(noop)
            }
            this.events$.next(event)
        })
    }

    /**
     * Remove as subscriptions criadas
     */
    public onModuleDestroy(): void {
        this.subscriptions.forEach((subscription) => subscription.unsubscribe())
    }

    /**
     * Publica o evento
     *
     * Assina com o timestamp da hora que ele foi publicado, para evitar que effects iguais
     * criem comandos duplicados
     * E adiciona o nome, para que outros effects na rede possam identificar o evento.
     *
     * @param event - evento que será publicado
     */
    public publish<T extends EventBase>(event: T): void {
        const name = this.getEventName(event as any)
        const timestamp = +new Date()
        const projectName = this.queueConfig.name

        const hooks = this.getHooks()

        void compose(
            hooks.eventBeforePublish &&
                this.runHooks(hooks.eventBeforePublish, { name, projectName, bus: this }),
            (data) => {
                void this.transport.publishEvent(this.name, data).catch(noop)
                return data
            },
            hooks.eventAfterPublish &&
                this.runHooks(hooks.eventAfterPublish, { name, projectName, bus: this }),
        )({
            event,
            name,
            timestamp,
            projectName,
        })
    }

    /**
     * Registra os effects encontradas pelo decorador Effect
     *
     * @param types
     */
    public registerEffects(types: Array<Type<unknown>> = []): void {
        const effects = types
            .map((target) => {
                const metadata: EffectData[] = Reflect.getMetadata(EFFECT_METADATA, target) || []
                const instance: Type<{ [key: string]: IEffect<IPubEvent> }> = this.moduleRef.get(
                    target,
                    {
                        strict: false,
                    },
                )
                if (!instance) {
                    throw new InvalidEffectException()
                }

                return metadata
                    .filter((arg) => arg.bus === Object.getPrototypeOf(this).constructor)
                    .map((arg) => ({
                        call: instance[arg.key],
                        key: arg.key,
                        bus: arg.bus,
                        name: arg.name,
                        events: arg.events,
                        parallel: arg.parallel,
                        instance,
                    }))
            })
            .reduce((a, b) => a.concat(b), [])

        effects.forEach(
            (
                effect: {
                    call: IEffect<IPubEvent>
                    instance: Type
                    parallel: boolean
                } & EffectData,
            ) => this.registerEffect(effect),
        )
    }

    protected getHooks(): IEventExecutionInterceptors {
        return super.getHooks({
            eventOnReceive: EVENT_ON_RECEIVE_METADATA,
            eventBeforePublish: EVENT_BEFORE_PUBLISH_METADATA,
            eventAfterPublish: EVENT_AFTER_PUBLISH_METADATA,
            effectBeforeExecution: EFFECT_BEFORE_EXECUTION_METADATA,
            effectAfterExecution: EFFECT_AFTER_EXECUTION_METADATA,
            effectInterceptor: EFFECT_INTERSEPTION_EXECUTION_METADATA,
        })
    }

    public getEffectName(effect: EffectData): string {
        return `${effect.name}_${effect.key}`
    }

    public getEffectNameWithEvents(effect: EffectData): string {
        return `${this.getEffectName(effect)}_${effect.events.map((t) => t.name).join()}_${
            effect.parallel ? 'parallel' : 'unique'
        }`
    }

    public fromEvent(...events: IEvent[]): Observable<IEvent> {
        return this.events$.pipe(
            filter((pubEvent: IPubEvent) =>
                events.find(
                    (e) =>
                        pubEvent.projectName === Reflect.getMetadata(EVENTS_METADATA, e) &&
                        Object.getPrototypeOf(e).name === pubEvent.name,
                ),
            ),
            map((pubEvent) => pubEvent.data.event),
        )
    }

    /**
     * Registra os effectss
     *
     * Recebe o nome e a instância do effect. Chama a instância passando o stream de eventos
     * e executa o command resultante.
     *
     * @param effect
     */
    protected registerEffect(
        effect: { call: IEffect<IEvent>; parallel: boolean; instance: Type } & EffectData,
    ): void {
        if (typeof effect.call !== 'function') {
            throw new InvalidEffectException()
        }

        const fullEffectName = this.getEffectNameWithEvents(effect)

        if (!this.effects.has(effect.instance)) {
            this.effects.set(effect.instance, new WeakMap())
        }

        const effectRef = this.effects.get(effect.instance)

        effect.events.forEach((t) => {
            if (!effectRef.get(effect.call)) {
                effectRef.set(effect.call, new Set())
            }
            effectRef.get(effect.call).add(t.name)
        })

        //cria o nome com a combinação de events
        const context = { name: fullEffectName, projectName: this.queueConfig.name, bus: this }

        this.transport.registerEffect(
            fullEffectName,
            (data: IPubEvent): any | Promise<any> => {
                const hooks = this.getHooks()

                return compose(
                    hooks.effectBeforeExecution &&
                        this.runHooks(hooks.effectBeforeExecution, context),

                    hooks.effectInterceptor.length
                        ? this.runHooks(hooks.effectInterceptor, { ...context, data }, (d) => {
                              return new Promise((resolve, reject) => {
                                  try {
                                      return this.parseHook(effect.call(d.event))
                                          .then(resolve)
                                          .catch(reject)
                                  } catch (err) {
                                      reject(err)
                                  }
                              })
                          })
                        : // if no interceptor hooks exist, we just run the effect
                          (data): Promise<any> => this.parseHook(effect.call(data.event)),

                    hooks.effectAfterExecution &&
                        this.runHooks(hooks.effectAfterExecution, context),
                )(data).catch(noop)
            },
            effect.parallel,
            ...effect.events.map((t) => ({
                name: t.name,
                projectName: Reflect.getMetadata(EVENTS_METADATA, t),
                eventBusName: this.name,
            })),
        )
    }

    /**
     * Retorna o nome do evento através do protótipo da classe
     * @param event
     */
    protected getEventName(event: EventBase): string {
        const { constructor } = Object.getPrototypeOf(event)
        return constructor.name as string
    }
}
