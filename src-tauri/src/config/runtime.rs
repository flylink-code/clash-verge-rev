use serde_yaml_ng::{Mapping, Value};
use smartstring::alias::String;
use std::collections::{HashMap, HashSet};

use crate::enhance::field::use_keys;

const PATCH_CONFIG_INNER: [&str; 5] = ["allow-lan", "ipv6", "log-level", "unified-delay", "tunnels"];

#[derive(Default, Clone)]
pub struct IRuntime {
    pub config: Option<Mapping>,
    pub(crate) dns_override: Option<super::dns::DnsOverrideState>,
    // Keys seen in the profile pipeline, including merge and script output.
    pub exists_keys: HashSet<String>,
    // TODO 或许可以用 FixMap 来存储以提升效率
    pub chain_logs: HashMap<String, Vec<(String, String)>>,
}

impl IRuntime {
    #[inline]
    pub fn patch_config(&mut self, patch: &Mapping) {
        let config = if let Some(config) = self.config.as_mut() {
            config
        } else {
            return;
        };

        for key in PATCH_CONFIG_INNER.iter() {
            if let Some(value) = patch.get(key) {
                config.insert((*key).into(), value.clone());
            }
        }

        let Some(patch_tun) = patch.get("tun") else {
            return;
        };

        let tun_key = Value::from("tun");
        if !matches!(config.get(&tun_key), Some(Value::Mapping(_))) {
            config.insert(tun_key.clone(), Value::Mapping(Mapping::new()));
        }

        if let (Some(patch_tun_mapping), Some(Value::Mapping(tun))) = (patch_tun.as_mapping(), config.get_mut(&tun_key))
        {
            for key in use_keys(patch_tun_mapping) {
                if let Some(value) = patch_tun_mapping.get(key.as_str()) {
                    tun.insert(Value::from(key.as_str()), value.clone());
                }
            }
        }
    }

    /// Rebuilds `dialer-proxy` links from an ordered proxy chain, or removes them for `None`.
    /// Static chain exits (`CV-EXIT-*`) keep their dialer so the proxies-page chain UI cannot
    /// drop them back to a direct local dial.
    #[inline]
    pub fn update_proxy_chain_config(&mut self, proxy_chain_config: Option<Value>) {
        let config = if let Some(config) = self.config.as_mut() {
            config
        } else {
            return;
        };

        if let Some(Value::Sequence(proxies)) = config.get_mut("proxies") {
            proxies.iter_mut().for_each(|proxy| {
                if let Some(proxy) = proxy.as_mapping_mut()
                    && proxy.get("dialer-proxy").is_some()
                    && !proxy_name_is_chain_exit(proxy)
                {
                    proxy.remove("dialer-proxy");
                }
            });
        }

        if let Some(Value::Sequence(dialer_proxies)) = proxy_chain_config
            && let Some(Value::Sequence(proxies)) = config.get_mut("proxies")
        {
            for (i, dialer_proxy) in dialer_proxies.iter().enumerate() {
                if let Some(Value::Mapping(proxy)) =
                    proxies.iter_mut().find(|proxy| proxy.get("name") == Some(dialer_proxy))
                    && i != 0
                    && let Some(dialer_proxy) = dialer_proxies.get(i - 1)
                {
                    proxy.insert("dialer-proxy".into(), dialer_proxy.to_owned());
                }
            }
        }
    }

    /// Inserts or replaces a `CV-EXIT-*` proxy used only for a delay probe.
    /// Does not add the name to any proxy group, so it cannot take over traffic.
    pub fn upsert_chain_exit_probe(&mut self, proxy: Mapping) {
        let Some(name) = proxy.get("name").and_then(Value::as_str).map(str::to_owned) else {
            return;
        };
        if !name.starts_with(CHAIN_EXIT_PREFIX) {
            return;
        }
        let Some(config) = self.config.as_mut() else {
            return;
        };
        if !matches!(config.get("proxies"), Some(Value::Sequence(_))) {
            config.insert("proxies".into(), Value::Sequence(Vec::new()));
        }
        let Some(Value::Sequence(proxies)) = config.get_mut("proxies") else {
            return;
        };
        let name_value = Value::from(name.as_str());
        if let Some(existing) = proxies.iter_mut().find(|item| item.get("name") == Some(&name_value)) {
            *existing = Value::Mapping(proxy);
        } else {
            proxies.push(Value::Mapping(proxy));
        }
    }

    /// Removes a probe-only `CV-EXIT-*` proxy. Group lists are left untouched.
    pub fn remove_chain_exit_probe(&mut self, name: &str) {
        if !name.starts_with(CHAIN_EXIT_PREFIX) {
            return;
        }
        let Some(config) = self.config.as_mut() else {
            return;
        };
        let Some(Value::Sequence(proxies)) = config.get_mut("proxies") else {
            return;
        };
        let name_value = Value::from(name);
        proxies.retain(|proxy| proxy.get("name") != Some(&name_value));
    }
}

const CHAIN_EXIT_PREFIX: &str = "CV-EXIT-";

fn proxy_name_is_chain_exit(proxy: &Mapping) -> bool {
    proxy
        .get("name")
        .and_then(Value::as_str)
        .is_some_and(|name| name.starts_with(CHAIN_EXIT_PREFIX))
}
