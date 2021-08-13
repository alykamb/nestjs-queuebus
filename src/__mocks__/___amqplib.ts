/* eslint-disable @typescript-eslint/ban-types */
import { ConfirmChannel, ConsumeMessage, GetMessage, Replies, ServerProperties } from 'amqplib'
import { BehaviorSubject, firstValueFrom, Subject, Subscription } from 'rxjs'
import { v4 } from 'uuid'

const serverProperties: ServerProperties = {
    host: 'mock',
    product: '',
    version: '0.0.0',
    platform: 'testing',
    information: 'testing mock',
}

let queues = new Map<string, BehaviorSubject<Replies.AssertQueue>>()
let exchanges = new Map<string, BehaviorSubject<Replies.AssertExchange>>()
let queueMessages = new Map<string, Subject<ConsumeMessage>>()
let exchangeMessages = new Map<string, Subject<ConsumeMessage>>()

const init = (): void => {
    queues = new Map<string, BehaviorSubject<Replies.AssertQueue>>()
    exchanges = new Map<string, BehaviorSubject<Replies.AssertExchange>>()
    queueMessages = new Map<string, Subject<ConsumeMessage>>()
    exchangeMessages = new Map<string, Subject<ConsumeMessage>>()
}

const connections = new Set<Connection>()

export class Channel {
    private closed = false
    private subscriptions = new Subscription()
    private bindedQueues = new Map<string, Map<string, Subscription>>()
    private bindedExchanges = new Map<string, Map<string, Subscription>>()
    private consumers = new Map<string, Subscription>()
    private i = 0

    public async close(): Promise<void> {
        this.closed = true
    }

    public async assertQueue(queue: string): Promise<Replies.AssertQueue> {
        const name = queue?.length ? queue : v4()
        if (!queues.has(name)) {
            queues.set(
                name,
                new BehaviorSubject<Replies.AssertQueue>({
                    queue: name,
                    messageCount: 0,
                    consumerCount: 0,
                }),
            )
            queueMessages.set(name, new Subject())
        }

        return queues.get(name).value
    }

    public async checkQueue(queue: string): Promise<Replies.AssertQueue> {
        return queues.get(queue)?.value
    }

    public async deleteQueue(queue: string): Promise<Replies.DeleteQueue> {
        const messageCount = queues.get(queue)?.value.messageCount
        queues.delete(queue)
        return { messageCount: messageCount || 0 }
    }

    public async purgeQueue(queue: string): Promise<Replies.PurgeQueue> {
        return this.deleteQueue(queue)
    }

    public async bindQueue(queue: string, source: string): Promise<Replies.Empty> {
        const name = queue?.length ? queue : v4()
        await Promise.all([this.assertExchange(source), this.assertQueue(name)])
        const sub = exchangeMessages
            .get(source)
            .subscribe((value) => queueMessages.get(name).next(value))

        !this.bindedQueues.has(source) && this.bindedQueues.set(source, new Map())
        !this.bindedQueues.get(source).get(name) && this.bindedQueues.get(source).set(name, sub)

        this.subscriptions.add(sub)

        return {}
    }

    public async unbindQueue(queue: string, source: string): Promise<Replies.Empty> {
        this.subscriptions.remove(this.bindedQueues.get(source).get(queue))
        this.bindedQueues.get(source).get(queue).unsubscribe()

        return {}
    }

    public async assertExchange(exchange: string): Promise<Replies.AssertExchange> {
        const name = exchange?.length ? exchange : v4()
        if (!queues.has(name)) {
            exchanges.set(
                name,
                new BehaviorSubject<Replies.AssertExchange>({
                    exchange: name,
                }),
            )
            exchangeMessages.set(name, new Subject())
        }
        return exchanges.get(name).value
    }

    public async checkExchange(): Promise<Replies.Empty> {
        return {}
    }

    public async deleteExchange(exchange: string): Promise<Replies.Empty> {
        if (exchanges.has(exchange)) {
            exchanges.delete(exchange)
        }
        if (this.bindedQueues.has(exchange)) {
            this.bindedQueues.get(exchange).forEach((bindedQueue) => {
                this.subscriptions.remove(bindedQueue)
                bindedQueue.unsubscribe()
            })
        }
        if (this.bindedExchanges.has(exchange)) {
            this.bindedExchanges.get(exchange).forEach((bindedExchange) => {
                this.subscriptions.remove(bindedExchange)
                bindedExchange.unsubscribe()
            })
        }
        return {}
    }

    public async bindExchange(destination: string, source: string): Promise<Replies.Empty> {
        await Promise.all([this.assertExchange(source), this.assertQueue(destination)])
        const sub = exchangeMessages
            .get(source)
            .subscribe((value) => exchangeMessages.get(destination).next(value))

        !this.bindedExchanges.has(source) && this.bindedExchanges.set(source, new Map())
        !this.bindedExchanges.get(source).get(destination) &&
            this.bindedExchanges.get(source).set(destination, sub)

        this.subscriptions.add(sub)

        return {}
    }

