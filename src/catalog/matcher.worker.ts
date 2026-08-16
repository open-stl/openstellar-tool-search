import { parentPort } from 'node:worker_threads';

type PipelineOptions = { quantized?: boolean; dtype?: string };
type InferenceOpts = { pooling: string; normalize: boolean };

type InitMessage = {
  type: 'init';
  model: string;
  pipelineOptions: PipelineOptions;
};

type InferenceMessage = {
  type: 'inference';
  id: number;
  texts: string | string[];
  options: InferenceOpts;
};

type WorkerMessage = InitMessage | InferenceMessage;

let pipelineFn: ((texts: string | string[], options: InferenceOpts) => Promise<{ data: Float32Array; dims?: number[] }>) | null = null;

if (parentPort) {
  parentPort.on('message', async (message: WorkerMessage) => {
    if (!parentPort) return;

    if (message.type === 'init') {
      try {
        const { env, pipeline } = await import('@xenova/transformers');
        (env as Record<string, unknown>).logLevel = 'error';
        if (env.backends?.onnx) {
          env.backends.onnx.logLevel = 'error';
        }

        const pipe = await pipeline(
          'feature-extraction',
          message.model,
          Object.keys(message.pipelineOptions).length > 0 ? message.pipelineOptions : undefined,
        );

        pipelineFn = pipe as unknown as typeof pipelineFn;
        parentPort.postMessage({ type: 'ready' });
      } catch (error) {
        parentPort.postMessage({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (message.type === 'inference') {
      if (!pipelineFn) {
        parentPort.postMessage({
          id: message.id,
          error: 'Worker pipeline not initialized',
        });
        return;
      }

      try {
        const result = await pipelineFn(message.texts, message.options);
        parentPort.postMessage({
          id: message.id,
          data: result.data,
          dims: result.dims,
        });
      } catch (error) {
        parentPort.postMessage({
          id: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
}

parentPort?.unref();
