import { MongoClient, type Db } from "mongodb";
import { getFrontendConfig } from "./config";

let clientPromise: Promise<MongoClient> | null = null;

export async function getDb(): Promise<Db> {
  const config = getFrontendConfig();
  if (!clientPromise) {
    const client = new MongoClient(config.mongoUri);
    clientPromise = client.connect().then(async connected => {
      const db = connected.db(config.mongoDb);
      await ensureIndexes(db);
      return connected;
    });
  }

  const client = await clientPromise;
  return client.db(config.mongoDb);
}

async function ensureIndexes(db: Db) {
  await Promise.all([
    db.collection("history").createIndex({ server: 1, timestamp: -1 }),
    db.collection("logs").createIndex({ server: 1, timestamp: -1 }),
    db.collection("logs").createIndex({ uuid: 1, timestamp: -1 }),
    db.collection("frontend_auth_users").createIndex({ username: 1 }, { unique: true })
  ]);
}
