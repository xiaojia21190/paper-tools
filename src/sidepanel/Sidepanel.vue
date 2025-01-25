<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import type { Browser } from "webextension-polyfill-ts";
import { chatStorage, type ChatMessage, type ChatSession } from "~/logic/storage";
import { ElIcon, ElUpload } from "element-plus";
import { UploadFilled } from "@element-plus/icons-vue";
import WalletConnect from "~/components/WalletConnect.vue";
import type { WalletInfo } from "~/types/wallet";
declare const browser: Browser;

function openOptionsPage() {
  browser.runtime.openOptionsPage();
}

const templates = [{ emoji: "🎯", text: "帮我写一篇论文" }];

const message = ref("");
const messageCount = ref(467);

// 聊天相关状态
const currentView = ref<"chat" | "history" | "upload">("chat");
const currentSessionId = ref<number | null>(null);
const chatMessages = ref<ChatMessage[]>([]);
const chatSessions = ref<ChatSession[]>([]);

// 添加右边栏状态控制
const showRightPanel = ref(false);

// 切换视图和右边栏
const toggleView = (view: "chat" | "history" | "upload") => {
  currentView.value = view;
  showRightPanel.value = true;
};

// 加载会话数据
onMounted(async () => {
  chatSessions.value = await chatStorage.getSessions();

  browser.storage.local.get("uploadStatus").then((result) => {
    if (result.uploadStatus) {
      uploadStatus.value = result.uploadStatus;
    }
  });

  browser.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local" && changes.uploadStatus) {
      uploadStatus.value = changes.uploadStatus.newValue;
    }
  });
});

// 格式化时间的函数
const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

// 处理发送消息
const handleSendMessage = async () => {
  if (!message.value.trim()) return;

  const newMessage: ChatMessage = {
    id: Date.now(),
    role: "user",
    content: message.value,
    timestamp: Date.now(),
  };

  chatMessages.value.push(newMessage);
  message.value = "";

  // 保存到当前会话
  if (currentSessionId.value) {
    const session = chatSessions.value.find((s) => s.id === currentSessionId.value);
    if (session) {
      session.messages.push(newMessage);
      session.lastMessage = newMessage.content;
      session.timestamp = newMessage.timestamp;
      await chatStorage.saveSession(session);
    }
  } else {
    // 创建新会话
    const newSession: ChatSession = {
      id: Date.now(),
      title: newMessage.content.slice(0, 20) + "...",
      lastMessage: newMessage.content,
      timestamp: newMessage.timestamp,
      messages: [newMessage],
    };
    currentSessionId.value = newSession.id;
    chatSessions.value.push(newSession);
    await chatStorage.saveSession(newSession);
  }
};

// 处理新建聊天
const handleNewChat = () => {
  currentSessionId.value = null;
  chatMessages.value = [];
  message.value = "";
  currentView.value = "chat";
};

// 切换到历史记录
const handleShowHistory = () => {
  currentView.value = "history";
};

// 选择历史会话
const handleSelectSession = async (sessionId: number) => {
  const session = chatSessions.value.find((s) => s.id === sessionId);
  if (session) {
    currentSessionId.value = sessionId;
    chatMessages.value = session.messages;
    currentView.value = "chat";
  }
};

// 删除会话
const handleDeleteSession = async (sessionId: number, event: Event) => {
  event.stopPropagation();
  await chatStorage.deleteSession(sessionId);
  chatSessions.value = chatSessions.value.filter((s) => s.id !== sessionId);
  if (currentSessionId.value === sessionId) {
    handleNewChat();
  }
};

// 计算当前视图内容
const showTemplates = computed(() => {
  return currentView.value === "chat" && chatMessages.value.length === 0 && !currentSessionId.value;
});

// 上传相关状态
interface UploadStatus {
  status: "idle" | "processing" | "uploading" | "completed" | "error" | "exists";
  message: string;
  progress?: number;
  receiptIds?: string[];
}

const uploadStatus = ref<UploadStatus>({
  status: "idle",
  message: "准备上传...",
});

const doi = ref("");
const selectedFile = ref<File | null>(null);

