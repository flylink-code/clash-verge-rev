import * as yaml from 'js-yaml'
import {
  closeAllConnections,
  delayProxyByName,
  selectNodeForGroup,
} from 'tauri-plugin-mihomo-api'

import { getIpInfo } from '@/services/api'
import {
  getProxyView,
  readProfileFile,
  recordSelectedNode,
  saveProfileFile,
  updateProxyChainConfigInRuntime,
} from '@/services/cmds'
import type { ProxyViewV1 } from '@/types/proxy-view'
import { parseYamlSafe } from '@/utils/yaml'

/**
 * 链式代理静态出口节点定义
 */
export interface IChainExitNode {
  id: string
  name: string
  type: 'socks5' | 'http'
  server: string
  port: number
  username?: string
  password?: string
  dialerGroup?: string // 指定前置策略组/节点名，默认留空自动路由到当前选中入口
  udp?: boolean
  skipCertVerify?: boolean
  tls?: boolean
}

export interface IChainProxySettings {
  enabled: boolean
  selectedExitId: string | null
  exitNodes: IChainExitNode[]
}

export interface IChainProxyFormData {
  name: string
  type: 'socks5' | 'http'
  server: string
  port: number | string
  username?: string
  password?: string
  dialerProxy?: string
  udp?: boolean
  skipCertVerify?: boolean
  tls?: boolean
}

const STORAGE_KEY = 'clash-verge-chain-proxy-settings'
const CHAIN_PROXY_CHANGE_EVENT = 'clash-verge-chain-proxy-change'
const PREV_SELECTION_KEY = 'clash-verge-chain-proxy-prev-selection'
const DELAY_CHANGE_EVENT = 'clash-verge-chain-proxy-delay-change'
const IP_CHANGE_EVENT = 'clash-verge-chain-proxy-ip-change'
const SELECTED_GROUP_STORAGE_KEY = 'clash-verge-selected-proxy-group'
const PRIMARY_GROUP_KEYWORDS = [
  'auto',
  'select',
  'proxy',
  '节点选择',
  '自动选择',
]

export const CHAIN_ENTRY_GROUP_NAME = '🔗 链式入口'
export const CHAIN_EXIT_PREFIX = 'CV-EXIT-'
const LEGACY_EXIT_PREFIX = '🔒 '

const DEFAULT_SETTINGS: IChainProxySettings = {
  enabled: false,
  selectedExitId: null,
  exitNodes: [],
}

const DEFAULT_SCRIPT = `// Define main function (script entry)

function main(config, profileName) {
  return config;
}
`

export interface IStoredProxySelection {
  groupName: string
  nodeName: string
}

export interface ICurrentProxyContext {
  groupName: string
  nodeName?: string
}

export interface IExitIpData {
  ip: string
  country?: string
  country_code?: string
  city?: string
  region?: string
  organization?: string
  asn?: number
  asn_organization?: string
  lastFetchTs?: number
}

export interface IChainIpState {
  data: IExitIpData | null
  loading: boolean
  error: string | null
}

let delayStore: Record<string, number> = {}
let ipStore: IChainIpState = { data: null, loading: false, error: null }

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

let chainApplyGeneration = 0

export function invalidateChainApplyJobs(): number {
  chainApplyGeneration += 1
  return chainApplyGeneration
}

function isChainApplyCurrent(generation: number): boolean {
  return generation === chainApplyGeneration
}

export function chainExitProxyName(nodeName: string): string {
  return `${CHAIN_EXIT_PREFIX}${nodeName}`
}

export function isChainExitProxyName(name: string): boolean {
  return (
    name.startsWith(CHAIN_EXIT_PREFIX) ||
    name.startsWith(LEGACY_EXIT_PREFIX) ||
    name.startsWith('🔒')
  )
}

/**
 * Empty dialer uses the dedicated entry group. GLOBAL is mapped to the same
 * group so selecting the 🔒 exit as outbound cannot form a dialer cycle.
 */
