import {
  AddRounded,
  DeleteOutlineRounded,
  EditOutlined,
  LanOutlined,
  SpeedRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog } from '@/components/base'
import { useChainProxy } from '@/hooks/use-chain-proxy'
import {
  type IChainExitNode,
  CHAIN_ENTRY_GROUP_NAME,
  formatDelayText,
  getDelayColor,
} from '@/utils/chain-proxy'

interface Props {
  open: boolean
  onClose: () => void
}

export const ChainProxyManagerDialog: React.FC<Props> = ({ open, onClose }) => {
  const { t } = useTranslation()
  const {
    exitNodes,
    saveExitNode,
    deleteExitNode,
    selectedExitNode,
    selectExitNode,
    delayResults,
    testNode,
    enabled,
  } = useChainProxy()

  const [editingNode, setEditingNode] = useState<IChainExitNode | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleOpenCreate = () => {
    setEditingNode({
      id: `exit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: '',
      type: 'socks5',
      server: '',
      port: 1080,
      username: '',
      password: '',
      dialerGroup: CHAIN_ENTRY_GROUP_NAME,
      udp: true,
      skipCertVerify: false,
      tls: false,
    })
    setErrorMsg(null)
    setFormOpen(true)
  }

  const handleOpenEdit = (node: IChainExitNode) => {
    setEditingNode({ ...node })
    setErrorMsg(null)
    setFormOpen(true)
  }

  const handleFormChange = (field: keyof IChainExitNode, value: unknown) => {
    if (!editingNode) return
    setEditingNode({
      ...editingNode,
      [field]: value,
    })
    if (errorMsg) setErrorMsg(null)
  }

  const handleSaveForm = async () => {
    if (!editingNode) return
    const name = editingNode.name.trim()
    const server = editingNode.server.trim()
    const port = Number(editingNode.port)

    if (!name) {
      setErrorMsg(
        t('profiles.chainProxy.nameRequired' as any, {
          defaultValue: '请输入节点名称',
        }),
      )
      return
    }
    if (!server) {
      setErrorMsg(
        t('profiles.chainProxy.serverRequired' as any, {
          defaultValue: '请输入服务器地址',
        }),
      )
      return
    }
    if (Number.isNaN(port) || port <= 0 || port > 65535) {
      setErrorMsg(
        t('profiles.chainProxy.portRequired' as any, {
          defaultValue: '请输入有效的端口号 (1-65535)',
        }),
      )
      return
    }

    await saveExitNode({
      ...editingNode,
      name,
      server,
      port,
      username: editingNode.username?.trim() || undefined,
      password: editingNode.password || undefined,
      dialerGroup:
        editingNode.dialerGroup?.trim() &&
        editingNode.dialerGroup.trim() !== 'GLOBAL'
          ? editingNode.dialerGroup.trim()
          : CHAIN_ENTRY_GROUP_NAME,
    })

    setFormOpen(false)
    setEditingNode(null)
  }

  return (
    <>
      <BaseDialog
        open={open && !formOpen}
        title={t('home.chainProxy.managerTitle' as any, {
          defaultValue: '静态出口节点管理 (链式代理)',
        })}
        okBtn={t('shared.actions.close', { defaultValue: '关闭' })}
        disableCancel
        onOk={onClose}
        onClose={onClose}
        contentSx={{
          minWidth: { xs: '320px', sm: '560px' },
          maxHeight: '70vh',
          pt: 1,
        }}
      >
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {t('home.chainProxy.managerDesc' as any, {
                defaultValue:
                  '配置静态 IP 出口代理。开启后，任意入口节点的流量都会转发至所选出口节点。',
              })}
            </Typography>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddRounded />}
              onClick={handleOpenCreate}
              sx={{ whiteSpace: 'nowrap', ml: 2 }}
            >
              {t('shared.actions.new', { defaultValue: '新建出口' })}
            </Button>
          </Box>

          <Divider />

          {exitNodes.length === 0 ? (
            <Box
              sx={{
                p: 4,
                textAlign: 'center',
                bgcolor: 'action.hover',
                borderRadius: 2,
                border: '1px dashed',
                borderColor: 'divider',
              }}
            >
              <LanOutlined
                sx={{
                  fontSize: 40,
                  color: 'text.secondary',
                  mb: 1,
                  opacity: 0.6,
                }}
              />
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('home.chainProxy.emptyTip' as any, {
                  defaultValue: '暂无配置的静态出口节点，点击上方按钮添加',
                })}
              </Typography>
              <Button
                variant="outlined"
                size="small"
                startIcon={<AddRounded />}
                onClick={handleOpenCreate}
              >
                {t('home.chainProxy.addFirst' as any, {
                  defaultValue: '添加第一个出口节点',
                })}
              </Button>
            </Box>
          ) : (
            <Stack
              spacing={1.5}
              sx={{ maxHeight: '420px', overflowY: 'auto', pr: 0.5 }}
            >
              {exitNodes.map((node) => {
                const isSelected = selectedExitNode?.id === node.id
                const nodeDelay = delayResults[node.id]
                const isTesting = nodeDelay === -2

                return (
                  <Card
                    key={node.id}
                    variant="outlined"
                    sx={{
                      borderColor: isSelected ? 'primary.main' : 'divider',
                      bgcolor: isSelected
                        ? 'action.selected'
                        : 'background.paper',
                      transition: 'all 0.2s',
                    }}
                  >
                    <CardContent sx={{ p: '12px 16px !important' }}>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <Box sx={{ flex: 1, minWidth: 0, mr: 1 }}>
                          <Box
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: 1,
                              mb: 0.5,
                            }}
                          >
                            <Typography
                              variant="subtitle2"
                              sx={{ fontWeight: 600 }}
                              noWrap
                            >
                              {node.name}
                            </Typography>
                            <Chip
                              size="small"
                              label={node.type.toUpperCase()}
                              color={
                                node.type === 'socks5' ? 'primary' : 'secondary'
                              }
                              variant="outlined"
                              sx={{ height: 20, fontSize: '0.75rem' }}
                            />
                            {isSelected && (
                              <Chip
                                size="small"
                                label={t(
                                  'home.chainProxy.currentActive' as any,
                                  {
                                    defaultValue: '当前使用中',
                                  },
                                )}
                                color="success"
                                sx={{ height: 20, fontSize: '0.75rem' }}
                              />
                            )}
                            {nodeDelay !== undefined &&
                              nodeDelay !== -1 &&
                              nodeDelay !== -2 && (
                                <Chip
                                  size="small"
                                  label={formatDelayText(nodeDelay)}
                                  color={getDelayColor(nodeDelay)}
                                  variant="outlined"
                                  sx={{ height: 20, fontSize: '0.7rem' }}
                                />
                              )}
                          </Box>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            noWrap
                            sx={{ display: 'block' }}
                          >
                            {node.server}:{node.port}
                            {node.username ? ` (${node.username})` : ''}
                            {node.udp ? ' • UDP' : ''}
                          </Typography>
                        </Box>

                        <Stack
                          direction="row"
                          spacing={0.5}
                          sx={{ alignItems: 'center' }}
                        >
                          <Tooltip
                            title={t('home.chainProxy.testDelay' as any, {
                              defaultValue: '测试连通性与延迟',
                            })}
                          >
                            <IconButton
                              size="small"
                              onClick={() => testNode(node)}
                              disabled={isTesting || !enabled || !isSelected}
                              color="primary"
                            >
                              {isTesting ? (
                                <CircularProgress size={16} color="inherit" />
                              ) : (
                                <SpeedRounded fontSize="small" />
                              )}
                            </IconButton>
                          </Tooltip>

                          {!isSelected && (
                            <Button
                              size="small"
                              variant="text"
                              onClick={() => selectExitNode(node.id)}
                              sx={{ minWidth: 'auto', px: 1 }}
                            >
                              {t('home.chainProxy.useThis' as any, {
                                defaultValue: '选用',
                              })}
                            </Button>
                          )}
                          <IconButton
                            size="small"
                            onClick={() => handleOpenEdit(node)}
                          >
                            <EditOutlined fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => deleteExitNode(node.id)}
                          >
                            <DeleteOutlineRounded fontSize="small" />
                          </IconButton>
                        </Stack>
                      </Box>
                    </CardContent>
                  </Card>
                )
              })}
            </Stack>
          )}
        </Stack>
      </BaseDialog>

      {/* 节点编辑 / 新增弹窗 */}
      {editingNode && (
        <BaseDialog
          open={formOpen}
          title={
            exitNodes.some((n) => n.id === editingNode.id)
              ? t('home.chainProxy.editExit' as any, {
                  defaultValue: '编辑静态出口节点',
                })
              : t('home.chainProxy.addExit' as any, {
                  defaultValue: '添加静态出口节点',
                })
          }
          okBtn={t('shared.actions.save', { defaultValue: '保存' })}
          cancelBtn={t('shared.actions.cancel', { defaultValue: '取消' })}
          onOk={handleSaveForm}
          onCancel={() => {
            setFormOpen(false)
            setEditingNode(null)
          }}
          onClose={() => {
            setFormOpen(false)
            setEditingNode(null)
          }}
          contentSx={{ minWidth: { xs: '320px', sm: '480px' }, pt: 1 }}
        >
          <Stack spacing={2} sx={{ mt: 1 }}>
            {errorMsg && (
              <Box
                sx={{
                  color: 'error.main',
                  fontSize: '0.875rem',
                  p: 1,
                  bgcolor: 'error.light',
                  borderRadius: 1,
                }}
              >
                {errorMsg}
              </Box>
            )}

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Box sx={{ flex: 2 }}>
                <TextField
                  fullWidth
                  size="small"
                  label={t('profiles.chainProxy.name' as any, {
                    defaultValue: '节点名称',
                  })}
                  placeholder="例如: 我的香港静态IP出口"
                  value={editingNode.name}
                  onChange={(e) => handleFormChange('name', e.target.value)}
                  required
                  autoFocus
                />
              </Box>
              <Box sx={{ flex: 1 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>
                    {t('profiles.chainProxy.type' as any, {
                      defaultValue: '协议类型',
                    })}
                  </InputLabel>
                  <Select
                    value={editingNode.type}
                    label={t('profiles.chainProxy.type' as any, {
                      defaultValue: '协议类型',
                    })}
                    onChange={(e) =>
                      handleFormChange(
                        'type',
                        e.target.value as 'socks5' | 'http',
                      )
                    }
                  >
                    <MenuItem value="socks5">SOCKS5</MenuItem>
                    <MenuItem value="http">HTTP</MenuItem>
                  </Select>
                </FormControl>
              </Box>
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Box sx={{ flex: 2 }}>
                <TextField
                  fullWidth
                  size="small"
                  label={t('profiles.chainProxy.server' as any, {
                    defaultValue: '服务器地址',
                  })}
                  placeholder="IP 或 域名"
                  value={editingNode.server}
                  onChange={(e) => handleFormChange('server', e.target.value)}
                  required
                />
              </Box>
              <Box sx={{ flex: 1 }}>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  label={t('profiles.chainProxy.port' as any, {
                    defaultValue: '端口',
                  })}
                  placeholder="1080"
                  value={editingNode.port}
                  onChange={(e) => handleFormChange('port', e.target.value)}
                  required
                />
              </Box>
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Box sx={{ flex: 1 }}>
                <TextField
                  fullWidth
                  size="small"
                  label={t('profiles.chainProxy.username' as any, {
                    defaultValue: '用户名 (可选)',
                  })}
                  value={editingNode.username || ''}
                  onChange={(e) => handleFormChange('username', e.target.value)}
                />
              </Box>
              <Box sx={{ flex: 1 }}>
                <TextField
                  fullWidth
                  size="small"
                  type="password"
                  label={t('profiles.chainProxy.password' as any, {
                    defaultValue: '密码 (可选)',
                  })}
                  value={editingNode.password || ''}
                  onChange={(e) => handleFormChange('password', e.target.value)}
                />
              </Box>
            </Stack>

            <TextField
              fullWidth
              size="small"
              label={t('home.chainProxy.dialerGroup' as any, {
                defaultValue: '前置入口组 (dialer-proxy)',
              })}
              value={editingNode.dialerGroup || CHAIN_ENTRY_GROUP_NAME}
              onChange={(e) => handleFormChange('dialerGroup', e.target.value)}
              helperText={t('home.chainProxy.dialerGroupHint' as any, {
                defaultValue:
                  '默认「🔗 链式入口」，会把当前选中的入口节点作为第一跳；可在「代理」页切换该组。填写 GLOBAL 时同样接入该入口组，避免与出口选中形成环路。',
              })}
            />

            <Stack direction="row" spacing={2} sx={{ pt: 0.5 }}>
              {editingNode.type === 'socks5' && (
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={editingNode.udp !== false}
                      onChange={(e) =>
                        handleFormChange('udp', e.target.checked)
                      }
                    />
                  }
                  label="UDP"
                />
              )}
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={Boolean(editingNode.skipCertVerify)}
                    onChange={(e) =>
                      handleFormChange('skipCertVerify', e.target.checked)
                    }
                  />
                }
                label={t('profiles.chainProxy.skipCertVerify' as any, {
                  defaultValue: '跳过证书校验',
                })}
              />
            </Stack>
          </Stack>
        </BaseDialog>
      )}
    </>
  )
}
