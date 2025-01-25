// 定义钱包类型
export interface WalletInfo {
  id: string;
  name: string;
  address: string;
  icon?: string;
}

// Solana 钱包提供者接口
export interface SolanaProvider {
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  disconnect: () => Promise<void>;
  isConnected: boolean;
  publicKey?: { toString: () => string };
  signMessage?: (message: Uint8Array) => Promise<{ signature: Uint8Array }>;
}

// OKX 钱包提供者接口
export interface OKXProvider {
  isOKExWallet?: boolean;
  request: (args: { method: string; params?: any[] }) => Promise<any>;
  on: (eventName: string, handler: (accounts: string[]) => void) => void;
  removeListener: (eventName: string, handler: (accounts: string[]) => void) => void;
}

// 支持的钱包类型
export type WalletType = 'phantom' | 'okx';

declare global {
  interface Window {
    phantom?: {
      solana?: SolanaProvider;
    };
    okxwallet?: OKXProvider;
  }
}
