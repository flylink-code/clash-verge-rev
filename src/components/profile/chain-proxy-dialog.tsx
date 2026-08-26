import {
  Autocomplete,
  Box,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
} from '@mui/material'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog } from '@/components/base'
import {
  type IChainProxyFormData,
  buildChainProxyConfig,
} from '@/utils/chain-proxy'

interface Props {
  open: boolean
  onClose: () => void
  existingProxies?: string[]
  onSuccess: (proxy: IProxyConfig, position: 'prepend' | 'append') => void
}

const EMPTY_PROXIES: string[] = []

export const ChainProxyDialog: React.FC<Props> = ({
  open,
  onClose,
  existingProxies = EMPTY_PROXIES,
  onSuccess,
}) => {
  const { t } = useTranslation()

  const [formData, setFormData] = useState<IChainProxyFormData>({
    name: '',
    type: 'socks5',
    server: '',
    port: 1080,
    username: '',
    password: '',
    dialerProxy: '',
    udp: true,
    skipCertVerify: false,
    tls: false,
  })

  const [position, setPosition] = useState<'prepend' | 'append'>('append')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // 过滤出有效且去重的前置节点候选列表
  const candidateProxies = useMemo(() => {
    return Array.from(new Set(existingProxies.filter(Boolean)))
  }, [existingProxies])

  const handleFieldChange = (
    field: keyof IChainProxyFormData,
    value: unknown,
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }))
    if (errorMsg) setErrorMsg(null)
  }

  const handleOk = () => {
    try {
      if (!formData.name.trim()) {
        setErrorMsg(
          t('profiles.chainProxy.nameRequired' as any, {
            defaultValue: '请输入节点名称',
          }),
        )
        return
      }
      if (!formData.server.trim()) {
        setErrorMsg(
          t('profiles.chainProxy.serverRequired' as any, {
            defaultValue: '请输入服务器地址',
          }),
        )
        return
      }
      const proxyConfig = buildChainProxyConfig(formData)
      onSuccess(proxyConfig, position)
      onClose()
    } catch (err: any) {
      setErrorMsg(err?.message || '配置校验失败')
    }
  }

  return (
    <BaseDialog
      open={open}
      title={t('profiles.chainProxy.title' as any, {
        defaultValue: '快速配置链式代理',
      })}
      okBtn={t('shared.actions.confirm')}
      cancelBtn={t('shared.actions.cancel')}
      onClose={onClose}
      onCancel={onClose}
      onOk={handleOk}
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
              placeholder="例如: 链式-落地节点"
              value={formData.name}
              onChange={(e) => handleFieldChange('name', e.target.value)}
              required
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
                value={formData.type}
                label={t('profiles.chainProxy.type' as any, {
                  defaultValue: '协议类型',
                })}
                onChange={(e) =>
                  handleFieldChange('type', e.target.value as 'socks5' | 'http')
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
              placeholder="127.0.0.1 或 域名"
              value={formData.server}
              onChange={(e) => handleFieldChange('server', e.target.value)}
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
              value={formData.port}
              onChange={(e) => handleFieldChange('port', e.target.value)}
              required
            />
          </Box>
        </Stack>

        {/* 前置代理 (dialer-proxy) */}
        <Autocomplete
          freeSolo
          options={candidateProxies}
          value={formData.dialerProxy || ''}
          onInputChange={(_, newInputValue) => {
            handleFieldChange('dialerProxy', newInputValue)
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              label={t('profiles.chainProxy.dialerProxy' as any, {
                defaultValue: '前置代理 (dialer-proxy)',
              })}
              placeholder="选择已有节点作为第一跳，或手动输入"
              helperText={t('profiles.chainProxy.dialerProxyHint' as any, {
                defaultValue: '流量将先通过该前置节点，再连接此落地代理',
              })}
            />
          )}
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Box sx={{ flex: 1 }}>
            <TextField
              fullWidth
              size="small"
              label={t('profiles.chainProxy.username' as any, {
                defaultValue: '用户名 (可选)',
              })}
              value={formData.username}
              onChange={(e) => handleFieldChange('username', e.target.value)}
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
              value={formData.password}
              onChange={(e) => handleFieldChange('password', e.target.value)}
            />
          </Box>
        </Stack>

        {/* 插入位置与附加参数 */}
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: 'center' }}
        >
          <Box sx={{ flex: 1, width: '100%' }}>
            <FormControl fullWidth size="small">
              <InputLabel>
                {t('profiles.chainProxy.position' as any, {
                  defaultValue: '插入位置',
                })}
              </InputLabel>
              <Select
                value={position}
                label={t('profiles.chainProxy.position' as any, {
                  defaultValue: '插入位置',
                })}
                onChange={(e) =>
                  setPosition(e.target.value as 'prepend' | 'append')
                }
              >
                <MenuItem value="append">
                  {t('profiles.chainProxy.append' as any, {
                    defaultValue: '追加到尾部',
                  })}
                </MenuItem>
                <MenuItem value="prepend">
                  {t('profiles.chainProxy.prepend' as any, {
                    defaultValue: '插入到头部',
                  })}
                </MenuItem>
              </Select>
            </FormControl>
          </Box>
          <Box sx={{ flex: 1, width: '100%' }}>
            <Stack direction="row" spacing={1}>
              {formData.type === 'socks5' && (
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={Boolean(formData.udp)}
                      onChange={(e) =>
                        handleFieldChange('udp', e.target.checked)
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
                    checked={Boolean(formData.skipCertVerify)}
                    onChange={(e) =>
                      handleFieldChange('skipCertVerify', e.target.checked)
                    }
                  />
                }
                label={t('profiles.chainProxy.skipCertVerify' as any, {
                  defaultValue: '跳过证书校验',
                })}
              />
            </Stack>
          </Box>
        </Stack>
      </Stack>
    </BaseDialog>
  )
}
export default ChainProxyDialog
