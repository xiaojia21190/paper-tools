import { onMessage, sendMessage } from 'webext-bridge/background'
import type { Tabs } from 'webextension-polyfill'
import type { Browser } from 'webextension-polyfill-ts'
import type { WalletInfo, WalletType } from '~/types/wallet'

declare const browser: Browser
declare const chrome: Browser

// only on dev mode
if (import.meta.hot) {
  // @ts-expect-error for background HMR
  import('/@vite/client')
  // load latest content script
  import('./contentScriptHMR')
}

// remove or turn this off if you don't use side panel
const USE_SIDE_PANEL = true

// to toggle the sidepanel with the action button in chromium:
if (USE_SIDE_PANEL) {
  // @ts-expect-error missing types
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error(error))
}

browser.runtime.onInstalled.addListener((): void => {
  // eslint-disable-next-line no-console
  console.log('Extension installed')
})

let previousTabId = 0

// communication example: send previous tab title from background page
// see shim.d.ts for type declaration
browser.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!previousTabId) {
    previousTabId = tabId
    return
  }

  let tab: Tabs.Tab

  try {
    tab = await browser.tabs.get(previousTabId)
    previousTabId = tabId
  }
  catch {
    return
  }

  // eslint-disable-next-line no-console
  console.log('previous tab', tab)
  sendMessage('tab-prev', { title: tab.title }, { context: 'content-script', tabId })
})

onMessage('get-current-tab', async () => {
  try {
    const tab = await browser.tabs.get(previousTabId)
    return {
      title: tab?.title,
    }
  }
  catch {
    return {
      title: undefined,
    }
  }
})



// 后台脚本，可以根据需要添加功能

// 设置最大切片大小为50KB
const MAX_SLICE_SIZE = 50 * 1024;

interface WalletState {
  isConnected: boolean
  currentWallet: WalletInfo | null
}

interface WalletResponse {
  success: boolean
  data?: WalletInfo
  error?: string
}

// 钱包连接状态
let walletState: WalletState = {
  isConnected: false,
  currentWallet: null,
}

// 监听消息
//@ts-ignore
browser.runtime.onMessage.addListener((
  request: any,
  sender: any,
  sendResponse: (response: WalletResponse) => void,
) => {
  if (request.type === "CONNECT_WALLET" && request.walletType) {
    handleWalletConnect(request.walletType)
      .then((response) => {
        sendResponse({ success: true, data: response })
      })
      .catch((error: Error) => {
        sendResponse({ success: false, error: error.message })
      })
    return true
  }

  if (request.type === "DISCONNECT_WALLET" && request.walletType) {
    handleWalletDisconnect(request.walletType)
      .then(() => {
        sendResponse({ success: true })
      })
      .catch((error: Error) => {
        sendResponse({ success: false, error: error.message })
      })
    return true
  }

  if (request.type === "GET_WALLET_STATE") {
    // sendResponse({ success: true,  error:  })
    return true
  }

  // 处理PDF上传
  if (request.type === "UPLOAD_PDF" && request.pdfBase64 && request.doi) {
    handlePdfUpload(request.pdfBase64, request.doi)
      .then((response) => {
        sendResponse({ success: true, data: response })
      })
      .catch((error: Error) => {
        sendResponse({ success: false, error: error.message })
      })
    return true
  }
})

async function handlePdfUpload(pdfBase64: string, doi: string) {
  try {
    // 更新上传状态
    await chrome.storage.local.set({
      uploadStatus: {
        status: "processing",
        message: "开始处理文件...",
        progress: 0,
      },
    });

    const chunks = [];
    for (let i = 0; i < pdfBase64.length; i += MAX_SLICE_SIZE) {
      const chunk = pdfBase64.slice(i, i + MAX_SLICE_SIZE);
      chunks.push(chunk);
    }

    console.log(`Total chunks created: ${chunks.length}`);

    // 检查是否已存在相同DOI的PDF
    const existingIds = await checkExistingPdf(doi);
    if (existingIds.length > 0) {
      await chrome.storage.local.set({
        uploadStatus: {
          status: "exists",
          message: "文件已存在",
          receiptIds: existingIds,
        },
      });
      return existingIds;
    }

    // 上传每个切片
    const receiptIds = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const progress = Math.round((i / chunks.length) * 100);

      // 更新进度
      await chrome.storage.local.set({
        uploadStatus: {
          status: "uploading",
          message: `正在上传第 ${i + 1}/${chunks.length} 块...`,
          progress: progress,
        },
      });

      const response = await uploadToIrys(chunk, doi);
      if (!response.ok) {
        throw new Error("Upload failed");
      }
      const result = await response.json();
      receiptIds.push(result.id);
    }

    // 更新完成状态
    await chrome.storage.local.set({
      uploadStatus: {
        status: "completed",
        message: "上传完成！",
        progress: 100,
        receiptIds: receiptIds,
      },
    });

    return receiptIds;
  } catch (error) {
    // 更新错误状态
    await chrome.storage.local.set({
      uploadStatus: {
        status: "error",
        message: `上传失败: ${error}`,
        progress: 0,
      },
    });
    console.error("Error uploading PDF:", error);
    throw error;
  }
}

