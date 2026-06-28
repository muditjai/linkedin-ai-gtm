/**
 * MongoDB connection helper.
 *
 * - `connect()` is called once at startup from `src/index.ts`.
 * - `disconnect()` is registered on `SIGINT` / `SIGTERM` for graceful
 *   shutdown in the k8s pod.
 */

import mongoose from 'mongoose';
import { env } from './env.js';

let connected = false;

export async function connect(): Promise<void> {
  if (connected) return;
  // mongoose 8 uses strict by default; ensure it stays that way.
  mongoose.set('strictQuery', true);

  await mongoose.connect(env.MONGODB_URI, {
    dbName: env.MONGODB_DB_NAME,
    // Conservative pool sizing for a small k8s pod.
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 30_000,
  });

  connected = true;
  // eslint-disable-next-line no-console
  console.log(
    `[backend] Connected to MongoDB: ${env.MONGODB_URI.replace(/\/\/[^@]+@/, '//***@')} (db=${env.MONGODB_DB_NAME})`,
  );
}

export async function disconnect(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

export function isConnected(): boolean {
  return connected;
}
