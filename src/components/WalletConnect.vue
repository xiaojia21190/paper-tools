<script setup lang="ts">
import { ref, onMounted } from "vue";
import type { WalletInfo, WalletType } from "~/types/wallet";
import { SUPPORTED_WALLETS } from "~/utils/walletAdapters";
import type { Browser } from "webextension-polyfill-ts";
declare const chrome: Browser;

const currentWallet = ref<WalletInfo | null>(null);
const isConnecting = ref(false);
const error = ref("");

// 初始化时获取钱包状态
onMounted(async () => {
  const response = await chrome.runtime.sendMessage({ type: "GET_WALLET_STATE" });
  if (response.success && response.data.currentWallet) {
    currentWallet.value = response.data.currentWallet;
    emit("connected", currentWallet.value);
  }
});

const connectWallet = async (type: WalletType) => {
  try {
    isConnecting.value = true;
    error.value = "";

    const response = await chrome.runtime.sendMessage({
      type: "CONNECT_WALLET",
      walletType: type,
    });

    if (response.success) {
      currentWallet.value = response.data;
      emit("connected", currentWallet.value);
    } else {
      throw new Error(response.error);
    }
  } catch (err) {
    console.error("Wallet connection error:", err);
    error.value = type === "phantom" ? "请先安装 Phantom 钱包" : "连接钱包失败";
  } finally {
    isConnecting.value = false;
  }
};

const disconnectWallet = async () => {
  if (!currentWallet.value) return;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "DISCONNECT_WALLET",
      walletType: currentWallet.value.id as WalletType,
    });

    if (response.success) {
      currentWallet.value = null;
      emit("disconnected");
    } else {
      throw new Error(response.error);
    }
  } catch (err) {
    console.error("Wallet disconnection error:", err);
  }
};

const emit = defineEmits<{
  (e: "connected", wallet: WalletInfo | null): void;
  (e: "disconnected"): void;
}>();
</script>

<template>
  <div class="flex flex-col items-center gap-4">
    <!-- 错误提示 -->
    <div v-if="error" class="text-red-500 text-sm mb-2">
      {{ error }}
    </div>

    <!-- 未连接状态 - 钱包列表 -->
    <div v-if="!currentWallet" class="w-full space-y-2">
      <button v-for="wallet in SUPPORTED_WALLETS" :key="wallet.id" @click="connectWallet(wallet.id as WalletType)" :disabled="isConnecting" class="w-full flex items-center justify-between p-3 rounded-lg hover:bg-gray-100 transition-colors">
        <div class="flex items-center gap-2">
          <img :src="wallet.icon" :alt="wallet.name" class="w-6 h-6" />
          <span>{{ wallet.name }}</span>
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
        </svg>
      </button>

      <!-- 安装提示 -->
      <div class="text-center text-sm text-gray-500 mt-4">
        <p>未安装钱包?</p>
        <div class="flex justify-center gap-4 mt-2">
          <a href="https://www.okx.com/web3" target="_blank" class="text-blue-500 hover:text-blue-600">安装 OKX</a>
          <a href="https://phantom.app/" target="_blank" class="text-blue-500 hover:text-blue-600">安装 Phantom</a>
        </div>
      </div>
    </div>

    <!-- 已连接状态 -->
    <div v-else class="w-full">
      <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
        <div class="flex items-center gap-2">
          <img :src="currentWallet.icon" :alt="currentWallet.name" class="w-6 h-6" />
          <div class="flex flex-col">
            <span class="text-sm font-medium">{{ currentWallet.name }}</span>
            <span class="text-xs text-gray-500">{{ currentWallet.address.slice(0, 6) }}...{{ currentWallet.address.slice(-4) }}</span>
          </div>
        </div>
        <button @click="disconnectWallet" class="text-sm text-red-500 hover:text-red-600">断开连接</button>
      </div>
    </div>
  </div>
</template>