async function checkExistingPdf(doi: string) {
  const query = `
    query {
      transactions(
        tags: [
          { name: "Content-Type", values: ["application/pdf"] },
          { name: "App-Name", values: ["SciQuery"] },
          { name: "Type", values: ["pdf-index"] },
          { name: "Collection", values: ["${doi}"] }
        ]
      ) {
        edges {
          node {
            id
          }
        }
      }
    }
  `;

  const response = await fetch("https://uploader.irys.xyz/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  const result = await response.json();
  const pdfIds = result.data?.transactions?.edges?.map((edge: { node: { id: string } }) => edge.node.id) || [];
  return pdfIds;
}

async function uploadToIrys(chunk: string, doi: string) {
  const tags = [
    { name: "Content-Type", value: "application/pdf" },
    { name: "App-Name", value: "SciQuery" },
    { name: "Type", value: "pdf-index" },
    { name: "Collection", value: doi },
  ];

  // 这里需要替换为实际的Irys上传endpoint
  return fetch("https://your-irys-endpoint.com/upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: chunk,
      tags: tags,
    }),
  });
}

// 处理钱包连接
async function handleWalletConnect(walletType: WalletType): Promise<WalletInfo> {
  try {
    const tabs = await browser.tabs.query({});
    const currentTab = tabs[0];
    if (!currentTab?.id) throw new Error("No active tab");

    // 检查钱包是否安装
    const checkResult = await browser.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: (type: WalletType) => {
        console.log(type);
        console.log(window.okxwallet);
        if (type === 'phantom') {
          return !!window.phantom?.solana;
        } else if (type === 'okx') {
          return !!window.okxwallet;
        }
        return false;
      },
      args: [walletType]
    });

    console.log(checkResult);

    const isInstalled = checkResult.result;
    if (!isInstalled) {
      throw new Error(`${walletType} wallet not installed`);
    }

    // 连接钱包
    const connectResult = await browser.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: async (type: WalletType) => {
        try {
          if (type === 'phantom') {
            const response = await window.phantom?.solana?.connect();
            return {
              success: true,
              address: response?.publicKey.toString(),
              chain: 'solana'
            };
          } else if (type === 'okx') {
            const accounts = await window.okxwallet?.request({
              method: 'eth_requestAccounts'
            });
            return {
              success: true,
              address: accounts[0],
              chain: 'ethereum'
            };
          }
          return { success: false, error: 'Unsupported wallet type' };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      },
      args: [walletType]
    });

    const result = connectResult.result;
    if (!result?.success) {
      throw new Error(result?.error || "Failed to connect wallet");
    }

    // 更新钱包状态
    const walletConfig = getWalletConfig(walletType);
    const wallet: WalletInfo = {
      id: walletType,
      name: walletConfig.name,
      address: result.address,
      icon: walletConfig.icon,
    };

    walletState = {
      isConnected: true,
      currentWallet: wallet,
    };

    // 保存钱包状态到存储
    await browser.storage.local.set({ walletState });

    return wallet;
  } catch (error) {
    console.error("Wallet connection error:", error);
    throw error;
  }
}

// 处理钱包断开连接
async function handleWalletDisconnect(walletType: WalletType): Promise<void> {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    if (!currentTab?.id) throw new Error("No active tab");

    if (walletType === 'phantom') {
      await browser.scripting.executeScript({
        target: { tabId: currentTab.id },
        func: async () => {
          await window.phantom?.solana?.disconnect();
        },
      });
    }
    // OKX 钱包不需要显式断开连接

    // 重置钱包状态
    walletState = {
      isConnected: false,
      currentWallet: null,
    };

    // 清除存储的钱包状态
    await browser.storage.local.remove('walletState');
  } catch (error) {
    console.error("Wallet disconnection error:", error);
    throw error;
  }
}

