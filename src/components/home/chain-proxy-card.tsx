import {
  AddRounded,
  ArrowForwardRounded,
  CableRounded,
  CheckCircleOutlineRounded,
  InfoOutlined,
  LinkOffRounded,
  LinkRounded,
  PublicRounded,
  SettingsOutlined,
  SpeedRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ChainProxyManagerDialog } from '@/components/chain-proxy/chain-proxy-manager-dialog'
import { EnhancedCard } from '@/components/home/enhanced-card'
import { useChainProxy } from '@/hooks/use-chain-proxy'
import {
  formatDelayText,
  getCountryFlagEmoji,
  getDelayColor,
} from '@/utils/chain-proxy'

export const ChainProxyCard: React.FC = () => {
  const { t } = useTranslation()
  const {
    enabled,
    selectedExitNode,
    exitNodes,
    loading,
    delayResults,
    ipData,
    ipLoading,
    ipError,
    toggleEnabled,
    selectExitNode,
    testCurrentExit,
    checkCurrentIp,
    currentOutboundIsExit,
    currentEntryName,
    kernelPaused,
  } = useChainProxy()

  const [managerOpen, setManagerOpen] = useState(false)

  const currentDelay = selectedExitNode
    ? delayResults[selectedExitNode.id]
    : undefined
  const isDelayTesting = currentDelay === -2
  const delayColor = getDelayColor(currentDelay)
  const buttonColor:
    | 'inherit'
    | 'primary'
    | 'secondary'
    | 'success'
    | 'error'
    | 'info'
    | 'warning' = delayColor === 'default' ? 'primary' : delayColor

  const isServerIpMatch = Boolean(
    ipData?.ip &&
      selectedExitNode?.server &&
      (ipData.ip.trim() === selectedExitNode.server.trim() ||
        selectedExitNode.server.includes(ipData.ip.trim())),
  )
  const isChainEgressActive = currentOutboundIsExit || isServerIpMatch

  return (
    <>
      <EnhancedCard
        title={t('home.chainProxy.cardTitle' as any, {
          defaultValue: '链式代理 (静态出口)',
        })}
        icon={<CableRounded />}
        iconColor={enabled ? 'primary' : 'secondary'}
        action={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {loading && <CircularProgress size={18} />}
            <Tooltip
              title={t('home.chainProxy.manageTip' as any, {
                defaultValue: '管理静态出口节点',
              })}
            >
              <IconButton size="small" onClick={() => setManagerOpen(true)}>
                <SettingsOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip
              title={
                enabled
                  ? t('home.chainProxy.disableTip' as any, {
                      defaultValue: '关闭链式代理',
                    })
                  : t('home.chainProxy.enableTip' as any, {
                      defaultValue: '开启链式代理',
                    })
              }
            >
              <Switch
                size="small"
                checked={enabled}
                onChange={(_, checked) => toggleEnabled(checked)}
                disabled={loading || (exitNodes.length === 0 && !enabled)}
              />
            </Tooltip>
          </Stack>
        }
      >
        <Box sx={{ p: 2, pt: 1 }}>
          {exitNodes.length === 0 ? (
            <Box
              sx={{
                py: 2,
                px: 2,
                borderRadius: 2,
                bgcolor: 'action.hover',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {t('home.chainProxy.noNodes' as any, {
                  defaultValue: '尚未添加静态出口节点',
                })}
              </Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddRounded />}
                onClick={() => setManagerOpen(true)}
              >
                {t('shared.actions.new', { defaultValue: '添加出口' })}
              </Button>
            </Box>
          ) : (
            <Stack spacing={1.5}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  flexWrap: 'wrap',
                }}
              >
                <FormControl
                  size="small"
                  sx={{ minWidth: 200, flex: 1 }}
                  disabled={loading}
                >
                  <InputLabel>
                    {t('home.chainProxy.selectExitLabel' as any, {
                      defaultValue: '当前静态出口节点',
                    })}
                  </InputLabel>
                  <Select
                    value={selectedExitNode?.id || ''}
                    label={t('home.chainProxy.selectExitLabel' as any, {
                      defaultValue: '当前静态出口节点',
                    })}
                    onChange={(e) => selectExitNode(e.target.value)}
                  >
                    {exitNodes.map((node) => (
                      <MenuItem key={node.id} value={node.id}>
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            width: '100%',
                          }}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {node.name}
                          </Typography>
                          <Chip
                            size="small"
                            label={node.type.toUpperCase()}
                            variant="outlined"
                            sx={{ height: 18, fontSize: '0.7rem' }}
                          />
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ ml: 'auto' }}
                          >
                            {node.server}:{node.port}
                          </Typography>
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                {/* 测速与IP检测快捷操作 */}
                <Stack direction="row" spacing={1}>
                  <Tooltip
                    title={t('home.chainProxy.testDelayTip' as any, {
                      defaultValue: '测试该静态出口节点的连通性与延迟',
                    })}
                  >
                    <span>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={
                          isDelayTesting ? (
                            <CircularProgress size={14} color="inherit" />
                          ) : (
                            <SpeedRounded fontSize="small" />
                          )
                        }
                        color={buttonColor}
                        onClick={testCurrentExit}
                        disabled={
                          isDelayTesting || !selectedExitNode || !enabled
                        }
                        sx={{ minWidth: 'auto', px: 1.2, height: 36 }}
                      >
                        {currentDelay !== undefined && currentDelay !== -1
                          ? formatDelayText(currentDelay)
                          : t('home.chainProxy.testDelay' as any, {
                              defaultValue: '测试延迟',
                            })}
                      </Button>
                    </span>
                  </Tooltip>

                  <Tooltip
                    title={t('home.chainProxy.checkIpTip' as any, {
                      defaultValue: '检测当前实际出站 IP 与归属地',
                    })}
                  >
                    <span>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={
                          ipLoading ? (
                            <CircularProgress size={14} color="inherit" />
                          ) : (
                            <PublicRounded fontSize="small" />
                          )
                        }
                        onClick={checkCurrentIp}
                        disabled={ipLoading}
                        sx={{ minWidth: 'auto', px: 1.2, height: 36 }}
                      >
                        {t('home.chainProxy.checkIp' as any, {
                          defaultValue: '检测实际 IP',
                        })}
                      </Button>
                    </span>
                  </Tooltip>
                </Stack>
              </Box>

              {/* 链路流向与状态条 */}
              <Box
                sx={{
                  p: 1.2,
                  px: 1.5,
                  borderRadius: 1.5,
                  bgcolor:
                    enabled && !kernelPaused ? 'primary.50' : 'action.hover',
                  border: '1px solid',
                  borderColor:
                    enabled && !kernelPaused ? 'primary.200' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 1,
                  fontSize: '0.8125rem',
                }}
              >
                {enabled && !kernelPaused ? (
                  <>
                    <LinkRounded color="primary" sx={{ fontSize: 18 }} />
                    <Typography
                      variant="caption"
                      sx={{ fontWeight: 600, color: 'primary.main' }}
                    >
                      {t('home.chainProxy.statusEnabled' as any, {
                        defaultValue: '链式生效中：',
                      })}
                    </Typography>
                    <Chip
                      size="small"
                      label={
                        currentEntryName ||
                        t('home.chainProxy.dynamicEntry' as any, {
                          defaultValue: '任意选定入口',
                        })
                      }
                      variant="outlined"
                      color="primary"
                      sx={{ height: 20, fontSize: '0.75rem' }}
                    />
                    <ArrowForwardRounded color="action" sx={{ fontSize: 14 }} />
                    <Chip
                      size="small"
                      label={`🔒 ${selectedExitNode?.name || '静态出口'}`}
                      color="primary"
                      sx={{ height: 20, fontSize: '0.75rem', fontWeight: 600 }}
                    />
                    {currentDelay !== undefined &&
                      currentDelay !== -1 &&
                      currentDelay !== -2 && (
                        <Chip
                          size="small"
                          label={formatDelayText(currentDelay)}
                          color={getDelayColor(currentDelay)}
                          variant="outlined"
                          sx={{ height: 20, fontSize: '0.7rem', ml: 'auto' }}
                        />
                      )}
                  </>
                ) : enabled ? (
                  <>
                    <LinkOffRounded color="warning" sx={{ fontSize: 18 }} />
                    <Typography variant="caption" color="text.secondary">
                      {t('home.chainProxy.statusPaused' as any, {
                        defaultValue:
                          '链式已暂停：系统代理和 TUN 均未开启，避免静态出口影响直连网络。打开其一后会自动恢复。',
                      })}
                    </Typography>
                  </>
                ) : (
                  <>
                    <LinkOffRounded color="disabled" sx={{ fontSize: 18 }} />
                    <Typography variant="caption" color="text.secondary">
                      {t('home.chainProxy.statusDisabled' as any, {
                        defaultValue:
                          '链式未启用 (流量直接由当前常规代理节点出站)',
                      })}
                    </Typography>
                  </>
                )}
              </Box>

              {/* 实际出口 IP 信息展示框 */}
              {(ipData || ipLoading || ipError) && (
                <Box
                  sx={{
                    p: 1.2,
                    px: 1.5,
                    borderRadius: 1.5,
                    bgcolor: 'action.hover',
                    border: '1px solid',
                    borderColor: isChainEgressActive
                      ? 'success.main'
                      : 'divider',
                    fontSize: '0.8125rem',
                  }}
                >
                  {ipLoading ? (
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        color: 'text.secondary',
                      }}
                    >
                      <CircularProgress size={14} color="inherit" />
                      <Typography variant="caption">
                        {t('home.chainProxy.checkingIp' as any, {
                          defaultValue: '正在检测当前出站实际 IP...',
                        })}
                      </Typography>
                    </Box>
                  ) : ipError ? (
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        color: 'error.main',
                      }}
                    >
                      <InfoOutlined sx={{ fontSize: 16 }} />
                      <Typography variant="caption">{ipError}</Typography>
                    </Box>
                  ) : (
                    <Stack spacing={0.5}>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: 1,
                        }}
                      >
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                          }}
                        >
                          <Typography sx={{ fontSize: '1rem' }}>
                            {getCountryFlagEmoji(ipData?.country_code)}
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              fontFamily: 'monospace',
                              fontWeight: 600,
                            }}
                          >
                            {ipData?.ip}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {[ipData?.city, ipData?.country]
                              .filter(Boolean)
                              .join(', ')}
                          </Typography>
                        </Box>

                        {currentOutboundIsExit ? (
                          <Chip
                            size="small"
                            icon={
                              <CheckCircleOutlineRounded
                                sx={{ fontSize: 14 }}
                              />
                            }
                            label={t(
                              'home.chainProxy.outboundSwitched' as any,
                              {
                                defaultValue: '当前出站已是静态出口',
                              },
                            )}
                            color="success"
                            variant="outlined"
                            sx={{ height: 20, fontSize: '0.7rem' }}
                          />
                        ) : isServerIpMatch ? (
                          <Chip
                            size="small"
                            icon={
                              <CheckCircleOutlineRounded
                                sx={{ fontSize: 14 }}
                              />
                            }
                            label={t('home.chainProxy.ipMatched' as any, {
                              defaultValue: '出口 IP 匹配成功',
                            })}
                            color="success"
                            variant="outlined"
                            sx={{ height: 20, fontSize: '0.7rem' }}
                          />
                        ) : (
                          <Chip
                            size="small"
                            label={
                              ipData?.organization ||
                              ipData?.asn_organization ||
                              '公网出口'
                            }
                            variant="outlined"
                            sx={{ height: 20, fontSize: '0.7rem' }}
                          />
                        )}
                      </Box>

                      {!enabled && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: 'block', fontSize: '0.725rem' }}
                        >
                          {t('home.chainProxy.directIpTip' as any, {
                            defaultValue:
                              '提示：当前链式未开启，请开启链式代理并启用「系统代理」或「TUN 模式」以确保所有网络流量流经静态出口。',
                          })}
                        </Typography>
                      )}
                      {enabled && ipData && !isServerIpMatch && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: 'block', fontSize: '0.725rem' }}
                        >
                          {t('home.chainProxy.ipMayDiffer' as any, {
                            defaultValue:
                              '公网 IP 可能因域名解析或 SNAT 与填写的 server 不同，请以当前出站是否为静态出口为准。',
                          })}
                        </Typography>
                      )}
                    </Stack>
                  )}
                </Box>
              )}
            </Stack>
          )}
        </Box>
      </EnhancedCard>

      {managerOpen && (
        <ChainProxyManagerDialog
          open={managerOpen}
          onClose={() => setManagerOpen(false)}
        />
      )}
    </>
  )
}