export function resolveDialerTarget(dialerGroup?: string): string {
  const trimmed = dialerGroup?.trim()
  if (!trimmed || trimmed === 'GLOBAL') {
    return CHAIN_ENTRY_GROUP_NAME
  }
  return trimmed
}

function unwrapNonExitName(name?: string): string | undefined {
  if (!name || isChainExitProxyName(name) || name === CHAIN_ENTRY_GROUP_NAME) {
    return undefined
  }
  return name
}

function readProfileScopedGroup(profileUid?: string | null): string | null {
  if (typeof window === 'undefined') return null
  if (profileUid) {
    const scoped = localStorage.getItem(
      `${SELECTED_GROUP_STORAGE_KEY}:${profileUid}`,
    )
    if (scoped) return scoped
  }
  return localStorage.getItem(SELECTED_GROUP_STORAGE_KEY)
}

export function resolveCurrentProxyContext(
  proxyView: ProxyViewV1 | undefined,
  mode?: string,
  profileUid?: string | null,
): ICurrentProxyContext {
  const normalized = String(mode ?? 'rule').toLowerCase()
  if (!proxyView || normalized === 'direct') {
    return { groupName: 'DIRECT', nodeName: 'DIRECT' }
  }

  if (normalized === 'global') {
    const groupName = proxyView.global?.name || 'GLOBAL'
    return {
      groupName,
      nodeName: unwrapNonExitName(proxyView.global?.now),
    }
  }

  const selectable = proxyView.groups.filter(
    (group) =>
      !group.hidden && (group.type === 'Selector' || group.type === 'URLTest'),
  )
  const saved = readProfileScopedGroup(profileUid)
  const primary =
    selectable.find((group) =>
      PRIMARY_GROUP_KEYWORDS.some((keyword) =>
        group.name.toLowerCase().includes(keyword.toLowerCase()),
      ),
    ) ?? selectable[0]
  const group =
    selectable.find((item) => item.name === saved) ??
    primary ??
    proxyView.global
  return {
    groupName: group?.name || 'GLOBAL',
    nodeName: unwrapNonExitName(group?.now),
  }
}

export function resolvePreferredEntryName(
  proxyView: ProxyViewV1 | undefined,
  mode?: string,
  profileUid?: string | null,
): string | undefined {
  const current = resolveCurrentProxyContext(proxyView, mode, profileUid)
  if (current.nodeName && current.nodeName !== 'DIRECT') {
    return current.nodeName
  }
  const entryGroup = proxyView?.groups.find(
    (group) => group.name === CHAIN_ENTRY_GROUP_NAME,
  )
  const entryNow = unwrapNonExitName(entryGroup?.now)
  if (entryNow) return entryNow
  return getStoredPrevSelection()?.nodeName
}

export function getStoredPrevSelection(): IStoredProxySelection | null {
  try {
    const raw = localStorage.getItem(PREV_SELECTION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as IStoredProxySelection
    if (parsed?.groupName && parsed?.nodeName) return parsed
    return null
  } catch {
    return null
  }
}

export function savePrevSelection(selection: IStoredProxySelection): void {
  try {
    localStorage.setItem(PREV_SELECTION_KEY, JSON.stringify(selection))
  } catch (err) {
    console.warn('[ChainProxy] Failed to save previous selection:', err)
  }
}

export function clearPrevSelection(): void {
  try {
    localStorage.removeItem(PREV_SELECTION_KEY)
  } catch {
    // ignore
  }
}

export function getChainDelayResults(): Record<string, number> {
  return delayStore
}

export function setChainDelayResult(id: string, delay: number): void {
  delayStore = { ...delayStore, [id]: delay }
  window.dispatchEvent(
    new CustomEvent(DELAY_CHANGE_EVENT, { detail: delayStore }),
  )
}

export function subscribeChainDelayResults(
  callback: (results: Record<string, number>) => void,
): () => void {
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<Record<string, number>>
    callback(customEvent.detail || delayStore)
  }
  window.addEventListener(DELAY_CHANGE_EVENT, handler)
  return () => window.removeEventListener(DELAY_CHANGE_EVENT, handler)
}

export function getChainIpState(): IChainIpState {
  return ipStore
}

