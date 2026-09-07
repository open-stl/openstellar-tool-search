export interface BaseServerConfig {
  name?: string;
  type: string;
  timeout?: number;
  defer_loading?: boolean;
}

export interface LocalMcpServerConfig extends BaseServerConfig {
  type: 'local';
  command: string[];
  env?: Record<string, string>;
  stderr?: 'inherit' | 'pipe';
}

export interface RemoteMcpServerConfig extends BaseServerConfig {
  type: 'remote';
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = LocalMcpServerConfig | RemoteMcpServerConfig;
