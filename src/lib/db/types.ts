import type pg from "pg";

export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

export interface SessionIdentity {
  userId: string;
  email: string;
}