export function setChainIpState(next: IChainIpState): void {
  ipStore = next
  window.dispatchEvent(new CustomEvent(IP_CHANGE_EVENT, { detail: ipStore }))
}

export function subscribeChainIpState(
  callback: (state: IChainIpState) => void,
): () => void {
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<IChainIpState>
    callback(customEvent.detail || ipStore)
  }
  window.addEventListener(IP_CHANGE_EVENT, handler)
  return () => window.removeEventListener(IP_CHANGE_EVENT, handler)
}

export function proxyViewHasName(view: ProxyViewV1, name: string): boolean {
  if (Object.values(view.records).some((record) => record.name === name)) {
    return true
  }
  if (view.groups.some((group) => group.name === name)) return true
  return view.global?.name === name
}

export async function waitForProxyInCore(
  proxyName: string,
  timeoutMs = 8000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const view = await getProxyView()
      if (proxyViewHasName(view, proxyName)) return true
    } catch (err) {
      console.warn('[ChainProxy] waitForProxyInCore lookup failed:', err)
    }
    await sleep(250)
  }
  return false
}

async function selectAndRecord(
  groupName: string,
  proxyName: string,
): Promise<void> {
  await selectNodeForGroup(groupName, proxyName)
  await recordSelectedNode(groupName, proxyName).catch((err) => {
    console.warn(
      `[ChainProxy] recordSelectedNode failed for ${groupName} -> ${proxyName}:`,
      err,
    )
  })
}

export async function applyEntryHop(options: {
  exitNode: IChainExitNode
  entryName: string
  targetGroupNames: string[]
  generation?: number
}): Promise<void> {
  const { exitNode, entryName, targetGroupNames } = options
  const generation = options.generation ?? chainApplyGeneration
  const exitName = chainExitProxyName(exitNode.name)
  if (!isChainApplyCurrent(generation)) return

  if (entryName && entryName !== 'DIRECT') {
    await updateProxyChainConfigInRuntime([entryName, exitName]).catch(
      (err) => {
        console.warn('[ChainProxy] Failed to apply runtime dialer chain:', err)
      },
    )
    if (!isChainApplyCurrent(generation)) return
    try {
      await selectAndRecord(CHAIN_ENTRY_GROUP_NAME, entryName)
    } catch (err) {
      console.warn('[ChainProxy] Failed to select preferred entry hop:', err)
    }
  }

  if (!isChainApplyCurrent(generation)) return
  const uniqueGroups = [...new Set(targetGroupNames)].filter(
    (name) => name && name !== 'DIRECT' && name !== CHAIN_ENTRY_GROUP_NAME,
  )
  for (const groupName of uniqueGroups) {
    if (!isChainApplyCurrent(generation)) return
    try {
      await selectAndRecord(groupName, exitName)
    } catch (err) {
      console.warn(
        `[ChainProxy] Failed to select ${exitName} in ${groupName}:`,
        err,
      )
    }
  }
  if (!isChainApplyCurrent(generation)) return
  await closeAllConnections().catch(() => {})
}

export async function activateChainProxySelection(options: {
  enabled: boolean
  exitNode?: IChainExitNode
  preferredEntryName?: string
  targetGroupNames: string[]
  restoreSelection?: IStoredProxySelection | null
}): Promise<void> {
  const {
    enabled,
    exitNode,
    preferredEntryName,
    targetGroupNames,
    restoreSelection,
  } = options

  const generation = invalidateChainApplyJobs()

  if (enabled && exitNode) {
    const exitName = chainExitProxyName(exitNode.name)
    const ready = await waitForProxyInCore(exitName)
    if (!ready) {
      throw new Error(`Exit proxy ${exitName} is not loaded in core`)
    }
    if (!isChainApplyCurrent(generation)) return

    await applyEntryHop({
      exitNode,
      entryName: preferredEntryName || '',
      targetGroupNames,
      generation,
    })

    void (async () => {
      await sleep(800)
      if (!isChainApplyCurrent(generation)) return
      try {
        await applyEntryHop({
          exitNode,
          entryName: preferredEntryName || '',
          targetGroupNames,
          generation,
        })
      } catch {
        // restore_selected_nodes may still be settling
      }
    })()
    return
  }

  await updateProxyChainConfigInRuntime(null).catch(() => {})

  if (restoreSelection) {
    try {
      await selectAndRecord(
        restoreSelection.groupName,
        restoreSelection.nodeName,
      )
    } catch (err) {
      console.warn('[ChainProxy] Failed to restore previous selection:', err)
    }
    await closeAllConnections().catch(() => {})
  }
}

