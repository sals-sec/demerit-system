type D1Result<Row = Record<string, unknown>> = {
  results?: Row[];
};

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<Row = Record<string, unknown>>(): Promise<Row | null>;
  all<Row = Record<string, unknown>>(): Promise<D1Result<Row>>;
  run(): Promise<{ success?: boolean; meta?: { changes?: number } }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
    SALS_ADMIN_USERNAME?: string;
    SALS_ADMIN_PASSWORD?: string;
    SALS_ADMIN_NAME?: string;
    SALS_ADMIN_PASSWORD_VERSION?: string;
    SALS_ADMIN_EMAILS?: string;
    SALS_AUTHORIZED_EMAILS?: string;
    SALS_TRUST_WORKSPACE_HEADERS?: string;
  };
}

declare module "*.html?raw" {
  const html: string;
  export default html;
}
