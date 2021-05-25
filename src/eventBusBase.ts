import { Inject, Injectable, OnModuleDestroy, Type } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { noop, Subscription } from 'rxjs'

import { QueueBusBase } from '.'
import { BusBase } from './busBase'
import { MESSAGE_BROOKER, QUEUE_CONFIG_SERVICE } from './constants'
import {
    EFFECT_AFTER_EXECUTION_METADATA,
    EFFECT_BEFORE_EXECUTION_METADATA,
    EFFECT_INTERSEPTION_EXECUTION_METADATA,
    EFFECT_METADATA,
    EVENT_AFTER_PUBLISH_METADATA,
    EVENT_BEFORE_PUBLISH_METADATA,
    EVENT_ON_RECEIVE_METADATA,
    EVENTBUS_QUEUEBUS_METADATA,
    EVENTS_METADATA,
} from './decorators/constants'
import { InvalidEffectException } from './exceptions'
import { InvalidQueueBusForEventBusException } from './exceptions/invalidQueueBusForEventBus.exception'
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
    implements IEventBus<EventBase>, OnModuleDestroy {
    /**
     * Mantem referência de todas subscrições para desativá-las.
     */
    protected readonly subscriptions: Subscription[] = []
    protected queueBus: QueueBusBase
    constructor(
        protected readonly moduleRef: ModuleRef,
        @Inject(QUEUE_CONFIG_SERVICE) protected readonly queueConfig: IQueueConfigService,
        @Inject(MESSAGE_BROOKER) protected readonly transport: ITransport,
    ) {
        super(queueConfig)

        const prototype = Object.getPrototypeOf(this)
        const queueBus = Reflect.getMetadata(EVENTBUS_QUEUEBUS_METADATA, prototype.constructor)
        if (!queueBus) {
            throw new InvalidQueueBusForEventBusException(prototype.name)
        }
        this.queueBus = this.moduleRef.get(queueBus)

        this.transport.registerEventListener(prototype.name, (event: IPubEvent) => {
            const hooks = this.getHooks()
            if (hooks.eventOnReceive) {
                void this.runHooks(hooks.eventOnReceive, {
                    name: event.name,
                    module: event.module,
                    bus: this,
                })(event).catch(noop)
            }
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
        const module = this.queueConfig.name

        const hooks = this.getHooks()

        void compose(
            hooks.eventBeforePublish &&
                this.runHooks(hooks.eventBeforePublish, { name, module, bus: this }),
            (data) => {
                void this.transport.publishEvent(data).catch(noop)
                return data
            },
            hooks.eventAfterPublish &&
                this.runHooks(hooks.eventAfterPublish, { name, module, bus: this }),
        )({
            event,
            name,
            timestamp,
            module,
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
                const metadata = Reflect.getMetadata(EFFECT_METADATA, target) || []
                const instance: { [key: string]: IEffect<IPubEvent> } = this.moduleRef.get(target, {
                    strict: false,
                })
                if (!instance) {
                    throw new InvalidEffectException()
                }

                return metadata.data.map(
                    (arg: { key: string; events: IEvent[]; name: string }) => ({
                        call: instance[arg.key],
                        key: arg.key,
                        bus: metadata.bus,
                        name: arg.name,
                        events: arg.events,
                    }),
                )
            })
            .reduce((a, b) => a.concat(b), [])

        effects.forEach((effect: { call: IEffect<IPubEvent>; bus: QueueBusBase } & EffectData) =>
            this.registerEffect(effect),
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

    /**
     * Registra os effectss
     *
     * Recebe o nome e a instância do effect. Chama a instância passando o stream de eventos
     * e executa o command resultante.
     *
     * @param effect
     */
    protected registerEffect(
        effect: { call: IEffect<IEvent>; bus: QueueBusBase } & EffectData,
    ): void {
        if (typeof effect.call !== 'function') {
            throw new InvalidEffectException()
        }

        //cria o nome com a combinação de events
        const name = `${effect.name}_${effect.key}_${effect.events.map((t) => t.name).join()}`
        const context = { name, module, bus: this }

        this.transport.registerEffect(
            name,
            (data: IPubEvent): any | Promise<any> => {
                const hooks = this.getHooks()

                return compose(
                    hooks.effectBeforeExecution &&
                        this.runHooks(hooks.effectBeforeExecution, context),

                    hooks.effectInterceptor.length
                        ? this.runHooks(hooks.effectInterceptor, { ...context, data }, (d) => {
                              return new Promise((resolve, reject) => {
                                  try {
                                      return this.parseHook(effect.call(d?.event))
                                          .then(resolve)
                                          .catch(reject)
                                  } catch (err) {
                                      reject(err)
                                  }
                              })
                          })
                        : // if no interceptor hooks exist, we just run the effect
                          (data): Promise<any> => this.parseHook(effect.call(data?.event)),

                    hooks.effectAfterExecution &&
                        this.runHooks(hooks.effectAfterExecution, context),
                )(data).catch(noop)
            },
            ...effect.events.map((t) => ({
                name: t.name,
                module: Reflect.getMetadata(EVENTS_METADATA, t),
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
