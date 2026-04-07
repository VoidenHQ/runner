/**
 * Builder: Block[] → RunRequest
 *
 * Walks the parsed block tree (same JSON shape as editor.getJSON().content)
 * and builds a typed request object ready for execution.
 *
 * Adapted from apps/ui/src/core/request-engine/getRequestFromJson.ts
 * - No TipTap imports, no pre/post script execution
 * - Handles REST, WebSocket (ws/wss), and gRPC (grpc/grpcs)
 */

import type { Block, Header, QueryParam, RestRequest, WebSocketRequest, GrpcRequest, RunRequest } from './types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get text content from a block's content field.
 * Handles both simplified (string) and full ProseMirror (array of text nodes) forms.
 */
function getNodeText(node: Block): string {
  if (typeof node.content === 'string') return node.content.trim()
  if (Array.isArray(node.content)) {
    const first = node.content[0]
    if (!first) return ''
    // Inflated form: { type: 'text', text: '...' }
    if ((first as any).text) return String((first as any).text).trim()
    // Nested paragraph form: { type: 'paragraph', content: [{ type: 'text', text: '...' }] }
    if (first.type === 'paragraph') return getNodeText(first)
  }
  return ''
}

/**
 * Get text from a table cell block.
 * Path: tableCell → paragraph → text
 */
function getCellText(cell: Block): string {
  if (!Array.isArray(cell.content)) return ''
  const para = cell.content[0]
  if (!para) return ''
  return getNodeText(para)
}

/**
 * Find first block of a given type (shallow search in array).
 */
function findBlock(blocks: Block[], type: string): Block | undefined {
  return blocks.find(b => b.type === type)
}

/**
 * Find all blocks of a given type (shallow search).
 */
function findAllBlocks(blocks: Block[], type: string): Block[] {
  return blocks.filter(b => b.type === type)
}

/**
 * Recursively find first block of type anywhere in the tree.
 */
function findBlockDeep(blocks: Block[], type: string): Block | undefined {
  for (const b of blocks) {
    if (b.type === type) return b
    if (Array.isArray(b.content)) {
      const found = findBlockDeep(b.content, type)
      if (found) return found
    }
  }
  return undefined
}

/**
 * Parse a table node (headers-table, query-table) into key-value rows.
 * Skips disabled rows and rows with empty keys.
 */
function parseTableRows(tableBlock: Block): Array<{ key: string; value: string; enabled: boolean }> {
  if (!Array.isArray(tableBlock.content)) return []

  const rows: Array<{ key: string; value: string; enabled: boolean }> = []

  for (const row of tableBlock.content) {
    if (row.type !== 'tableRow') continue
    if (row.attrs?.disabled) continue

    const cells = Array.isArray(row.content) ? row.content : []
    const keyCell = cells[0]
    const valCell = cells[1]
    // Third cell is the enabled toggle — check its attrs or text
    const enabledCell = cells[2]
    const enabledText = enabledCell ? getCellText(enabledCell).toLowerCase() : 'true'
    const enabled = enabledText !== 'false' && enabledText !== '0'

    if (!keyCell || !valCell) continue

    const key = getCellText(keyCell)
    const value = getCellText(valCell)

    if (!key) continue
    rows.push({ key, value, enabled })
  }

  return rows
}

// ---------------------------------------------------------------------------
// Protocol detection
// ---------------------------------------------------------------------------

function detectProtocol(blocks: Block[]): 'rest' | 'ws' | 'wss' | 'grpc' | 'grpcs' | 'graphql' {
  // Check for socket-request block
  const socketBlock = findBlockDeep(blocks, 'socket-request')
  if (socketBlock && Array.isArray(socketBlock.content)) {
    const smethodBlock = findBlock(socketBlock.content, 'smethod')
    if (smethodBlock) {
      const method = getNodeText(smethodBlock).toLowerCase()
      if (method === 'wss' || method === 'ws') return method
      if (method === 'grpc' || method === 'grpcs') return method
    }
  }

  // Check for GraphQL
  if (findBlockDeep(blocks, 'gqlquery')) return 'graphql'

  return 'rest'
}

// ---------------------------------------------------------------------------
// REST builder
// ---------------------------------------------------------------------------

