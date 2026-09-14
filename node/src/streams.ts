import { createParser, type EventSourceMessage } from "eventsource-parser";
import { ProtocolError } from "./errors.js";
import type { EventsOptions } from "./types.js";
import type { Query, Transport } from "./transport.js";

export async function* eventStream(
  transport: Transport,
  method: string,
  path: string,
  body?: unknown,
  query?: Query,
  options?: EventsOptions,
): AsyncGenerator<EventSourceMessage> {
  const { response, lifetime } = await transport.open(
    method,
    path,
    body,
    query,
    options,
    "text/event-stream",
  );
  const reader = response.body?.getReader();
  const abort = () => {
    void reader?.cancel().catch(() => {});
    lifetime.dispose();
  };
  lifetime.signal.addEventListener("abort", abort, { once: true });
  if (lifetime.signal.aborted) abort();
  try {
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream"))
      throw new ProtocolError("Expected a text/event-stream response");
    if (!reader) throw new ProtocolError("Iskra returned an empty event stream");
    const events: EventSourceMessage[] = [];
    const parser = createParser({
      onEvent(event) {
        events.push(event);
      },
    });
    const decoder = new TextDecoder();
    for (;;) {
      const chunk = await lifetime.race(reader.read());
      if (lifetime.signal.aborted) throw lifetime.signal.reason;
      if (chunk.done) {
        parser.feed(decoder.decode());
        while (events.length) yield events.shift()!;
        break;
      }
      parser.feed(decoder.decode(chunk.value, { stream: true }));
      while (events.length) {
        if (lifetime.signal.aborted) throw lifetime.signal.reason;
        yield events.shift()!;
      }
    }
  } catch (error) {
    throw lifetime.error(error);
  } finally {
    lifetime.signal.removeEventListener("abort", abort);
    lifetime.dispose();
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        /* The peer may already have closed the stream. */
      } finally {
        reader.releaseLock();
      }
    }
  }
}
export function parseEventData(data: string): unknown {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}
