/**
 * OpenAI-compatible API adapter for Claude Code.
 *
 * Translates between Anthropic SDK message format (used throughout the app)
 * and the OpenAI chat-completions API format, enabling use of any
 * OpenAI-compatible provider (e.g. local Ollama, LiteLLM proxy, third-party
 * gateways such as api.chatanywhere.tech).
 *
 * Environment variables:
 *   OPENAI_API_KEY   – API key sent as `Authorization: Bearer <key>`
 *   OPENAI_BASE_URL  – Base URL of the provider, e.g. https://api.openai.com/v1
 *
 * The adapter is intentionally minimal: it handles text and tool-call
 * messages (the only ones Claude Code currently sends) and silently drops
 * Anthropic-specific features like prompt caching, extended thinking, and
 * beta headers that OpenAI-compatible endpoints do not understand.
 */

import type Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam as MessageParam,
  BetaRawMessageStreamEvent,
  BetaToolParam,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

// ---------------------------------------------------------------------------
// Minimal OpenAI wire-format types (avoids an openai npm dependency)
// ---------------------------------------------------------------------------

interface OAITextPart {
  type: 'text'
  text: string
}
interface OAIImagePart {
  type: 'image_url'
  image_url: { url: string }
}
type OAIContentPart = OAITextPart | OAIImagePart

interface OAISystemMessage {
  role: 'system'
  content: string
}
interface OAIUserMessage {
  role: 'user'
  content: string | OAIContentPart[]
}
interface OAIAssistantMessage {
  role: 'assistant'
  content?: string | null
  tool_calls?: OAIToolCall[]
}
interface OAIToolMessage {
  role: 'tool'
  tool_call_id: string
  content: string
}
type OAIMessage =
  | OAISystemMessage
  | OAIUserMessage
  | OAIAssistantMessage
  | OAIToolMessage

interface OAIToolCall {
  type: 'function'
  id: string
  function: { name: string; arguments: string }
}

interface OAITool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

interface OAIToolChoice {
  type: 'function'
  function: { name: string }
}

interface OAIRequest {
  model: string
  messages: OAIMessage[]
  max_tokens?: number
  temperature?: number
  tools?: OAITool[]
  tool_choice?: 'auto' | 'none' | 'required' | OAIToolChoice
  stream?: boolean
  stream_options?: { include_usage: boolean }
}

interface OAIUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens?: number
}

interface OAIChoice {
  index: number
  message: {
    role: string
    content: string | null
    tool_calls?: OAIToolCall[]
  }
  finish_reason: string | null
}

interface OAICompletion {
  id: string
  model: string
  choices: OAIChoice[]
  usage?: OAIUsage
}

interface OAIStreamChunk {
  id: string
  model?: string
  choices: Array<{
    index: number
    delta: {
      role?: string
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        type?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason: string | null
  }>
  usage?: OAIUsage | null
}

// ---------------------------------------------------------------------------
// Request translation: Anthropic → OpenAI
// ---------------------------------------------------------------------------

/**
 * Flatten a single Anthropic content block into OpenAI content parts.
 * Returns null for blocks that have no OpenAI equivalent (cache hints, etc.).
 */
function blockToOAIParts(block: BetaContentBlockParam): OAIContentPart | null {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text }
    case 'image': {
      const src = block.source
      if (src.type === 'base64') {
        return {
          type: 'image_url',
          image_url: {
            url: `data:${src.media_type};base64,${src.data}`,
          },
        }
      }
      if (src.type === 'url') {
        return { type: 'image_url', image_url: { url: src.url } }
      }
      return null
    }
    default:
      return null
  }
}

/**
 * Translate Anthropic-format messages (plus an optional `system` prompt) to
 * the flat OpenAI messages array.
 *
 * Complications handled here:
 * - `tool_result` blocks in user turns → separate `role:"tool"` messages
 * - `tool_use` blocks in assistant turns → `tool_calls` array
 * - Mixed text + tool content in a single Anthropic message
 */
