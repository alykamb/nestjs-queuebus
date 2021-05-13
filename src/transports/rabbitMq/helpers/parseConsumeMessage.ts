import { ConsumeMessage, Replies } from 'amqplib'

export function parseConsumeMessage<T = any>(
    callback: (error: Error, data: T, message: ConsumeMessage, queue: Replies.AssertQueue) => void,
): (message: ConsumeMessage, queue: Replies.AssertQueue) => void {
    return (message, queue): void => {
        try {
            const data = JSON.parse(message.content.toString('utf-8'))
            callback(null, data, message, queue)
        } catch (err) {
            callback(err, null, message, queue)
        }
    }
}
