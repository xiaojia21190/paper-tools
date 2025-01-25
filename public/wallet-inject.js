// 注入钱包连接所需的函数
window.connectWallet = async (type) => {
  try {
    if (type === "okx") {
      if (!window.okxwallet) {
        throw new Error("OKX Wallet not installed");
      }
      const accounts = await window.okxwallet.request({
        method: "eth_requestAccounts",
      });
      return { success: true, address: accounts[0] };
    } else if (type === "phantom") {
      if (!window.phantom?.solana) {
        throw new Error("Phantom Wallet not installed");
      }
      const response = await window.phantom.solana.connect();
      return {
        success: true,
        address: response.publicKey.toString(),
      };
    }
    throw new Error("Unsupported wallet type");
  } catch (error) {
    return {
      success: false,
      error: error.message || "Failed to connect wallet",
    };
  }
};