function translateMessages(
  messages: MessageParam[],
  system: string | BetaContentBlockParam[] | undefined,
): OAIMessage[] {
  const result: OAIMessage[] = []

  if (system) {
    const text =
      typeof system === 'string'
        ? system
        : system
            .map(b => (b.type === 'text' ? b.text : ''))
            .filter(Boolean)
            .join('\n')
    if (text) {
      result.push({ role: 'system', content: text })
    }
  }

  for (const msg of messages) {
    const content = msg.content

    if (typeof content === 'string') {
      result.push({ role: msg.role as 'user' | 'assistant', content })
      continue
    }

    if (msg.role === 'assistant') {
      // Assistant messages may mix text and tool_use blocks.
      const textParts: string[] = []
      const toolCalls: OAIToolCall[] = []

      for (const block of content) {
        if (block.type === 'text') {
          textParts.push(block.text)
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            type: 'function',
            id: block.id,
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input ?? {}),
            },
          })
        }
        // Skip thinking blocks, cache_control markers, etc.
      }

      const assistantMsg: OAIAssistantMessage = {
        role: 'assistant',
        content: textParts.join('') || null,
      }
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls
      }
      result.push(assistantMsg)
      continue
    }

    // User messages may mix text, images, and tool_result blocks.
    const toolResultMessages: OAIToolMessage[] = []
    const regularParts: OAIContentPart[] = []

    for (const block of content) {
      if (block.type === 'tool_result') {
        const toolContent =
          typeof block.content === 'string'
            ? block.content
            : Array.isArray(block.content)
              ? block.content
                  .map(b => (b.type === 'text' ? b.text : ''))
                  .filter(Boolean)
                  .join('\n')
              : ''
        toolResultMessages.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: toolContent,
        })
      } else {
        const part = blockToOAIParts(block)
        if (part) regularParts.push(part)
      }
    }

    // tool_result messages must come before the next user text, since OpenAI
    // requires tool messages to appear immediately after the assistant message
    // that issued the tool calls.
    result.push(...toolResultMessages)

    if (regularParts.length > 0) {
      if (regularParts.length === 1 && regularParts[0].type === 'text') {
        result.push({ role: 'user', content: regularParts[0].text })
      } else {
        result.push({ role: 'user', content: regularParts })
      }
    }
  }

  return result
}

/**
 * Translate Anthropic tool definitions to OpenAI function-tool format.
 */
function translateTools(tools: BetaToolUnion[]): OAITool[] {
  return tools
    .filter(t => 'name' in t && 'input_schema' in t) // skip server_tool_use etc.
    .map(t => {
      const tool = t as BetaToolParam
      return {
        type: 'function' as const,
        function: {
          name: tool.name,
          ...(tool.description && { description: tool.description }),
          parameters: (tool.input_schema as Record<string, unknown>) ?? {
            type: 'object',
            properties: {},
          },
        },
      }
    })
}

/**
 * Translate Anthropic tool_choice to OpenAI tool_choice.
 */
function translateToolChoice(
  tc: unknown,
): OAIRequest['tool_choice'] | undefined {
  if (!tc || typeof tc !== 'object') return undefined
  const choice = tc as { type: string; name?: string }
  if (choice.type === 'auto') return 'auto'
  if (choice.type === 'any') return 'required'
  if (choice.type === 'tool' && choice.name) {
    return { type: 'function', function: { name: choice.name } }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Response translation: OpenAI → Anthropic
// ---------------------------------------------------------------------------

/**
 * Map an OpenAI finish_reason to an Anthropic stop_reason.
 */
function mapStopReason(
  reason: string | null | undefined,
): 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' {
  if (reason === 'tool_calls') return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  return 'end_turn'
}

/**
 * Translate a complete (non-streaming) OpenAI response to a BetaMessage.
 */
function translateCompletion(data: OAICompletion, model: string): BetaMessage {
  const choice = data.choices[0]
  const content: BetaMessage['content'] = []

  if (choice?.message?.content) {
    content.push({ type: 'text', text: choice.message.content })
  }

  for (const tc of choice?.message?.tool_calls ?? []) {
    let input: Record<string, unknown> = {}
    try {
      input = JSON.parse(tc.function.arguments || '{}')
    } catch {
      // keep empty input if arguments are malformed
    }
    content.push({
      type: 'tool_use',
      id: tc.id,
      name: tc.function.name,
      input,
    })
  }

  return {
    id: data.id,
    type: 'message',
    role: 'assistant',
    content,
    model: data.model ?? model,
    stop_reason: mapStopReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    },
  } as unknown as BetaMessage
}

