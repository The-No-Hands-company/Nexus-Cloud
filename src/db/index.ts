import pg from "pg";

let pool: pg.Pool | null = null;

if (process.env.DATABASE_URL) {
  try {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number.parseInt(process.env.DB_POOL_MAX ?? "20"),
      min: Number.parseInt(process.env.DB_POOL_MIN ?? "2"),
      idleTimeoutMillis: Number.parseInt(process.env.DB_IDLE_TIMEOUT_MS ?? "30000"),
      connectionTimeoutMillis: Number.parseInt(process.env.DB_CONNECT_TIMEOUT_MS ?? "5000"),
      allowExitOnIdle: false,
    });

    pool.on("error", (err: Error) => {
      console.error("[db] Unexpected pool error:", err.message);
    });
  } catch {
    console.warn("[db] Failed to create pool:", err);
  }
} else {
  console.warn("[db] DATABASE_URL not set, database features disabled");
}

export type DbPool = typeof pool;

export { pool };
