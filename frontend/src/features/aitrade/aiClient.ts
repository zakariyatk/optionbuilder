import { api, ApiError } from '../../api/client';
import type { AiAnalysis } from '../../api/types';
import type { AiResult, AiSource } from './aiBrief';

/** ai-helper/server.mjs on this PC: Claude through your own `ant auth login`. */
export const LOCAL_HELPER = 'http://127.0.0.1:8787';

export interface AnalyseRequest {
  symbol: string;
  tf: string;
  brief: string;
}

/** Whether the PC helper is running (checked quietly; it is often off). */
export async function localHelperUp(): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_HELPER}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function analyseLocal(body: AnalyseRequest): Promise<AiAnalysis> {
  let res: Response;
  try {
    res = await fetch(`${LOCAL_HELPER}/analyse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('The AI helper is not running on this PC. Open the ai-helper folder and run "npm start", then try again.');
  }
  const json = (await res.json().catch(() => null)) as (AiAnalysis & { error?: string }) | null;
  if (!res.ok || !json?.signal) throw new Error(json?.error ?? `AI helper error (${res.status})`);
  return json;
}

/** Plain words for the server's AI errors. */
function serverMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'AI_NOT_CONFIGURED') return 'The server has no Claude API key yet. Add anthropic_api_key to the server config, or switch to "This PC".';
    if (e.status === 429) return e.code ?? "Today's AI limit is used up.";
    return e.detail ? `${e.code}: ${e.detail}` : (e.code ?? e.message);
  }
  return e instanceof Error ? e.message : 'Analysis failed';
}

/** One Claude analysis of the chart brief, on the server or on this PC. */
export async function analyse(source: AiSource, body: AnalyseRequest): Promise<AiResult> {
  if (source === 'local') return { ...(await analyseLocal(body)), source };
  try {
    return { ...(await api.aiAnalyse(body)), source };
  } catch (e) {
    throw new Error(serverMessage(e));
  }
}
