import { parentPort } from 'node:worker_threads';
import type { Pipeline } from '@xenova/transformers';

type InferenceOpts = { pooling: string; normalize: boolean };

let extractor: Pipeline | undefined;

parentPort!.on('message', async (message: {
  id: number;
  model: string;
  pipelineOptions?: Record<string, unknown>;
  texts: string | string[];
  options: InferenceOpts;
}) => {
  try {
    if (!extractor) {
      const transformers = await import('@xenova/transformers');
      extractor = await transformers.pipeline('feature-extraction', message.model, message.pipelineOptions) as Pipeline;
    }
    const output = await (extractor as (texts: string | string[], opts: InferenceOpts) => Promise<{ data: Float32Array; dims?: number[] }>)(message.texts, message.options);
    const data = output.data;
    parentPort!.postMessage({ id: message.id, data, dims: output.dims }, [data.buffer as ArrayBuffer]);
  } catch (error) {
    parentPort!.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) });
  }
});