/**
 * 从本地存储读取链式代理全局设置
 */
export function getChainProxySettings(): IChainProxySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw)
    return {
      enabled: Boolean(parsed.enabled),
      selectedExitId: parsed.selectedExitId || null,
      exitNodes: Array.isArray(parsed.exitNodes) ? parsed.exitNodes : [],
    }
  } catch (err) {
    console.warn('[ChainProxy] Failed to load settings from storage:', err)
    return DEFAULT_SETTINGS
  }
}

/**
 * 保存链式代理全局设置并通知所有监听者
 */
export function saveChainProxySettings(settings: IChainProxySettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    window.dispatchEvent(
      new CustomEvent(CHAIN_PROXY_CHANGE_EVENT, { detail: settings }),
    )
  } catch (err) {
    console.error('[ChainProxy] Failed to save settings to storage:', err)
  }
}

/**
 * 订阅设置变更事件
 */
export function subscribeChainProxySettings(
  callback: (settings: IChainProxySettings) => void,
): () => void {
  const handler = (e: Event) => {
    const customEvent = e as CustomEvent<IChainProxySettings>
    callback(customEvent.detail || getChainProxySettings())
  }
  window.addEventListener(CHAIN_PROXY_CHANGE_EVENT, handler)
  return () => window.removeEventListener(CHAIN_PROXY_CHANGE_EVENT, handler)
}

/**
 * 将表单数据转换为标准 Clash/Mihomo 节点配置对象
 */
export function buildChainProxyConfig(form: IChainProxyFormData): IProxyConfig {
  const portNumber = Number(form.port)
  if (Number.isNaN(portNumber) || portNumber <= 0 || portNumber > 65535) {
    throw new Error('Invalid port: must be between 1 and 65535')
  }

  const name = form.name?.trim()
  if (!name) {
    throw new Error('Proxy name is required')
  }

  const server = form.server?.trim()
  if (!server) {
    throw new Error('Server address is required')
  }

  const proxy: Record<string, any> = {
    name,
    type: form.type,
    server,
    port: portNumber,
  }

  if (form.username && form.username.trim() !== '') {
    proxy.username = form.username.trim()
  }

  if (form.password && form.password !== '') {
    proxy.password = form.password
  }

  if (form.dialerProxy && form.dialerProxy.trim() !== '') {
    proxy['dialer-proxy'] = form.dialerProxy.trim()
  }

  if (form.type === 'socks5') {
    if (typeof form.udp === 'boolean') {
      proxy.udp = form.udp
    } else {
      proxy.udp = true
    }
  }

  if (form.tls) {
    proxy.tls = true
  }

  if (form.skipCertVerify) {
    proxy['skip-cert-verify'] = true
  }

  return proxy as IProxyConfig
}

const CHAIN_BLOCK_START = '# === CLASH_VERGE_CHAIN_PROXY_BLOCK_START ==='
const CHAIN_BLOCK_END = '# === CLASH_VERGE_CHAIN_PROXY_BLOCK_END ==='

interface ISeqMapConfig {
  prepend?: IProxyConfig[]
  append?: IProxyConfig[]
  delete?: string[]
}

/**
 * 清理可能遗留在 Merge 文件中的脏数据
 */
