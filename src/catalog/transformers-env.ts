/**
 * Shared Transformers environment configuration for main thread and worker thread.
 */
export function configureTransformersEnv(env: unknown): void {
  if (!env || typeof env !== 'object') return;
  const envObj = env as Record<string, any>;
  envObj.logLevel = 'error';
  if (!envObj.backends || typeof envObj.backends !== 'object') {
    envObj.backends = {};
  }
  if (!envObj.backends.onnx || typeof envObj.backends.onnx !== 'object') {
    envObj.backends.onnx = {};
  }
  envObj.backends.onnx.logLevel = 'error';
}
