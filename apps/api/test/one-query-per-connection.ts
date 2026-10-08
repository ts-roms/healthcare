import { Client } from "pg";

/**
 * Integration tests refuse a query sent to a connection that is still running another, as pg 9 will (pg 8 queues it and
 * warns). It happens when queries on a transaction or a passed-in executor run in Promise.all: run them one after the
 * other instead. Pool queries are not affected — each takes its own connection.
 */
interface ClientState {
  activeQuery?: unknown;
  _queryQueue: unknown[];
}

const prototype = Client.prototype as Client & { oneQueryAtATime?: true };
if (!prototype.oneQueryAtATime) {
  prototype.oneQueryAtATime = true;
  const query = Client.prototype.query;
  Client.prototype.query = function (this: Client & ClientState, ...args: unknown[]) {
    if (this.activeQuery || this._queryQueue.length > 0) {
      throw new Error(
        "A query was sent to a database connection still running another (pg 9 refuses this). Queries on a transaction or a passed-in executor must run one after the other, not in Promise.all.",
      );
    }
    return (query as (...a: unknown[]) => unknown).apply(this, args);
  } as typeof Client.prototype.query;
}
