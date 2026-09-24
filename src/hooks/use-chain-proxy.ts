import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useProfiles } from '@/hooks/use-profiles'
import { useVerge } from '@/hooks/use-verge'
import {
  useAppRefreshers,
  useClashConfigData,
  useProxiesData,
} from '@/providers/app-data-context'
import { enhanceProfilesOutcome } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import {
  type IChainExitNode,
  type IChainIpState,
  type IChainProxySettings,
  activateChainProxySelection,
  applyEntryHop,
  chainExitProxyName,
  clearPrevSelection,
  fetchCurrentExitIp,
  getChainDelayResults,
  getChainIpState,
  getChainProxySettings,
  getStoredPrevSelection,
  isChainExitProxyName,
  resolveCurrentProxyContext,
  resolvePreferredEntryName,
  saveChainProxySettings,
  savePrevSelection,
  setChainDelayResult,
  setChainIpState,
  subscribeChainDelayResults,
  subscribeChainIpState,
  subscribeChainProxySettings,
  syncChainProxyToMerge,
  testChainProxyDelay,
} from '@/utils/chain-proxy'

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

async function enhanceProfilesWithRetry(): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const outcome = await enhanceProfilesOutcome()
    if (outcome.status === 'valid') return true
    if (outcome.status === 'busy' || outcome.status === 'skipped') {
      await sleep(400 * (attempt + 1))
      continue
    }
    return false
  }
  return false
}

type KernelIntent = 'apply' | 'pause' | 'idle'

let kernelIntent: KernelIntent = 'idle'
let kernelSyncTail: Promise<void> = Promise.resolve()

function enqueueChainKernelSync(
  intent: KernelIntent,
  task: () => Promise<void>,
): void {
  if (kernelIntent === intent) return
  kernelIntent = intent
  kernelSyncTail = kernelSyncTail.then(task, task)
}