function buildRestRequest(blocks: Block[]): RestRequest {
  // Support both 'request' (legacy) and 'api' (new) container block
  const container = findBlockDeep(blocks, 'request') || findBlockDeep(blocks, 'api')
  const content: Block[] = container && Array.isArray(container.content) ? container.content : blocks

  const methodBlock = findBlock(content, 'method')
  const urlBlock = findBlock(content, 'url')
  const headersBlock = findBlock(content, 'headers-table')
  const queryBlock = findBlock(content, 'query-table')

  const method = methodBlock ? getNodeText(methodBlock) : 'GET'
  const url = urlBlock ? getNodeText(urlBlock) : ''

  const headers: Header[] = headersBlock
    ? parseTableRows(headersBlock).map(r => ({ key: r.key, value: r.value, enabled: r.enabled }))
    : []

  const queryParams: QueryParam[] = queryBlock
    ? parseTableRows(queryBlock).map(r => ({ key: r.key, value: r.value, enabled: r.enabled }))
    : []

  // Body — check json, xml, yml body blocks
  let body: string | undefined
  let contentType: string | undefined

  const jsonBody = findBlock(content, 'json_body')
  if (jsonBody?.attrs?.body) {
    body = String(jsonBody.attrs.body)
    contentType = 'application/json'
  }

  const xmlBody = findBlock(content, 'xml_body')
  if (!body && xmlBody?.attrs?.body) {
    body = String(xmlBody.attrs.body)
    contentType = 'application/xml'
  }

  const ymlBody = findBlock(content, 'yml_body')
  if (!body && ymlBody?.attrs?.body) {
    body = String(ymlBody.attrs.body)
    contentType = 'application/x-yaml'
  }

  return { protocol: 'rest', method, url, headers, queryParams, body, contentType }
}

// ---------------------------------------------------------------------------
// WebSocket builder
// ---------------------------------------------------------------------------

function buildWebSocketRequest(blocks: Block[], protocol: 'ws' | 'wss'): WebSocketRequest {
  const socketBlock = findBlockDeep(blocks, 'socket-request')
  const content: Block[] = socketBlock && Array.isArray(socketBlock.content) ? socketBlock.content : blocks

  const surlBlock = findBlock(content, 'surl')
  const url = surlBlock ? getNodeText(surlBlock) : ''

  const headersBlock = findBlock(content, 'headers-table')
  const headers: Header[] = headersBlock
    ? parseTableRows(headersBlock).map(r => ({ key: r.key, value: r.value, enabled: r.enabled }))
    : []

  return { protocol, url, headers }
}

// ---------------------------------------------------------------------------
// gRPC builder
// ---------------------------------------------------------------------------

function buildGrpcRequest(blocks: Block[], protocol: 'grpc' | 'grpcs'): GrpcRequest {
  const socketBlock = findBlockDeep(blocks, 'socket-request')
  const content: Block[] = socketBlock && Array.isArray(socketBlock.content) ? socketBlock.content : blocks

  const surlBlock = findBlock(content, 'surl')
  const url = surlBlock ? getNodeText(surlBlock) : ''

  const protoBlock = findBlock(content, 'proto')
  const protoAttrs = protoBlock?.attrs || {}

  const headersBlock = findBlock(content, 'headers-table')
  const metadata: Record<string, string> = {}
  if (headersBlock) {
    parseTableRows(headersBlock)
      .filter(r => r.enabled && r.key)
      .forEach(r => { metadata[r.key] = r.value })
  }

  // Body for gRPC is in a json_body block (the request message)
  const jsonBody = findBlock(content, 'json_body')
  const body = jsonBody?.attrs?.body ? String(jsonBody.attrs.body) : undefined

  return {
    protocol,
    url,
    protoFilePath: protoAttrs.filePath || protoAttrs.fileName,
    service: protoAttrs.selectedService,
    method: protoAttrs.selectedMethod,
    package: protoAttrs.packageName,
    callType: protoAttrs.callType || 'unary',
    metadata,
    body,
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function buildRequest(blocks: Block[]): RunRequest | null {
  const protocol = detectProtocol(blocks)

  if (protocol === 'graphql') {
    // GraphQL is treated as REST for CLI (sends as HTTP POST)
    return buildRestRequest(blocks)
  }

  if (protocol === 'ws' || protocol === 'wss') {
    return buildWebSocketRequest(blocks, protocol)
  }

  if (protocol === 'grpc' || protocol === 'grpcs') {
    return buildGrpcRequest(blocks, protocol)
  }

  return buildRestRequest(blocks)
}
