// =====================================================================
// ledger.js – Bestände über ÖFFENTLICHE Adressen abfragen (nur lesen).
// Keine Seed Phrase, keine Private Keys, kein Zugriff auf den Ledger.
// Jede Kette hat einen eigenen Adapter mit öffentlichem Endpunkt.
// =====================================================================

const j = async (url, body) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  const r = await fetch(url, { signal: ctl.signal, referrerPolicy: 'no-referrer', ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }).finally(() => clearTimeout(t));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
};
const rpc = (url, method, params) => j(url, { jsonrpc: '2.0', id: 1, method, params });
const hexToNum = (h, dec) => Number(BigInt(h || '0x0')) / 10 ** dec;
const erc20 = async (url, token, addr, dec) => {
  const data = '0x70a08231' + addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const r = await rpc(url, 'eth_call', [{ to: token, data }, 'latest']);
  return hexToNum(r.result, dec);
};
const ETH_RPC = 'https://ethereum-rpc.publicnode.com';
const SUI_GQL = 'https://graphql.mainnet.sui.io/graphql';
const SEI_EVM = ['https://evm-rpc.sei-apis.com', 'https://sei-evm-rpc.publicnode.com'];

export const CHAINS = {
  btc: {
    label: 'Bitcoin', hint: 'Adresse(n) bc1… / 3… / 1…, mehrere mit Komma. xpub wird nicht unterstützt.',
    async fetch(addr) {
      let sat = 0;
      for (const a of addr.split(/[,\s]+/).filter(Boolean)) {
        const d = await j(`https://mempool.space/api/address/${encodeURIComponent(a)}`);
        sat += d.chain_stats.funded_txo_sum - d.chain_stats.spent_txo_sum + d.mempool_stats.funded_txo_sum - d.mempool_stats.spent_txo_sum;
      }
      return { BTC: sat / 1e8 };
    },
  },
  eth: {
    label: 'Ethereum (ETH, LINK, ONDO)', hint: 'Adresse 0x… (Ledger Ethereum-Konto)',
    async fetch(a) {
      const eth = hexToNum((await rpc(ETH_RPC, 'eth_getBalance', [a, 'latest'])).result, 18);
      const link = await erc20(ETH_RPC, '0x514910771AF9Ca656af840dff83E8264EcF986CA', a, 18);
      const ondo = await erc20(ETH_RPC, '0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3', a, 18);
      return { ETH: eth, LINK: link, ONDO: ondo };
    },
  },
  hype: {
    label: 'Hyperliquid (HYPE)', hint: 'Adresse 0x… – meist dieselbe wie dein Ethereum-Konto im Ledger. Geprüft werden HyperCore (Spot + Staking) und HyperEVM.',
    async fetch(a) {
      const user = a.toLowerCase();
      const info = (body) => j('https://api.hyperliquid.xyz/info', body);
      const spot = await info({ type: 'spotClearinghouseState', user });
      const core = Number(((spot.balances || []).find((b) => b.coin === 'HYPE') || {}).total || 0);
      let staked = 0;
      try { const d = await info({ type: 'delegatorSummary', user }); staked = Number(d.delegated || 0) + Number(d.undelegated || 0) + Number(d.totalPendingWithdrawal || 0); } catch (e) { /* kein Staking */ }
      let evm = 0;
      try { evm = hexToNum((await rpc('https://rpc.hyperliquid.xyz/evm', 'eth_getBalance', [a, 'latest'])).result, 18); } catch (e) { /* HyperEVM nicht erreichbar */ }
      return { HYPE: core + staked + evm };
    },
  },
  avax: {
    label: 'Avalanche C-Chain (AVAX)', hint: 'Adresse 0x… (C-Chain)',
    async fetch(a) { return { AVAX: hexToNum((await rpc('https://api.avax.network/ext/bc/C/rpc', 'eth_getBalance', [a, 'latest'])).result, 18) }; },
  },
  sol: {
    label: 'Solana (SOL)', hint: 'Solana-Adresse',
    async fetch(a) { const r = await rpc('https://api.mainnet-beta.solana.com', 'getBalance', [a]); return { SOL: r.result.value / 1e9 }; },
  },
  xrp: {
    label: 'XRP Ledger (XRP)', hint: 'Adresse r…',
    async fetch(a) {
      const r = await j('https://xrplcluster.com', { method: 'account_info', params: [{ account: a, ledger_index: 'validated' }] });
      return { XRP: r.result && r.result.account_data ? Number(r.result.account_data.Balance) / 1e6 : 0 };
    },
  },
  sui: {
    label: 'Sui (SUI)', hint: 'Adresse 0x… (Sui)',
    // Öffentliche Fullnodes haben JSON-RPC abgeschaltet -> GraphQL, sonst Ausweich-RPC
    async fetch(a) {
      try {
        const r = await j(SUI_GQL, { query: 'query($a: SuiAddress!) { address(address: $a) { balance(coinType: "0x2::sui::SUI") { totalBalance } } }', variables: { a } });
        if (r.errors) throw new Error(r.errors[0].message);
        return { SUI: Number((r.data.address && r.data.address.balance && r.data.address.balance.totalBalance) || 0) / 1e9 };
      } catch (e) {
        const r = await rpc('https://sui-rpc.publicnode.com', 'suix_getBalance', [a]);
        if (!r.result) throw e;
        return { SUI: Number(r.result.totalBalance) / 1e9 };
      }
    },
  },
  near: {
    label: 'NEAR', hint: 'Konto-ID oder 64-stellige Adresse',
    async fetch(a) {
      const r = await j('https://rpc.mainnet.near.org', { jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: a } });
      return { NEAR: r.result ? Number(BigInt(r.result.amount)) / 1e24 : 0 };
    },
  },
  kas: {
    label: 'Kaspa (KAS)', hint: 'Adresse kaspa:…',
    async fetch(a) { const r = await j(`https://api.kaspa.org/addresses/${encodeURIComponent(a)}/balance`); return { KAS: Number(r.balance) / 1e8 }; },
  },
  sei: {
    label: 'Sei (SEI)', hint: 'Adresse sei1… oder 0x…',
    async fetch(a) {
      if (/^0x[0-9a-fA-F]{40}$/.test(a)) { // EVM-Adresse -> Sei-EVM
        for (const u of SEI_EVM) { const r = await rpc(u, 'eth_getBalance', [a, 'latest']).catch(() => null); if (r && r.result) return { SEI: hexToNum(r.result, 18) }; }
        throw new Error('Sei-EVM nicht erreichbar');
      }
      const r = await j(`https://rest.sei-apis.com/cosmos/bank/v1beta1/balances/${encodeURIComponent(a)}`);
      const b = (r.balances || []).find((x) => x.denom === 'usei');
      return { SEI: b ? Number(b.amount) / 1e6 : 0 };
    },
  },
};

// Alle Adressen abfragen -> { SYM: qty }, Fehler je Adresse
export async function syncAll(addresses, onStep = () => {}) {
  const total = {}; const errors = []; let i = 0;
  for (const a of addresses) {
    onStep(++i, addresses.length, a);
    try {
      const r = await CHAINS[a.chain].fetch(a.address.trim());
      for (const [k, v] of Object.entries(r)) if (v > 0 || k === Object.keys(r)[0]) total[k] = (total[k] || 0) + v;
    } catch (e) { errors.push({ ...a, error: e.message }); }
  }
  return { total, errors, at: new Date().toISOString() };
}