export function useChainProxy() {
  const [settings, setSettings] = useState<IChainProxySettings>(() =>
    getChainProxySettings(),
  )
  const [loading, setLoading] = useState(false)
  const [delayResults, setDelayResults] = useState<Record<string, number>>(() =>
    getChainDelayResults(),
  )
  const [ipState, setIpState] = useState<IChainIpState>(() => getChainIpState())

  const { verge } = useVerge()
  const { proxyView } = useProxiesData()
  const { clashConfig } = useClashConfigData()
  const { refreshProxy } = useAppRefreshers()
  const { current: currentProfile } = useProfiles()
  const profileUid = currentProfile?.uid || null
  const clashMode = clashConfig?.mode
  const trafficIntercepted = Boolean(
    verge?.enable_system_proxy || verge?.enable_tun_mode,
  )

  useEffect(() => {
    const unsubSettings = subscribeChainProxySettings((newSettings) => {
      setSettings(newSettings)
    })
    const unsubDelay = subscribeChainDelayResults((results) => {
      setDelayResults(results)
    })
    const unsubIp = subscribeChainIpState((next) => {
      setIpState(next)
    })
    return () => {
      unsubSettings()
      unsubDelay()
      unsubIp()
    }
  }, [])

  const selectedExitNode = useMemo(() => {
    if (!settings.selectedExitId) return undefined
    return settings.exitNodes.find((n) => n.id === settings.selectedExitId)
  }, [settings.selectedExitId, settings.exitNodes])

  const applyAndSync = useCallback(
    async (nextSettings: IChainProxySettings) => {
      const enabling = nextSettings.enabled && !settings.enabled
      const disabling = !nextSettings.enabled && settings.enabled
      const preferredEntryName = resolvePreferredEntryName(
        proxyView,
        clashMode,
        profileUid,
      )
      const currentCtx = resolveCurrentProxyContext(
        proxyView,
        clashMode,
        profileUid,
      )

      if (
        enabling &&
        currentCtx.nodeName &&
        currentCtx.groupName !== 'DIRECT'
      ) {
        savePrevSelection({
          groupName: currentCtx.groupName,
          nodeName: currentCtx.nodeName,
        })
      }

      saveChainProxySettings(nextSettings)
      setSettings(nextSettings)

      const shouldApplyKernel = nextSettings.enabled && trafficIntercepted
      const shouldPauseKernel = nextSettings.enabled && !trafficIntercepted
      kernelIntent = disabling ? 'idle' : shouldApplyKernel ? 'apply' : 'pause'

      try {
        setLoading(true)
        await syncChainProxyToMerge(
          shouldApplyKernel
            ? nextSettings
            : { ...nextSettings, enabled: false },
          preferredEntryName,
        )
        const enhanced = await enhanceProfilesWithRetry()
        if (!enhanced) {
          throw new Error('enhanceProfiles returned invalid')
        }

        const exitNode = nextSettings.exitNodes.find(
          (node) => node.id === nextSettings.selectedExitId,
        )
        const targetGroupNames = [
          currentCtx.groupName,
          proxyView?.global?.name || 'GLOBAL',
        ]
        await activateChainProxySelection({
          enabled: shouldApplyKernel,
          exitNode,
          preferredEntryName,
          targetGroupNames,
          restoreSelection:
            disabling || shouldPauseKernel ? getStoredPrevSelection() : null,
        })
        if (disabling) {
          clearPrevSelection()
        }
        await refreshProxy().catch(() => {})
      } catch (err) {
        console.error('[useChainProxy] Sync failed:', err)
        showNotice.error('链式代理配置同步失败')
      } finally {
        setLoading(false)
      }
    },
    [
      clashMode,
      profileUid,
      proxyView,
      refreshProxy,
      settings.enabled,
      trafficIntercepted,
    ],
  )

  const applyAndSyncRef = useRef(applyAndSync)
  applyAndSyncRef.current = applyAndSync

  useEffect(() => {
    // Wait until verge settings are loaded; treating "unknown" as offline would
    // strip Script and race boot-time config validation on every cold start.
    if (!verge || !settings.enabled) {
      if (!settings.enabled) {
        kernelIntent = 'idle'
      }
      return
    }
    if (!trafficIntercepted) {
      enqueueChainKernelSync('pause', () =>
        applyAndSyncRef.current(getChainProxySettings()),
      )
      return
    }
    if (kernelIntent === 'pause' || kernelIntent === 'idle') {
      enqueueChainKernelSync('apply', () =>
        applyAndSyncRef.current(getChainProxySettings()),
      )
    }
  }, [settings.enabled, trafficIntercepted, verge])

  const toggleEnabled = useCallback(
    async (targetEnabled?: boolean) => {
      const nextEnabled =
        typeof targetEnabled === 'boolean' ? targetEnabled : !settings.enabled

      if (
        nextEnabled &&
        !settings.selectedExitId &&
        settings.exitNodes.length > 0
      ) {
        const nextSettings: IChainProxySettings = {
          ...settings,
          enabled: true,
          selectedExitId: settings.exitNodes[0].id,
        }
        await applyAndSync(nextSettings)
        return
      }

      const nextSettings: IChainProxySettings = {
        ...settings,
        enabled: nextEnabled,
      }
      await applyAndSync(nextSettings)
    },
    [settings, applyAndSync],
  )

  const selectExitNode = useCallback(
    async (exitId: string) => {
      const nextSettings: IChainProxySettings = {
        ...settings,
        selectedExitId: exitId,
      }
      await applyAndSync(nextSettings)
    },
    [settings, applyAndSync],
  )

  const saveExitNode = useCallback(
    async (node: IChainExitNode) => {
      const existsIndex = settings.exitNodes.findIndex((n) => n.id === node.id)
      let nextNodes: IChainExitNode[]
      if (existsIndex >= 0) {
        nextNodes = [...settings.exitNodes]
        nextNodes[existsIndex] = node
      } else {
        nextNodes = [...settings.exitNodes, node]
      }

      const nextSelectedId =
        settings.selectedExitId ||
        (nextNodes.length === 1 ? node.id : settings.selectedExitId)

      const nextSettings: IChainProxySettings = {
        ...settings,
        exitNodes: nextNodes,
        selectedExitId: nextSelectedId,
      }
      await applyAndSync(nextSettings)
    },
    [settings, applyAndSync],
  )

  const deleteExitNode = useCallback(
    async (nodeId: string) => {
      const nextNodes = settings.exitNodes.filter((n) => n.id !== nodeId)
      let nextSelectedId = settings.selectedExitId
      if (nextSelectedId === nodeId) {
        nextSelectedId = nextNodes.length > 0 ? nextNodes[0].id : null
      }
      const nextSettings: IChainProxySettings = {
        ...settings,
        exitNodes: nextNodes,
        selectedExitId: nextSelectedId,
        enabled: nextNodes.length === 0 ? false : settings.enabled,
      }
      await applyAndSync(nextSettings)
    },
    [settings, applyAndSync],
  )

  const testNode = useCallback(
    async (node: IChainExitNode) => {
      const entryName = resolvePreferredEntryName(
        proxyView,
        clashMode,
        profileUid,
      )
      if (
        !entryName ||
        entryName === 'DIRECT' ||
        isChainExitProxyName(entryName)
      ) {
        showNotice.error('请先选择一个入口节点后再测试')
        setChainDelayResult(node.id, 1e6)
        return 1e6
      }
      setChainDelayResult(node.id, -2)
      try {
        const delay = await testChainProxyDelay(node, entryName, {
          keepLoaded: settings.enabled && settings.selectedExitId === node.id,
        })
        setChainDelayResult(node.id, delay)
        return delay
      } catch (err) {
        console.warn('[useChainProxy] Test delay failed:', err)
        showNotice.error('出口节点尚未加载到内核，请稍后再测')
        setChainDelayResult(node.id, 1e6)
        return 1e6
      }
    },
    [
      clashMode,
      profileUid,
      proxyView,
      settings.enabled,
      settings.selectedExitId,
    ],
  )

  const testCurrentExit = useCallback(async () => {
    if (!selectedExitNode) return
    return await testNode(selectedExitNode)
  }, [selectedExitNode, testNode])

  const checkCurrentIp = useCallback(async () => {
    setChainIpState({ ...getChainIpState(), loading: true, error: null })
    try {
      const info = await fetchCurrentExitIp()
      setChainIpState({ data: info, loading: false, error: null })
      return info
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '获取 IP 信息失败'
      setChainIpState({ data: null, loading: false, error: msg })
      console.warn('[useChainProxy] Failed to check IP:', err)
      return null
    }
  }, [])

  const currentOutboundIsExit = useMemo(() => {
    if (!settings.enabled || !selectedExitNode || !proxyView) return false
    const exitName = chainExitProxyName(selectedExitNode.name)
    const ctx = resolveCurrentProxyContext(proxyView, clashMode, profileUid)
    const group =
      ctx.groupName === (proxyView.global?.name || 'GLOBAL')
        ? proxyView.global
        : proxyView.groups.find((item) => item.name === ctx.groupName)
    return group?.now === exitName || proxyView.global?.now === exitName
  }, [clashMode, profileUid, proxyView, selectedExitNode, settings.enabled])

  const currentEntryName = useMemo(() => {
    if (!settings.enabled) return undefined
    return resolvePreferredEntryName(proxyView, clashMode, profileUid)
  }, [clashMode, profileUid, proxyView, settings.enabled])

  const switchEntryHop = useCallback(
    async (entryName: string) => {
      if (!settings.enabled || !selectedExitNode || !trafficIntercepted) return
      if (
        !entryName ||
        entryName === 'DIRECT' ||
        isChainExitProxyName(entryName)
      ) {
        return
      }

      const currentCtx = resolveCurrentProxyContext(
        proxyView,
        clashMode,
        profileUid,
      )
      savePrevSelection({
        groupName: currentCtx.groupName,
        nodeName: entryName,
      })

      try {
        setLoading(true)
        await applyEntryHop({
          exitNode: selectedExitNode,
          entryName,
          targetGroupNames: [
            currentCtx.groupName,
            proxyView?.global?.name || 'GLOBAL',
          ],
        })
        await refreshProxy().catch(() => {})
      } catch (err) {
        console.error('[useChainProxy] Switch entry hop failed:', err)
        showNotice.error('切换链式入口失败')
      } finally {
        setLoading(false)
      }
    },
    [
      clashMode,
      profileUid,
      proxyView,
      refreshProxy,
      selectedExitNode,
      settings.enabled,
      trafficIntercepted,
    ],
  )

  const kernelPaused = settings.enabled && !trafficIntercepted

  return {
    settings,
    enabled: settings.enabled,
    selectedExitNode,
    exitNodes: settings.exitNodes,
    loading,
    delayResults,
    ipData: ipState.data,
    ipLoading: ipState.loading,
    ipError: ipState.error,
    currentOutboundIsExit,
    currentEntryName,
    trafficIntercepted,
    kernelPaused,
    switchEntryHop,
    toggleEnabled,
    selectExitNode,
    saveExitNode,
    deleteExitNode,
    testNode,
    testCurrentExit,
    checkCurrentIp,
    refreshSync: () => applyAndSync(settings),
  }
}