async function cleanLegacyMergeBlock(): Promise<void> {
  try {
    const rawMerge = (await readProfileFile('Merge').catch(() => '')) || ''
    if (
      rawMerge.includes(CHAIN_BLOCK_START) ||
      rawMerge.includes('{CHAIN_BLOCK_START}') ||
      rawMerge.includes('CLASH_VERGE_CHAIN_PROXY')
    ) {
      const lines = rawMerge.split(/\r?\n/)
      const cleanLines: string[] = []
      let insideBlock = false
      for (const line of lines) {
        if (
          line.includes(CHAIN_BLOCK_START) ||
          line.includes('{CHAIN_BLOCK_START}') ||
          line.includes('CLASH_VERGE_CHAIN_PROXY_BLOCK_START')
        ) {
          insideBlock = true
          continue
        }
        if (
          line.includes(CHAIN_BLOCK_END) ||
          line.includes('{CHAIN_BLOCK_END}') ||
          line.includes('CLASH_VERGE_CHAIN_PROXY_BLOCK_END')
        ) {
          insideBlock = false
          continue
        }
        if (!insideBlock) {
          cleanLines.push(line)
        }
      }
      const cleaned = cleanLines.join('\n').trim()
      const validCleaned = cleaned ? `${cleaned}\n` : ''
      await saveProfileFile('Merge', validCleaned).catch(() => {})
    }
  } catch (err) {
    console.warn('[ChainProxy] cleanLegacyMergeBlock ignored error:', err)
  }
}

const SCRIPT_CHAIN_BLOCK_START =
  '// === CLASH_VERGE_CHAIN_PROXY_SCRIPT_START ==='
const SCRIPT_CHAIN_BLOCK_END = '// === CLASH_VERGE_CHAIN_PROXY_SCRIPT_END ==='

/**
 * 清理 Script 中已有的链式代理注入代码块
 */
function cleanScriptChainBlock(rawScript: string): string {
  if (
    !rawScript.includes(SCRIPT_CHAIN_BLOCK_START) &&
    !rawScript.includes('CLASH_VERGE_CHAIN_PROXY_SCRIPT_START')
  ) {
    return rawScript
  }
  const lines = rawScript.split(/\r?\n/)
  const cleanLines: string[] = []
  let insideBlock = false
  for (const line of lines) {
    if (
      line.includes(SCRIPT_CHAIN_BLOCK_START) ||
      line.includes('CLASH_VERGE_CHAIN_PROXY_SCRIPT_START')
    ) {
      insideBlock = true
      continue
    }
    if (
      line.includes(SCRIPT_CHAIN_BLOCK_END) ||
      line.includes('CLASH_VERGE_CHAIN_PROXY_SCRIPT_END')
    ) {
      insideBlock = false
      continue
    }
    if (!insideBlock) {
      cleanLines.push(line)
    }
  }
  return cleanLines.join('\n').trim()
}

/**
 * 构建注入到全局 Script 中的链式代理自动化处理逻辑
 */
