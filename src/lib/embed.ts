// Owner: Varun — turns text into a 384-number vector with all-MiniLM-L6-v2.
// Runs locally inside Node (Transformers.js). The model (~25 MB) downloads
// from Hugging Face on first use and is cached afterwards. No API key needed.
import { pipeline } from '@huggingface/transformers';

export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2';

type Extractor = (
  input: string | string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist: () => number[][] }>;

const globalForModel = globalThis as unknown as { extractor?: Promise<Extractor> };

function getExtractor(): Promise<Extractor> {
  if (!globalForModel.extractor) {
    globalForModel.extractor = pipeline('feature-extraction', EMBEDDING_MODEL) as unknown as Promise<Extractor>;
  }
  return globalForModel.extractor;
}

/** Embeds many texts at once. Vectors are L2-normalised, so cosine = dot product. */
export async function embedMany(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const vectors: number[][] = [];
  const batchSize = 16;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) => t.slice(0, 2000));
    const output = await extractor(batch, { pooling: 'mean', normalize: true });
    vectors.push(...output.tolist());
  }
  return vectors;
}

export async function embed(text: string): Promise<number[]> {
  const [vector] = await embedMany([text]);
  return vector;
}
