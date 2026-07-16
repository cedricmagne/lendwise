import type { BaseChainClient, ChainConfig } from './types'

/**
 * Options for creating a chain registry.
 */
export type ChainRegistryOptions = {
  /**
   * Protocol name for error messages.
   */
  protocolName: string
}

/**
 * Chain importer function type.
 * Each protocol provides its own importer to handle dynamic imports
 * relative to their folder structure.
 */
export type ChainImporter = (clientPath: string) => Promise<unknown>

/**
 * Chain registry interface returned by createChainRegistry.
 */
export type ChainRegistry<T extends BaseChainClient> = {
  /**
   * Register a chain client. Called by each chain folder during initialization.
   */
  registerChain: (config: T) => void

  /**
   * Initialize all chain clients using the provided importer.
   * This is called lazily on first use to avoid circular dependency issues.
   *
   * @param importer - Function to dynamically import chain modules
   */
  initializeChains: (importer: ChainImporter) => Promise<void>

  /**
   * Get all registered chain clients.
   * Must call initializeChains first or provide an importer.
   */
  getChainClients: (importer?: ChainImporter) => Promise<T[]>

  /**
   * Get a specific chain client by chain ID.
   * Must call initializeChains first or provide an importer.
   */
  getChainClient: (
    chainId: number,
    importer?: ChainImporter
  ) => Promise<T | undefined>

  /**
   * Check if chains have been initialized.
   */
  isInitialized: () => boolean
}

/**
 * Creates a chain registry for managing multi-chain subgraph clients.
 *
 * This factory provides a reusable pattern for:
 * - Lazy initialization of chain clients
 * - Dynamic import of chain-specific modules
 * - Registry pattern for accessing clients by chain ID
 *
 * @param getProtocolChains - Function that returns the protocol's chain configurations
 * @param options - Registry configuration options
 * @returns Chain registry with register, get, and initialize methods
 *
 * @example
 * ```typescript
 * const registry = createChainRegistry<AaveChainClient>(
 *   () => AAVE_V3_CHAINS,
 *   { protocolName: 'Aave V3' }
 * )
 *
 * // Define importer next to the chain override dirs (see compound/v3/positions.ts)
 * const chainImporter = (path: string) => import(`./${path}`)
 *
 * // In adapter:
 * const client = await registry.getChainClient(1, chainImporter)
 * ```
 */
export function createChainRegistry<T extends BaseChainClient>(
  getProtocolChains: () => Record<string, ChainConfig>,
  options: ChainRegistryOptions
): ChainRegistry<T> {
  const { protocolName } = options

  const registry: T[] = []
  let initialized = false

  const initializeChains = async (importer: ChainImporter): Promise<void> => {
    if (initialized) return
    initialized = true

    // Get all chains from config that have a clientPath defined
    const chainsToRegister = Object.values(getProtocolChains())
      .filter((chainConfig) => chainConfig.custom?.clientPath)
      .map((chainConfig) => ({
        path: chainConfig.custom!.clientPath!,
        chainId: chainConfig.id,
        chainName: chainConfig.name,
      }))

    // Dynamically import all chain modules - they will call registerChain()
    await Promise.all(
      chainsToRegister.map(async ({ path, chainId, chainName }) => {
        try {
          await importer(path)
        } catch (error) {
          console.error(
            `[${protocolName}] Failed to initialize chain client for ${chainName} (${chainId}):`,
            error
          )
        }
      })
    )
  }

  const registerChain = (config: T): void => {
    registry.push(config)
  }

  const getChainClients = async (importer?: ChainImporter): Promise<T[]> => {
    if (importer) {
      await initializeChains(importer)
    }
    return registry
  }

  const getChainClient = async (
    chainId: number,
    importer?: ChainImporter
  ): Promise<T | undefined> => {
    const clients = await getChainClients(importer)
    return clients.find((c) => c.chainId === chainId)
  }

  const isInitialized = (): boolean => initialized

  return {
    registerChain,
    initializeChains,
    getChainClients,
    getChainClient,
    isInitialized,
  }
}
