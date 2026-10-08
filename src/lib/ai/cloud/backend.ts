import "server-only";
import type { JsonSchema, SourceFile } from "../common";

export type AudioRequest = {
  audio: SourceFile;
  /** Lingua parlata (ISO-639-1) */
  language: "it" | "en";
  /** Termini attesi (titoli dei materiali, argomento), per riconoscere meglio la terminologia */
  hint: string;
};

export type JsonRequest = {
  system?: string;
  /** Materiali allegati (testo, PDF o immagini), nell'ordine in cui vanno letti */
  sources: SourceFile[];
  prompt: string;
  schema: JsonSchema;
  schemaName: string;
  temperature: number;
  /** "low": poco ragionamento, per richieste semplici che devono essere veloci (solo sui modelli che lo supportano) */
  effort?: "low";
};

/** Un provider cloud: verifica la chiave e restituisce il testo JSON prodotto dal modello. */
export interface CloudBackend {
  verify(apiKey: string, model: string): Promise<void>;
  generateJson(apiKey: string, model: string, req: JsonRequest): Promise<string>;
  /** Trascrizione di una registrazione audio (solo i provider che accettano audio) */
  transcribe?(apiKey: string, model: string, req: AudioRequest): Promise<string>;
  /** Converte gli errori dell'SDK in messaggi comprensibili per lo studente */
  friendlyError(err: unknown, model: string): Error;
  isRetryable(err: unknown): boolean;
}

export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && /fetch failed|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(`${err.message} ${String(err.cause ?? "")}`);
}

/** Messaggi comuni per gli errori HTTP dei provider. */
export function httpErrorMessage(label: string, status: number | undefined, message: string, model: string): Error | null {
  if (status === 429) return new Error(`${label} request limit reached (quota or credit). Try again in a few minutes.`);
  if (status === 401 || status === 403) return new Error(`Your ${label} key is invalid or lacks the required permissions: update it in Settings.`);
  if (status === 402) return new Error(`Your ${label} account has no credit left.`);
  if (status === 404) return new Error(`${label} model "${model}" not found: check the model name in Settings.`);
  if (status === 413) return new Error(`The materials are too large for ${label}: select fewer or smaller files.`);
  if (status === 400) return new Error(`Request rejected by ${label}: ${message}`);
  if (status !== undefined && status >= 500) return new Error(`The ${label} service is temporarily unavailable. Try again.`);
  return null;
}