// 添加文件读取工具函数
const readFileAsBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result?.toString().split(",")[1];
      if (base64) {
        resolve(base64);
      } else {
        reject(new Error("Failed to read file"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// 处理文件选择
const handleFileSelect = (uploadFile: any, uploadFiles: any[]) => {
  console.log(uploadFile, uploadFiles);
  selectedFile.value = uploadFile.file;
  return false;
};

// 修改文件上传处理函数
const handleUpload = async () => {
  if (!selectedFile.value || !doi.value) {
    uploadStatus.value = {
      status: "error",
      message: "请选择文件并输入DOI",
    };
    return;
  }

  try {
    // 使用新的 readFileAsBase64 函数
    const base64 = await readFileAsBase64(selectedFile.value);

    // 发送消息到background script
    browser.runtime.sendMessage({
      type: "UPLOAD_PDF",
      pdfBase64: base64,
      doi: doi.value,
    });
  } catch (error) {
    uploadStatus.value = {
      status: "error",
      message: `处理文件失败: ${error}`,
    };
  }
};

// 添加登录状态
const isLoggedIn = ref(false);
const currentWallet = ref<WalletInfo | null>(null);

const handleWalletConnected = (wallet: WalletInfo | null) => {
  currentWallet.value = wallet;
  isLoggedIn.value = true;
};

const handleWalletDisconnected = () => {
  currentWallet.value = null;
  isLoggedIn.value = false;
};
</script>

<template>
  <!-- 登录界面 -->
  <div v-if="!isLoggedIn" class="w-full h-screen flex items-center justify-center bg-white dark:bg-gray-800">
    <div class="w-80 p-6 space-y-6">
      <div class="text-center">
        <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-900 flex items-center justify-center text-white text-2xl">AI</div>
        <h1 class="text-xl font-medium mb-2">登录到 AI Chat</h1>
        <p class="text-sm text-gray-500">请连接您的 OKX 钱包以继续</p>
      </div>

      <WalletConnect @connected="handleWalletConnected" @disconnected="handleWalletDisconnected" />
    </div>
  </div>

  <!-- 主应用界面 -->
  <div v-else class="w-full h-screen flex bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200">
    <!-- 主聊天区域 -->
    <main class="flex-1 flex flex-col min-w-0">
      <!-- 头部 -->
      <div class="p-4 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center text-white text-sm">AI</div>
          <span class="text-sm">⭐ {{ messageCount }}</span>
        </div>

        <!-- 添加钱包信息 -->
        <div v-if="currentWallet" class="flex items-center gap-2 text-sm">
          <img :src="currentWallet.icon" alt="Wallet" class="w-4 h-4" />
          <span class="font-mono">{{ currentWallet.address.slice(0, 4) }}...{{ currentWallet.address.slice(-4) }}</span>
        </div>
      </div>

      <!-- 主要内容区域 -->
      <div class="flex-1 p-4 overflow-y-auto">
        <!-- 聊天视图 -->
        <template v-if="currentView === 'chat'">
          <div v-if="chatMessages.length === 0" class="text-lg text-blue-500 mb-4">
            试试这些模板
            <div class="grid gap-2">
              <button v-for="template in templates" :key="template.text" class="flex items-center gap-2 p-3 text-left rounded-lg hover:bg-gray-100 transition-colors">
                <span>{{ template.emoji }}</span>
                <span>{{ template.text }}</span>
              </button>
            </div>
          </div>
          <div v-else class="space-y-4">
            <div v-for="msg in chatMessages" :key="msg.id" :class="['flex', msg.role === 'user' ? 'justify-end' : 'justify-start']">
              <div :class="['max-w-[80%] rounded-lg p-3', msg.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100']">
                {{ msg.content }}
                <div class="text-xs mt-1 opacity-70">
                  {{ formatTime(msg.timestamp) }}
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- 历史记录视图 -->
        <template v-if="currentView === 'history'">
          <div class="space-y-2">
            <div v-if="chatSessions.length === 0" class="text-center text-gray-500 py-4">暂无聊天记录</div>
            <div v-for="session in chatSessions" :key="session.id" class="group relative p-3 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer" @click="handleSelectSession(session.id)">
              <div class="font-medium">{{ session.title }}</div>
              <div class="text-sm text-gray-500 flex justify-between">
                <span>{{ session.lastMessage }}</span>
                <span>{{ formatTime(session.timestamp) }}</span>
              </div>
              <button @click="(e) => handleDeleteSession(session.id, e)" class="absolute right-2 top-2 p-1 rounded-full opacity-0 group-hover:opacity-100 hover:bg-gray-200 transition-opacity">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 6h18"></path>
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>
        </template>

        <!-- 上传视图 -->
        <template v-if="currentView === 'upload'">
          <div class="space-y-3">
            <div class="flex items-center gap-2">上传论文</div>

            <div class="space-y-4">
              <!-- DOI输入框 -->
              <div class="space-y-2">
                <label class="block text-sm font-medium">DOI</label>
                <input v-model="doi" type="text" placeholder="请输入DOI" class="w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              <!-- 文件上传区域 -->
              <el-upload class="upload-demo" drag :auto-upload="false" :on-change="handleFileSelect">
                <el-icon class="el-icon--upload"><upload-filled /></el-icon>
                <div class="el-upload__text">
                  拖拽文件到此处或
                  <em>点击上传</em>
                </div>
                <template #tip>
                  <div class="el-upload__tip">支持上传 PDF 文件</div>
                </template>
              </el-upload>

              <!-- 上传状态和进度 -->
              <div v-if="uploadStatus.status !== 'idle'" class="space-y-2">
                <div
                  class="text-sm"
                  :class="{
                    'text-blue-500': uploadStatus.status === 'processing' || uploadStatus.status === 'uploading',
                    'text-green-500': uploadStatus.status === 'completed',
                    'text-red-500': uploadStatus.status === 'error',
                  }"
                >
                  {{ uploadStatus.message }}
                </div>
                <div v-if="uploadStatus.progress !== undefined" class="w-full bg-gray-200 rounded-full h-2">
                  <div class="bg-blue-500 h-2 rounded-full transition-all duration-300" :style="{ width: `${uploadStatus.progress}%` }"></div>
                </div>
              </div>

              <!-- 上传按钮 -->
              <button
                @click="handleUpload"
                :disabled="!selectedFile || !doi || uploadStatus.status === 'uploading'"
                :class="['w-full py-2 px-4 rounded-lg transition-colors', !selectedFile || !doi || uploadStatus.status === 'uploading' ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600 text-white']"
              >
                {{ uploadStatus.status === "uploading" ? "上传中..." : "开始上传" }}
              </button>
            </div>
          </div>
        </template>
      </div>

      <!-- 输入框区域 -->
      <div class="border-t p-4 bg-gray-50">
        <div class="flex gap-2">
          <input v-model="message" type="text" placeholder="问我任何问题..." class="flex-1 px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-500" @keyup.enter="handleSendMessage" />
          <button @click="handleSendMessage" class="p-2 text-xl bg-blue-500 text-white rounded-lg hover:bg-blue-600">🚀</button>
        </div>
      </div>
    </main>

    <!-- 右边栏 - 改为竖排按钮 -->
    <aside class="w-16 border-l flex flex-col items-center py-4 bg-gray-50 dark:bg-gray-900 dark:border-gray-700 text-center">
      <div class="space-y-4">
        <button @click="toggleView('chat')" :class="['p-3 rounded-lg transition-colors', currentView === 'chat' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-200']" title="聊天">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </button>

        <button @click="toggleView('history')" :class="['p-3 rounded-lg transition-colors', currentView === 'history' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-200']" title="历史记录">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20v-6M6 20V10M18 20V4"></path>
          </svg>
        </button>

        <button @click="toggleView('upload')" :class="['p-3 rounded-lg transition-colors', currentView === 'upload' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-200']" title="上传论文">
          <el-icon :size="20">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
              <path
                fill="currentColor"
                d="M544 864V672h128L512 480 352 672h128v192H320v-1.6c-5.376.32-10.496 1.6-16 1.6A240 240 0 0 1 64 624c0-123.136 93.12-223.488 212.608-237.248A239.808 239.808 0 0 1 512 192a239.872 239.872 0 0 1 235.456 194.752c119.488 13.76 212.48 114.112 212.48 237.248a240 240 0 0 1-240 240c-5.376 0-10.56-1.28-16-1.6v1.6z"
              ></path>
            </svg>
          </el-icon>
        </button>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
}
</style>
