import { Client, cacheExchange, createClient, fetchExchange } from '@urql/core'

/**
 * Default timeout for subgraph requests in milliseconds.
 */
export const DEFAULT_SUBGRAPH_TIMEOUT = 20000

/**
 * Creates a GraphQL client for interacting with a subgraph or other GraphQL API.
 * This is the shared client factory used by all protocol adapters.
 *
 * @param url - The GraphQL endpoint URL
 * @param apiKey - Optional API key for authenticated requests (e.g., The Graph API key)
 * @param timeout - Optional custom timeout in milliseconds (default: 20000)
 * @returns Configured urql Client
 */
export function createGraphQLClient(
  url: string,
  apiKey?: string,
  timeout: number = DEFAULT_SUBGRAPH_TIMEOUT
): Client {
  return createClient({
    url,
    exchanges: [cacheExchange, fetchExchange],
    fetchOptions: {
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
      },
      signal: AbortSignal.timeout(timeout),
    },
    preferGetMethod: false,
    requestPolicy: 'network-only',
  })
}