// ---------------------------------------------------------------------------
// Streaming translation: OpenAI SSE → Anthropic stream events
// ---------------------------------------------------------------------------

/**
 * Parse the raw SSE body of an OpenAI streaming response, yielding each
 * JSON-decoded data line.  Skips [DONE] and empty lines.
 */
async function* parseSSE(response: Response): AsyncGenerator<OAIStreamChunk> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          yield JSON.parse(payload) as OAIStreamChunk
        } catch {
          // skip malformed lines
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Convert an OpenAI SSE stream to an async generator of
 * BetaRawMessageStreamEvent objects, following Anthropic's event protocol.
 *
 * The translation maintains a lightweight state machine:
 *   - One text block (index 0) for any streamed assistant text
 *   - One tool_use block per unique tool-call index, starting at index 1
 *     (or 0 if there is no text)
 */
async function* openAIStreamToAnthropicEvents(
  sseStream: AsyncGenerator<OAIStreamChunk>,
  requestModel: string,
  messageId: string,
): AsyncGenerator<BetaRawMessageStreamEvent> {
  let inputTokens = 0
  let outputTokens = 0
  let textBlockOpen = false
  // Map from OpenAI tool-call index → Anthropic content block index
  const toolBlockIndices = new Map<number, number>()
  // Start at 1 if there is a text block; we update when we know
  let nextBlockIdx = 0
  let finalStopReason: string | null = null
  let hasEmittedMessageStart = false

  for await (const chunk of sseStream) {
    // Some providers send usage in the first chunk with prompt_tokens
    if (chunk.usage) {
      if (chunk.usage.prompt_tokens) inputTokens = chunk.usage.prompt_tokens
      if (chunk.usage.completion_tokens)
        outputTokens = chunk.usage.completion_tokens
    }

    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta

      // Emit message_start on the very first choice delta
      if (!hasEmittedMessageStart) {
        hasEmittedMessageStart = true
        yield {
          type: 'message_start',
          message: {
            id: messageId,
            type: 'message',
            role: 'assistant',
            content: [],
            model: chunk.model ?? requestModel,
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: inputTokens,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          },
        } as unknown as BetaRawMessageStreamEvent
      }

      // --- Text content ---
      if (delta.content) {
        if (!textBlockOpen) {
          textBlockOpen = true
          // Text always lives at index 0
          yield {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          } as unknown as BetaRawMessageStreamEvent
          nextBlockIdx = 1
        }
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: delta.content },
        } as unknown as BetaRawMessageStreamEvent
      }

      // --- Tool calls ---
      for (const tc of delta.tool_calls ?? []) {
        const oaiIdx = tc.index

        // First chunk for this tool call → open a new tool_use block
        if (!toolBlockIndices.has(oaiIdx)) {
          const blockIdx = nextBlockIdx++
          toolBlockIndices.set(oaiIdx, blockIdx)

          yield {
            type: 'content_block_start',
            index: blockIdx,
            content_block: {
              type: 'tool_use',
              id: tc.id ?? `tool_${blockIdx}`,
              name: tc.function?.name ?? '',
              input: {},
            },
          } as unknown as BetaRawMessageStreamEvent
        }

        const blockIdx = toolBlockIndices.get(oaiIdx)!

        if (tc.function?.arguments) {
          yield {
            type: 'content_block_delta',
            index: blockIdx,
            delta: {
              type: 'input_json_delta',
              partial_json: tc.function.arguments,
            },
          } as unknown as BetaRawMessageStreamEvent
        }
      }

      if (choice.finish_reason) {
        finalStopReason = choice.finish_reason
      }
    }
  }

  // Ensure message_start was emitted even for empty responses
  if (!hasEmittedMessageStart) {
    yield {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: requestModel,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: inputTokens,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    } as unknown as BetaRawMessageStreamEvent
  }

  // Close text block
  if (textBlockOpen) {
    yield {
      type: 'content_block_stop',
      index: 0,
    } as unknown as BetaRawMessageStreamEvent
  }

  // Close tool blocks
  for (const [, blockIdx] of toolBlockIndices) {
    yield {
      type: 'content_block_stop',
      index: blockIdx,
    } as unknown as BetaRawMessageStreamEvent
  }

  // message_delta with final stop reason
  yield {
    type: 'message_delta',
    delta: {
      stop_reason: mapStopReason(finalStopReason),
      stop_sequence: null,
    },
    usage: { output_tokens: outputTokens },
  } as unknown as BetaRawMessageStreamEvent

  yield { type: 'message_stop' } as BetaRawMessageStreamEvent
}

