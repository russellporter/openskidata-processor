import { PoolConfig } from "pg";
import { PostgresConfig } from "../Config";

export function getPostgresPoolConfig(
  database: string,
  config: PostgresConfig,
): PoolConfig {
  const poolConfig: PoolConfig = {
    host: config.host,
    port: config.port,
    database,
    user: config.user,
    max: config.maxConnections,
    idleTimeoutMillis: config.idleTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
  };

  if (config.password) {
    poolConfig.password = config.password;
  }

  return poolConfig;
}
