import Anthropic from '@anthropic-ai/sdk';
import type { Database } from 'better-sqlite3';
import { getMeta, setMeta } from '@fullerenes/core';

let anthropicClient: Anthropic | null = null;
let apiCallsThisSession = 0;
const MAX_API_CALLS_PER_RUN = 10;

export function initAnthropic() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    anthropicClient = new Anthropic({ apiKey });
  }
}

export async function generateProjectSummary(
  db: Database,
  language: string,
  fileCount: number,
  nodeCount: number,
  moduleCount: number,
  topFilesContext: string
): Promise<string> {
  const fallback = `A ${language} project with ${fileCount} files, ${nodeCount} functions and classes across ${moduleCount} modules.`;
  
  if (!anthropicClient || apiCallsThisSession >= MAX_API_CALLS_PER_RUN) {
    return fallback;
  }

  const cacheKey = `ai_summary_project`;
  const cached = getMeta(db, cacheKey);
  if (cached) return cached;

  try {
    apiCallsThisSession++;
    const message = await anthropicClient.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 150,
      system: 'You are an expert developer summarizing codebases. Return EXACTLY 2 sentences describing the project.',
      messages: [
        {
          role: 'user',
          content: `Write a 2-sentence high-level overview of this project. Stats: ${language}, ${fileCount} files, ${nodeCount} nodes. Key modules/exports:\n${topFilesContext}`
        }
      ]
    });

    const summary = (message.content[0] as any).text.replace(/\n+/g, ' ').trim();
    setMeta(db, cacheKey, summary);
    return summary;
  } catch (err) {
    // console.error("Anthropic error:", err); // Keep stdout clean
    return fallback;
  }
}

export async function generateModuleDescription(
  db: Database,
  fileHash: string,
  filePath: string,
  signaturesContext: string
): Promise<string> {
  if (!anthropicClient || apiCallsThisSession >= MAX_API_CALLS_PER_RUN) {
    return filePath;
  }

  const cacheKey = `ai_summary_${fileHash}`;
  const cached = getMeta(db, cacheKey);
  if (cached) return cached;

  try {
     apiCallsThisSession++;
     const message = await anthropicClient.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 100,
      system: 'Write EXACTLY 1 concise sentence describing the purpose of this file based on its functions.',
      messages: [
        {
          role: 'user',
          content: `File: ${filePath}\n\nKey functions/classes:\n${signaturesContext}`
        }
      ]
    });

    const desc = (message.content[0] as any).text.replace(/\n+/g, ' ').trim();
    setMeta(db, cacheKey, desc);
    return desc;
  } catch (err) {
    return filePath;
  }
}