// 获取钱包配置
function getWalletConfig(walletType: WalletType) {
  const configs = {
    phantom: {
      name: 'Phantom',
      icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTA4IiBoZWlnaHQ9IjEwOCIgdmlld0JveD0iMCAwIDEwOCAxMDgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxMDgiIGhlaWdodD0iMTA4IiByeD0iMjYiIGZpbGw9IiNBQjlGRjIiLz4KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik00Ni41MjY3IDY5LjkyMjlDNDIuMDA1NCA3Ni44NTA5IDM0LjQyOTIgODUuNjE4MiAyNC4zNDggODUuNjE4MkMxOS41ODI0IDg1LjYxODIgMTUgODMuNjU2MyAxNSA3NS4xMzQyQzE1IDUzLjQzMDUgNDQuNjMyNiAxOS44MzI3IDcyLjEyNjggMTkuODMyN0M4Ny43NjggMTkuODMyNyA5NCAzMC42ODQ2IDk0IDQzLjAwNzlDOTQgNTguODI1OCA4My43MzU1IDc2LjkxMjIgNzMuNTMyMSA3Ni45MTIyQzcwLjI5MzkgNzYuOTEyMiA2OC43MDUzIDc1LjEzNDIgNjguNzA1MyA3Mi4zMTRDNjguNzA1MyA3MS41NzgzIDY4LjgyNzUgNzAuNzgxMiA2OS4wNzE5IDY5LjkyMjlDNjUuNTg5MyA3NS44Njk5IDU4Ljg2ODUgODEuMzg3OCA1Mi41NzU0IDgxLjM4NzhDNDcuOTkzIDgxLjM4NzggNDUuNjcxMyA3OC41MDYzIDQ1LjY3MTMgNzQuNDU5OEM0NS42NzEzIDcyLjk4ODQgNDUuOTc2OCA3MS40NTU2IDQ2LjUyNjcgNjkuOTIyOVpNODMuNjc2MSA0Mi41Nzk0QzgzLjY3NjEgNDYuMTcwNCA4MS41NTc1IDQ3Ljk2NTggNzkuMTg3NSA0Ny45NjU4Qzc2Ljc4MTYgNDcuOTY1OCA3NC42OTg5IDQ2LjE3MDQgNzQuNjk4OSA0Mi41Nzk0Qzc0LjY5ODkgMzguOTg4NSA3Ni43ODE2IDM3LjE5MzEgNzkuMTg3NSAzNy4xOTMxQzgxLjU1NzUgMzcuMTkzMSA4My42NzYxIDM4Ljk4ODUgODMuNjc2MSA0Mi41Nzk0Wk03MC4yMTAzIDQyLjU3OTVDNzAuMjEwMyA0Ni4xNzA0IDY4LjA5MTYgNDcuOTY1OCA2NS43MjE2IDQ3Ljk2NThDNjMuMzE1NyA0Ny45NjU4IDYxLjIzMyA0Ni4xNzA0IDYxLjIzMyA0Mi41Nzk1QzYxLjIzMyAzOC45ODg1IDYzLjMxNTcgMzcuMTkzMSA2NS43MjE2IDM3LjE5MzFDNjguMDkxNiAzNy4xOTMxIDcwLjIxMDMgMzguOTg4NSA3MC4yMTAzIDQyLjU3OTVaIiBmaWxsPSIjRkZGREY4Ii8+Cjwvc3ZnPgo='
    },
    okx: {
      name: 'OKX Wallet',
      icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAJDSURBVHgB7Zq9jtpAEMfHlhEgQLiioXEkoAGECwoKxMcTRHmC5E3IoyRPkPAEkI7unJYmTgEFTYwA8a3NTKScLnCHN6c9r1e3P2llWQy7M/s1Gv1twCP0ej37dDq9x+Zut1t3t9vZjDEHIiSRSPg4ZpDL5fxkMvn1cDh8m0wmfugfO53OoFQq/crn8wxfY9EymQyrVCqMfHvScZx1p9ls3pFxXBy/bKlUipGPrVbLuQqAfsCliq3zl0H84zwtjQrOw4Mt1W63P5LvBm2d+Xz+YzqdgkqUy+WgWCy+Mc/nc282m4FqLBYL+3g8fjDxenq72WxANZbLJeA13zDX67UDioL5ybXwafMYu64Ltn3bdDweQ5R97fd7GyhBQMipx4POeEDHIu2LfDdBIGGz+hJ9CQ1ABjoA2egAZPM6AgiCAEQhsi/C4jHyPA/6/f5NG3Ks2+3CYDC4aTccDrn6ojG54MnEvG00GoVmWLIRNZ7wTCwDHYBsdACy0QHIhiuRETxlICWpMMhGZHmqS8qH6JLyGegAZKMDkI0uKf8X4SWlaZo+Pp1bRrwlJU8ZKLIvUjKh0WiQ3sRUbNVq9c5Ebew7KEo2m/1p4jJ4qAmDaqDQBzj5XyiAT4VCQezJigAU+IDU+z8vJFnGWeC+bKQV/5VZ71FV6L7PA3gg3tXrdQ+DgLhC+75Wq3no69P3MC0NFQpx2lL04Ql9gHK1bRDjsSBIvScBnDTk1WrlGIZBorIDEYJj+rhdgnQ67VmWRe0zlplXl81vcyEt0rSoYDUAAAAASUVORK5CYII='
    }
  } as const;

  return configs[walletType];
}
