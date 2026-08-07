import { parentPort } from 'node:worker_threads';
import type { Pipeline } from '@xenova/transformers';

type InferenceOpts = { pooling: string; normalize: boolean };

let extractor: Pipeline | undefined;

async function executeInference(id: number, texts: string | string[], options?: InferenceOpts): Promise<void> {
  try {
    const output = await (extractor as (texts: string | string[], opts?: InferenceOpts) =>
      Promise<{ data: Float32Array; dims?: number[] }>)(texts, options);
    const data = output.data;
    if (data.buffer instanceof ArrayBuffer) {
      parentPort!.postMessage({ id, data, dims: output.dims }, [data.buffer]);
    } else {
      parentPort!.postMessage({ id, data, dims: output.dims });
    }
  } catch (error) {
    parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
}

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
      const { env, pipeline } = await import('@xenova/transformers');
      (env as Record<string, unknown>).logLevel = 'error';
      if (env.backends?.onnx) {
        env.backends.onnx.logLevel = 'error';
      }
      extractor = await pipeline(
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
    await executeInference(message.id, message.texts!, message.options);
    return;
  }

  // ── Legacy inference path (flat envelope, backward compat) ────────
  if (message.id !== undefined && message.texts !== undefined) {
    if (!extractor) {
      const { env, pipeline } = await import('@xenova/transformers');
      (env as Record<string, unknown>).logLevel = 'error';
      if (env.backends?.onnx) {
        env.backends.onnx.logLevel = 'error';
      }
      extractor = await pipeline(
        'feature-extraction',
        message.model ?? 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
        message.pipelineOptions,
      ) as Pipeline;
    }
    await executeInference(message.id, message.texts, message.options);
  }
});
parentPort?.unref();