function generateChainProxyScript(
  exitNode: IChainExitNode,
  preferredEntryName?: string,
): string {
  const concreteDialer =
    preferredEntryName &&
    preferredEntryName !== 'DIRECT' &&
    preferredEntryName !== CHAIN_ENTRY_GROUP_NAME
      ? preferredEntryName
      : exitNode.dialerGroup?.trim() &&
          exitNode.dialerGroup.trim() !== 'GLOBAL' &&
          exitNode.dialerGroup.trim() !== CHAIN_ENTRY_GROUP_NAME
        ? exitNode.dialerGroup.trim()
        : undefined

  const exitProxyConfig: Record<string, any> = {
    name: chainExitProxyName(exitNode.name),
    type: exitNode.type,
    server: exitNode.server,
    port: exitNode.port,
  }

  if (concreteDialer) {
    exitProxyConfig['dialer-proxy'] = concreteDialer
  }

  if (exitNode.username?.trim()) {
    exitProxyConfig.username = exitNode.username.trim()
  }
  if (exitNode.password) {
    exitProxyConfig.password = exitNode.password
  }
  if (exitNode.type === 'socks5') {
    exitProxyConfig.udp = exitNode.udp !== false
  }
  if (exitNode.tls) {
    exitProxyConfig.tls = true
  }
  if (exitNode.skipCertVerify) {
    exitProxyConfig['skip-cert-verify'] = true
  }

  const exitJson = JSON.stringify(exitProxyConfig)
  const preferredEntryJson = JSON.stringify(preferredEntryName || '')
  const entryGroupJson = JSON.stringify(CHAIN_ENTRY_GROUP_NAME)
  const exitPrefixJson = JSON.stringify(CHAIN_EXIT_PREFIX)

  return `
${SCRIPT_CHAIN_BLOCK_START}
function __clashVergeChainProxyHandler(config) {
  if (!config || typeof config !== 'object') return config;
  var exitNode = ${exitJson};
  var preferredEntry = ${preferredEntryJson};
  var entryGroupName = ${entryGroupJson};
  var exitPrefix = ${exitPrefixJson};

  if (!Array.isArray(config.proxies)) {
    config.proxies = [];
  }
  config.proxies = config.proxies.filter(function(p) {
    return p && (!p.name || typeof p.name !== 'string' || (p.name.indexOf(exitPrefix) !== 0 && p.name.indexOf('🔒') !== 0));
  });

  var regularProxyNames = config.proxies.map(function(p) { return p.name; }).filter(Boolean);

  if (!Array.isArray(config['proxy-groups'])) {
    config['proxy-groups'] = [];
  }
  config['proxy-groups'] = config['proxy-groups'].filter(function(g) {
    return g && g.name !== entryGroupName;
  });

  var entryProxies = regularProxyNames.length > 0 ? regularProxyNames.slice() : ['DIRECT'];
  if (preferredEntry && preferredEntry !== exitNode.name && preferredEntry !== entryGroupName) {
    entryProxies = [preferredEntry].concat(
      entryProxies.filter(function(n) { return n !== preferredEntry; })
    );
  }
  var entryGroup = {
    name: entryGroupName,
    type: 'select',
    proxies: entryProxies
  };
  if (preferredEntry && entryProxies.indexOf(preferredEntry) >= 0) {
    entryGroup.now = preferredEntry;
  }
  config['proxy-groups'].push(entryGroup);

  config.proxies.unshift(exitNode);

  var exitName = exitNode.name;
  var dialerTarget = exitNode['dialer-proxy'];
  for (var i = 0; i < config['proxy-groups'].length; i++) {
    var grp = config['proxy-groups'][i];
    if (
      grp &&
      grp.name !== entryGroupName &&
      grp.name !== dialerTarget &&
      Array.isArray(grp.proxies)
    ) {
      grp.proxies = grp.proxies.filter(function(n) { return n !== exitName; });
      grp.proxies.unshift(exitName);
    }
  }

  return config;
}

if (typeof main === 'function') {
  var __verge_prev_main = main;
  main = function(config, profileName) {
    var res = __verge_prev_main(config, profileName);
    return __clashVergeChainProxyHandler(res || config);
  };
} else {
  function main(config, profileName) {
    return __clashVergeChainProxyHandler(config);
  }
}
${SCRIPT_CHAIN_BLOCK_END}
`.trim()
}

/**
 * 将当前选中的静态出口节点与全局 Script 和 Proxies 进行双向同步
 * 当开启时：在 Script 中注入前置入口组并重定向所有流量出站到静态出口
 * 当关闭时：安全清除 Script 和 Proxies 中的链式代理代码
 */
async function saveProfileOrThrow(
  index: string,
  content: string,
): Promise<void> {
  const saved = await saveProfileFile(index, content)
  if (!saved) {
    throw new Error(`Failed to save ${index} profile`)
  }
}