// ---------------------------------------------------------------------------
// AnthropicStreamCompat: wraps the async generator as a Stream-like object
// ---------------------------------------------------------------------------

/**
 * A lightweight stand-in for the Anthropic SDK's `Stream<T>` class.
 *
 * The real `Stream` has:
 *   - `[Symbol.asyncIterator]()` – async iteration
 *   - `controller`              – an AbortController used to cancel the stream
 *
 * We expose both so that `cleanupStream()` in claude.ts works correctly.
 */
class AnthropicStreamCompat<T> {
  public readonly controller: AbortController
  private readonly gen: AsyncGenerator<T>

  constructor(gen: AsyncGenerator<T>, controller: AbortController) {
    this.gen = gen
    this.controller = controller
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this.gen
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function buildOAIRequest(params: Record<string, unknown>): OAIRequest {
  const tools =
    params.tools && Array.isArray(params.tools) && params.tools.length > 0
      ? translateTools(params.tools as BetaToolUnion[])
      : undefined

  return {
    model: String(params.model ?? ''),
    messages: translateMessages(
      (params.messages as MessageParam[]) ?? [],
      params.system as string | BetaContentBlockParam[] | undefined,
    ),
    ...(params.max_tokens != null && {
      max_tokens: params.max_tokens as number,
    }),
    ...(params.temperature != null && {
      temperature: params.temperature as number,
    }),
    ...(tools && { tools }),
    ...(params.tool_choice != null && {
      tool_choice: translateToolChoice(params.tool_choice),
    }),
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Create a duck-typed Anthropic-client object that routes requests to an
 * OpenAI-compatible endpoint.
 *
 * Only `beta.messages.create()` is implemented – that is the only method
 * that Claude Code calls on the Anthropic client at runtime.
 */
export function createOpenAICompatibleClient(
  baseURL: string,
  apiKey: string,
): Anthropic {
  const chatEndpoint = `${baseURL.replace(/\/+$/, '')}/chat/completions`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }

  function create(params: Record<string, unknown>, options?: { signal?: AbortSignal }): any {
    const { stream: wantStream = false, ...rest } = params
    const oaiRequest = buildOAIRequest(rest)

    // Streaming path --------------------------------------------------------
    if (wantStream) {
      // .withResponse() is the only way this branch is called in claude.ts.
      // We attach .withResponse to the thenable so the call chain works:
      //   await create({ ...params, stream: true }).withResponse()
      const streamingPromise = Promise.resolve() as any
      streamingPromise.withResponse = async () => {
        const ctrl = new AbortController()
        // Forward parent abort signal
        options?.signal?.addEventListener('abort', () => ctrl.abort())

        const response = await fetch(chatEndpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...oaiRequest,
            stream: true,
            stream_options: { include_usage: true },
          }),
          signal: ctrl.signal,
        })

        if (!response.ok) {
          const text = await response.text().catch(() => response.statusText)
          throw new Error(
            `OpenAI-compatible API error ${response.status}: ${text}`,
          )
        }

        const messageId = `msg_openai_${Date.now()}`
        const sseGen = parseSSE(response)
        const eventsGen = openAIStreamToAnthropicEvents(
          sseGen,
          oaiRequest.model,
          messageId,
        )
        const streamCompat = new AnthropicStreamCompat(eventsGen, ctrl)

        return {
          data: streamCompat,
          response,
          request_id: response.headers.get('x-request-id') ?? undefined,
        }
      }
      return streamingPromise
    }

    // Non-streaming path ----------------------------------------------------
    return (async () => {
      const response = await fetch(chatEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(oaiRequest),
        signal: options?.signal,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => response.statusText)
        throw new Error(
          `OpenAI-compatible API error ${response.status}: ${text}`,
        )
      }

      const data = (await response.json()) as OAICompletion
      return translateCompletion(data, oaiRequest.model)
    })()
  }

  // Return a minimal duck-typed Anthropic client
  return {
    beta: {
      messages: { create },
    },
  } as unknown as Anthropic
}
