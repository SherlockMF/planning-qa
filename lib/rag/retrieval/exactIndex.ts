import type { KnowledgeObject } from "../objects";
import type { Chunk, RetrievedChunk } from "../../types";

export interface ExactIndexEntry {
  key: string;
  normalizedKey: string;
  objectId: string;
  objectType: string;
  field: string;
  boost: number;
}

export function buildExactIndex(objects: KnowledgeObject[]): ExactIndexEntry[] {
  const entries: ExactIndexEntry[] = [];
  for (const obj of objects) {
    const add = (key: string | undefined, field: string, boost: number) => {
      if (!key || !key.trim()) return;
      entries.push({
        key,
        normalizedKey: normalizeExactKey(key),
        objectId: obj.id,
        objectType: obj.objectType,
        field,
        boost,
      });
    };

    add(obj.title, "title", 1.4);
    for (const keyword of obj.keywords ?? []) add(keyword, "keyword", 1.2);
    for (const alias of obj.aliases ?? []) add(alias, "alias", 1.5);

    switch (obj.objectType) {
      case "regulation_clause":
        add(obj.clauseNo, "clauseNo", 2.2);
        add(obj.clauseTitle, "clauseTitle", 1.6);
        for (const keyword of obj.obligationKeywords ?? []) {
          add(keyword, "obligationKeyword", 1.1);
        }
        break;
      case "structured_table":
        add(obj.tableNo, "tableNo", 2);
        add(obj.tableTitle, "tableTitle", 1.8);
        break;
      case "structured_table_row":
        add(obj.tableNo, "tableNo", 1.5);
        add(obj.tableTitle, "tableTitle", 1.3);
        add(obj.rowKey, "rowKey", 1.8);
        break;
      case "classification_code":
        add(obj.code, "code", 2.4);
        add(obj.name, "name", 2);
        add(obj.parentCode, "parentCode", 1.3);
        break;
      case "indicator_item":
        add(obj.itemName, "itemName", 2);
        add(obj.indicatorName, "indicatorName", 1.7);
        break;
      case "definition":
        add(obj.term, "term", 2.2);
        break;
      case "deliverable_requirement":
        add(obj.itemTitle, "itemTitle", 1.8);
        break;
      case "drawing_requirement":
        add(obj.drawingName, "drawingName", 1.9);
        break;
      case "checklist_item":
        add(obj.listName, "listName", 1.5);
        add(obj.itemTitle, "itemTitle", 1.8);
        break;
      default:
        break;
    }
  }

  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.normalizedKey}|${entry.objectId}|${entry.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeExactKey(key: string): string {
  return key.replace(/\s+/g, "").trim().toLowerCase();
}

export function buildExactIndexFromChunks(chunks: Chunk[]): ExactIndexEntry[] {
  const entries: ExactIndexEntry[] = [];
  for (const chunk of chunks) {
    const objectId = chunk.objectId ?? chunk.id;
    const objectType = chunk.objectType ?? chunk.chunkType;
    const add = (key: string | undefined, field: string, boost: number) => {
      if (!key || !key.trim()) return;
      entries.push({
        key,
        normalizedKey: normalizeExactKey(key),
        objectId,
        objectType,
        field,
        boost,
      });
    };

    add(chunk.clauseNo, "clauseNo", 2.2);
    add(chunk.articleNo, "articleNo", 2.0);
    add(chunk.tableId, "tableId", 1.7);
    add(chunk.tableTitle, "tableTitle", 1.5);
    add(chunk.code, "code", 2.4);
    add(chunk.parentCode, "parentCode", 1.3);
    add(chunk.itemName, "itemName", 2.0);
    add(chunk.rowKey, "rowKey", 1.8);
    for (const alias of chunk.aliases ?? []) add(alias, "alias", 1.5);
    for (const keyword of chunk.keywords ?? []) add(keyword, "keyword", 1.1);
    if (chunk.fields) {
      for (const [field, value] of Object.entries(chunk.fields)) {
        const boost = /代码|编号|名称|设施|项目|事项|图纸|成果|术语/.test(field) ? 1.7 : 1.1;
        add(value, `field.${field}`, boost);
      }
    }
  }
  return dedupeExactEntries(entries);
}

export function exactSearchChunks(chunks: Chunk[], query: string): RetrievedChunk[] {
  const normalizedQuery = normalizeExactKey(query);
  if (!normalizedQuery) return [];

  const byId = new Map(chunks.map((chunk) => [chunk.objectId ?? chunk.id, chunk]));
  const scores = new Map<string, { score: number; matched: string[] }>();

  for (const entry of buildExactIndexFromChunks(chunks)) {
    if (!isSearchableExactKey(entry.normalizedKey)) continue;
    const hit =
      normalizedQuery.includes(entry.normalizedKey) ||
      (entry.normalizedKey.length >= 4 && entry.normalizedKey.includes(normalizedQuery));
    if (!hit) continue;
    const current = scores.get(entry.objectId) ?? { score: 0, matched: [] };
    current.score += entry.boost;
    if (!current.matched.includes(entry.key)) current.matched.push(entry.key);
    scores.set(entry.objectId, current);
  }

  const max = Math.max(...[...scores.values()].map((score) => score.score), 1);
  const results: RetrievedChunk[] = [];
  for (const [objectId, score] of scores.entries()) {
    const chunk = byId.get(objectId);
    if (!chunk) continue;
    results.push({
      chunk,
      keywordScore: Math.min(1, score.score / max),
      vectorScore: 0,
      rerankScore: 0,
      source: "exact",
      matchedKeywords: score.matched,
    });
  }
  return results.sort((a, b) => b.keywordScore - a.keywordScore);
}

function dedupeExactEntries(entries: ExactIndexEntry[]): ExactIndexEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.normalizedKey}|${entry.objectId}|${entry.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isSearchableExactKey(key: string): boolean {
  if (!key) return false;
  if (/^[a-z]\d{1,6}$/i.test(key)) return true;
  if (/^\d+(?:\.\d+)*$/.test(key)) return true;
  return key.length >= 2;
}