export async function syncChainProxyToMerge(
  settings?: IChainProxySettings,
  preferredEntryName?: string,
): Promise<boolean> {
  const currentSettings = settings || getChainProxySettings()
  const { enabled, selectedExitId, exitNodes } = currentSettings

  try {
    await cleanLegacyMergeBlock()

    const rawProxies = (await readProfileFile('Proxies').catch(() => '')) || ''
    let seqMap = (parseYamlSafe(rawProxies) || {}) as Record<string, any>
    if (
      typeof seqMap !== 'object' ||
      seqMap === null ||
      Array.isArray(seqMap)
    ) {
      seqMap = {}
    }
    const existingPrepend: any[] = Array.isArray(seqMap.prepend)
      ? seqMap.prepend
      : []
    const cleanPrepend = existingPrepend.filter(
      (p) => p && typeof p.name === 'string' && !isChainExitProxyName(p.name),
    )
    const updatedSeqMap: ISeqMapConfig = {
      prepend: cleanPrepend,
      append: Array.isArray(seqMap.append) ? seqMap.append : [],
      delete: Array.isArray(seqMap.delete) ? seqMap.delete : [],
    }
    try {
      await saveProfileOrThrow(
        'Proxies',
        yaml.dump(updatedSeqMap, { forceQuotes: true }),
      )
    } catch (err) {
      console.warn('[ChainProxy] Failed to clean Proxies seq file:', err)
    }

    const rawScript =
      (await readProfileFile('Script').catch(() => '')) || DEFAULT_SCRIPT
    const cleanScript = cleanScriptChainBlock(rawScript)
    const scriptToSave = (cleanScript || DEFAULT_SCRIPT).endsWith('\n')
      ? cleanScript || DEFAULT_SCRIPT
      : `${cleanScript || DEFAULT_SCRIPT}\n`

    if (!enabled || !selectedExitId) {
      await saveProfileOrThrow('Script', scriptToSave)
      return true
    }

    const exitNode = exitNodes.find((n) => n.id === selectedExitId)
    if (!exitNode) {
      await saveProfileOrThrow('Script', scriptToSave)
      return true
    }

    const scriptBlock = generateChainProxyScript(exitNode, preferredEntryName)
    const finalScript = cleanScript
      ? `${cleanScript}\n\n${scriptBlock}\n`
      : `${scriptBlock}\n`

    await saveProfileOrThrow('Script', finalScript)
    return true
  } catch (err) {
    console.error('[ChainProxy] Failed to sync chain proxy:', err)
    throw err
  }
}

/**
 * 测试链式静态出口节点的连通性与延迟 (ms)
 * @param nodeName 静态出口节点名称
 * @param testUrl 测试 URL，默认使用 cloudflare 204
 * @param timeout 超时时间 (毫秒)，默认 10000ms
 */
export async function testChainProxyDelay(
  nodeName: string,
  testUrl = 'http://cp.cloudflare.com/generate_204',
  timeout = 10000,
): Promise<number> {
  const proxyName = chainExitProxyName(nodeName)
  const exists = await waitForProxyInCore(proxyName, 5000)
  if (!exists) {
    throw new Error(`Exit proxy ${proxyName} is not loaded in core`)
  }
  try {
    const res = await delayProxyByName(proxyName, testUrl, timeout)
    return typeof res?.delay === 'number' && res.delay > 0 ? res.delay : 1e6
  } catch (err) {
    console.warn(`[ChainProxy] Test delay failed for ${proxyName}:`, err)
    return 1e6
  }
}

/**
 * 获取当前出口的实际 IP 与地理位置信息
 */
export async function fetchCurrentExitIp() {
  return await getIpInfo()
}

/**
 * 根据国家代码获取对应的国旗 Emoji
 */
export function getCountryFlagEmoji(countryCode?: string): string {
  if (!countryCode) return '🌐'
  try {
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map((char) => 127397 + char.charCodeAt(0))
    return String.fromCodePoint(...codePoints)
  } catch {
    return '🌐'
  }
}

/**
 * 格式化延迟颜色
 */
export function getDelayColor(
  delay?: number,
): 'success' | 'warning' | 'error' | 'default' {
  if (delay === undefined || delay === -1) return 'default'
  if (delay === -2) return 'default' // 测试中
  if (delay >= 1e6 || delay === 0) return 'error'
  if (delay >= 400) return 'warning'
  return 'success'
}

/**
 * 格式化延迟文字
 */
export function formatDelayText(delay?: number): string {
  if (delay === undefined || delay === -1) return '未测试'
  if (delay === -2) return '测试中...'
  if (delay >= 1e6 || delay === 0) return '超时 / 失败'
  return `${delay} ms`
}
