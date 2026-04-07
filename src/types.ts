export interface Block {
  type: string
  attrs?: Record<string, any>
  content?: Block[] | string
}

export interface Header {
  key: string
  value: string
  enabled: boolean
}

export interface QueryParam {
  key: string
  value: string
  enabled: boolean
}

export interface RestRequest {
  protocol: 'rest'
  method: string
  url: string
  headers: Header[]
  queryParams: QueryParam[]
  body?: string
  contentType?: string
}

export interface WebSocketRequest {
  protocol: 'ws' | 'wss'
  url: string
  headers: Header[]
}

export interface GrpcRequest {
  protocol: 'grpc' | 'grpcs'
  url: string
  protoFilePath?: string
  service?: string
  method?: string
  package?: string
  callType?: string
  metadata: Record<string, string>
  body?: string
}

export type RunRequest = RestRequest | WebSocketRequest | GrpcRequest

export interface RunResult {
  protocol: string
  method?: string
  url: string
  success: boolean
  status?: number
  statusText?: string
  durationMs: number
  size?: number
  body?: string
  error?: string
  connected?: boolean
  assertions?: Array<{ passed: boolean; message: string; condition?: string; actualValue?: any; operator?: string; expectedValue?: any }>
  assertionsPassed?: number
  assertionsFailed?: number
}
