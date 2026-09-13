import { Agent, callable } from "agents";
import { GENOME_SEED, scriptByKey } from "../shared/genome";
import type { ScamFamilyKey } from "../shared/types";
import type { Env } from "./env";
import { newId } from "./utils";

export interface GenomeContribution {
  id: string;
  ts: number;
  scriptKey: string;
  stageId?: string;
  identifierTypes: string[];
  sessionId: string;
}

export interface GenomeEntry {
  key: string;
  name: string;
  summary: string;
  stageCount: number;
  paymentMethods: string[];
  stageNames: string[];
  callCount: number;
  identifierCount: number;
  lastSeen?: number;
  live: boolean;
}

export interface GenomeRecordInput {
  scriptKey: string;
  stageId?: string;
  identifiers: Array<{ type: string; value: string }>;
  sessionId: string;
}

export class GenomeAgent extends Agent<Env> {
  #initialized = false;

  async onStart(): Promise<void> {
    this.#ensureSchema();
  }

  #ensureSchema(): void {
    if (this.#initialized) return;
    this.sql`
      CREATE TABLE IF NOT EXISTS contributions (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        script_key TEXT NOT NULL,
        stage_id TEXT,
        identifier_types TEXT NOT NULL,
        session_id TEXT NOT NULL
      );
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS identifier_index (
        key TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        display TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        report_count INTEGER NOT NULL
      );
    `;
    this.#initialized = true;
  }

  @callable()
  list(): GenomeEntry[] {
    this.#ensureSchema();
    const stats = this.#stats();
    return GENOME_SEED.map((script) => {
      const stat = stats[script.key] ?? { calls: 0, identifiers: 0, lastSeen: undefined };
      return {
        key: script.key,
        name: script.name,
        summary: script.summary,
        stageCount: script.stages.length,
        paymentMethods: script.paymentMethods,
        stageNames: script.stages.map((stage) => stage.name),
        callCount: stat.calls,
        identifierCount: stat.identifiers,
        lastSeen: stat.lastSeen,
        live: stat.calls > 0
      };
    }).sort((a, b) => b.callCount - a.callCount);
  }

  @callable()
  totals(): { calls: number; identifiers: number; contributions: number } {
    this.#ensureSchema();
    const calls = [...this.sql`SELECT COUNT(*) AS n FROM contributions`] as Array<{ n: number }>;
    const identifiers = [...this.sql`SELECT COUNT(*) AS n FROM identifier_index`] as Array<{ n: number }>;
    return {
      calls: Number(calls[0]?.n ?? 0),
      identifiers: Number(identifiers[0]?.n ?? 0),
      contributions: Number(calls[0]?.n ?? 0)
    };
  }

  @callable()
  recent(limit = 12): GenomeContribution[] {
    this.#ensureSchema();
    const rows = [
      ...this.sql`SELECT * FROM contributions ORDER BY ts DESC LIMIT ${limit}`
    ] as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      ts: Number(row.ts),
      scriptKey: String(row.script_key),
      stageId: row.stage_id ? String(row.stage_id) : undefined,
      identifierTypes: safeArray(row.identifier_types),
      sessionId: String(row.session_id)
    }));
  }

  record(input: GenomeRecordInput): { callCount: number; identifierCount: number } {
    this.#ensureSchema();
    const script = scriptByKey(input.scriptKey);
    if (!script) return { callCount: 0, identifierCount: 0 };
    const contributionId = newId("g");
    this.sql`INSERT INTO contributions (id, ts, script_key, stage_id, identifier_types, session_id)
      VALUES (${contributionId}, ${Date.now()}, ${input.scriptKey}, ${input.stageId ?? null}, ${JSON.stringify(
        input.identifiers.map((i) => i.type)
      )}, ${input.sessionId})`;

    for (const identifier of input.identifiers) {
      const key = `${identifier.type}:${identifier.value}`;
      const display = identifier.type === "account" ? `${identifier.value.slice(0, 3)}****${identifier.value.slice(-3)}` : identifier.value;
      this.sql`INSERT INTO identifier_index (key, type, display, first_seen, last_seen, report_count)
        VALUES (${key}, ${identifier.type}, ${display}, ${Date.now()}, ${Date.now()}, 1)
        ON CONFLICT(key) DO UPDATE SET last_seen = excluded.last_seen, report_count = report_count + 1`;
    }

    const stats = this.#stats();
    const stat = stats[input.scriptKey];
    return { callCount: stat?.calls ?? 0, identifierCount: stat?.identifiers ?? 0 };
  }

  @callable()
  lookupIdentifier(value: string): { found: boolean; reportCount: number; display?: string } {
    this.#ensureSchema();
    const rows = [
      ...this.sql`SELECT display, report_count FROM identifier_index WHERE key LIKE ${"%" + value + "%"} OR display = ${value} LIMIT 1`
    ] as Array<{ display: string; report_count: number }>;
    if (rows.length === 0) return { found: false, reportCount: 0 };
    return { found: true, reportCount: Number(rows[0]!.report_count), display: rows[0]!.display };
  }

  #stats(): Record<string, { calls: number; identifiers: number; lastSeen?: number }> {
    const rows = [
      ...this.sql`SELECT script_key, COUNT(*) AS calls, MAX(ts) AS last_seen FROM contributions GROUP BY script_key`
    ] as Array<{ script_key: string; calls: number; last_seen: number }>;
    const result: Record<string, { calls: number; identifiers: number; lastSeen?: number }> = {};
    for (const row of rows) {
      result[String(row.script_key)] = {
        calls: Number(row.calls),
        identifiers: 0,
        lastSeen: Number(row.last_seen)
      };
    }
    return result;
  }
}

function safeArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