    public async unbindExchange(destination: string, source: string): Promise<Replies.Empty> {
        this.subscriptions.remove(this.bindedExchanges.get(source).get(destination))
        this.bindedExchanges.get(source).get(destination).unsubscribe()

        return {}
    }

    public publish(exchange: string, _routingKey: string, content: Buffer, options: any): boolean {
        exchangeMessages.get(exchange).next({
            content,
            fields: { deliveryTag: this.i++, exchange: '', redelivered: false, routingKey: '' },
            properties: options,
        })
        return true
    }

    public sendToQueue(queue: string, content: Buffer, options): boolean {
        try {
            queueMessages.get(queue).next({
                content,
                fields: { deliveryTag: this.i++, exchange: '', redelivered: false, routingKey: '' },
                properties: options,
            })
        } catch (err) {
            console.log(queue, queueMessages)
            throw err
        }
        return true
    }

    public async consume(
        queue: string,
        onMessage: (msg: ConsumeMessage) => void,
    ): Promise<Replies.Consume> {
        const name = queue?.length ? queue : v4()
        await this.assertQueue(name)
        const sub = queueMessages.get(name).subscribe(onMessage)
        this.consumers.set(v4(), sub)
        this.subscriptions.add(sub)
        return
    }

    public async cancel(consumerTag: string): Promise<Replies.Empty> {
        this.consumers.get(consumerTag)?.unsubscribe?.()
        return {}
    }

    public async get(queue: string): Promise<false | GetMessage> {
        return firstValueFrom(queueMessages.get(queue)) as any
    }

    public ack(): void {
        //
    }

    public ackAll(): void {
        //
    }

    public nack(): void {
        //
    }

    public nackAll(): void {
        //
    }

    public reject(): void {
        //
    }

    public prefetch(): import('bluebird')<Replies.Empty> {
        throw new Error('Method not implemented.')
    }

    public recover(): import('bluebird')<Replies.Empty> {
        throw new Error('Method not implemented.')
    }

    public addListener(): this {
        throw new Error('Method not implemented.')
    }

    public on(): this {
        throw new Error('Method not implemented.')
    }

    public once(): this {
        throw new Error('Method not implemented.')
    }

    public removeListener(): this {
        throw new Error('Method not implemented.')
    }

    public off(): this {
        throw new Error('Method not implemented.')
    }

    public removeAllListeners(): this {
        throw new Error('Method not implemented.')
    }
    public setMaxListeners(): this {
        throw new Error('Method not implemented.')
    }
    public getMaxListeners(): number {
        throw new Error('Method not implemented.')
    }
    public listeners(): Function[] {
        throw new Error('Method not implemented.')
    }
    public rawListeners(): Function[] {
        throw new Error('Method not implemented.')
    }
    public emit(): boolean {
        throw new Error('Method not implemented.')
    }
    public listenerCount(): number {
        throw new Error('Method not implemented.')
    }
    public prependListener(): this {
        throw new Error('Method not implemented.')
    }
    public prependOnceListener(): this {
        throw new Error('Method not implemented.')
    }
    public eventNames(): Array<string | symbol> {
        throw new Error('Method not implemented.')
    }
}

export class Connection {
    private closed = false
    private channels = new Set<Channel>()

    public connection: { serverProperties: ServerProperties } = {
        serverProperties,
    }

    public async close(): Promise<void> {
        this.closed = true
        connections.delete(this)
        if (connections.size <= 0) {
            init()
        }
    }

    public async createChannel(): Promise<Channel> {
        const channel = new Channel()
        this.channels.add(channel)

        return channel
    }

    public createConfirmChannel(): import('bluebird')<ConfirmChannel> {
        throw new Error('Method not implemented.')
    }

    public addListener(): this {
        throw new Error('Method not implemented.')
    }

    public on(): this {
        throw new Error('Method not implemented.')
    }

    public once(): this {
        throw new Error('Method not implemented.')
    }

    public removeListener(): this {
        throw new Error('Method not implemented.')
    }

    public off(): this {
        throw new Error('Method not implemented.')
    }

    public removeAllListeners(): this {
        throw new Error('Method not implemented.')
    }

    public setMaxListeners(): this {
        throw new Error('Method not implemented.')
    }

    public getMaxListeners(): number {
        throw new Error('Method not implemented.')
    }

    public listeners(): Function[] {
        throw new Error('Method not implemented.')
    }

    public rawListeners(): Function[] {
        throw new Error('Method not implemented.')
    }

    public emit(): boolean {
        throw new Error('Method not implemented.')
    }

    public listenerCount(): number {
        throw new Error('Method not implemented.')
    }

    public prependListener(): this {
        throw new Error('Method not implemented.')
    }

    public prependOnceListener(): this {
        throw new Error('Method not implemented.')
    }

    public eventNames(): Array<string | symbol> {
        throw new Error('Method not implemented.')
    }
}

export const connect = async (): Promise<Connection> => {
    const c = new Connection()
    connections.add(c)
    return c
}

export { ConfirmChannel, ConsumeMessage, GetMessage, Replies, ServerProperties }
