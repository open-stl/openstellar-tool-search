import { parentPort } from 'node:worker_threads';
import type { Pipeline } from '@xenova/transformers';

type InferenceOpts = { pooling: string; normalize: boolean };

let extractor: Pipeline | undefined;

// Handshake: load the model on init, then signal ready/error.
parentPort!.on('message', async (message: {
  type?: string;
  id?: number;
  model?: string;
  pipelineOptions?: Record<string, unknown>;
  texts?: string | string[];
  options?: InferenceOpts;
}) => {
  // ── Handshake path: model init ────────────────────────────────────
  if (message.type === 'init') {
    try {
      const transformers = await import('@xenova/transformers');
      extractor = await transformers.pipeline(
        'feature-extraction',
        message.model!,
        message.pipelineOptions,
      ) as Pipeline;
      parentPort!.postMessage({ type: 'ready' });
    } catch (error) {
      parentPort!.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  // ── Inference path (typed envelope) ───────────────────────────────
  if (message.type === 'inference' && message.id !== undefined) {
    if (!extractor) {
      parentPort!.postMessage({ id: message.id, error: 'Model not initialized' });
      return;
    }
    try {
      const output = await (extractor as (texts: string | string[], opts: InferenceOpts) =>
        Promise<{ data: Float32Array; dims?: number[] }>)(message.texts!, message.options!);
      const data = output.data;
      if (data.buffer instanceof ArrayBuffer) {
        parentPort!.postMessage({ id: message.id, data, dims: output.dims }, [data.buffer]);
      } else {
        parentPort!.postMessage({ id: message.id, data, dims: output.dims });
      }
    } catch (error) {
      parentPort!.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  // ── Legacy inference path (flat envelope, backward compat) ────────
  if (message.id !== undefined && message.texts !== undefined) {
    if (!extractor) {
      const transformers = await import('@xenova/transformers');
      extractor = await transformers.pipeline(
        'feature-extraction',
        message.model ?? 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
        message.pipelineOptions,
      ) as Pipeline;
    }
    try {
      const output = await (extractor as (texts: string | string[], opts: InferenceOpts) =>
        Promise<{ data: Float32Array; dims?: number[] }>)(message.texts!, message.options!);
      const data = output.data;
      if (data.buffer instanceof ArrayBuffer) {
        parentPort!.postMessage({ id: message.id, data, dims: output.dims }, [data.buffer]);
      } else {
        parentPort!.postMessage({ id: message.id, data, dims: output.dims });
      }
    } catch (error) {
      parentPort!.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
});
