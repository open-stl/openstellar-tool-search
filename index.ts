import { ToolSearchPlugin } from './src/plugin.js';

export const plugin = {
  id: 'openstellar-tool-search',
  server: ToolSearchPlugin,
};

export { ToolSearchPlugin };
export default plugin;
export type { ToolMeta, ScoreParams, ToolSearchConfig, Hit } from './src/types.js';
