import { useWebExtensionStorage } from '~/composables/useWebExtensionStorage'

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ChatSession {
  id: number;
  title: string;
  lastMessage: string;
  timestamp: number;
  messages: ChatMessage[];
}

export interface AppSettings {
  language: 'zh' | 'en';
  theme: 'light' | 'dark' | 'system';
  apiKey?: string;
}

class ChatStorage {
  private storage;

  constructor() {
    this.storage = useWebExtensionStorage<ChatSession[]>('chat-sessions', []);
  }

  async getSessions(): Promise<ChatSession[]> {
    return this.storage.value;
  }

  async saveSession(session: ChatSession): Promise<void> {
    const sessions = await this.getSessions();
    const index = sessions.findIndex(s => s.id === session.id);

    if (index >= 0) {
      sessions[index] = session;
    } else {
      sessions.push(session);
    }

    this.storage.value = sessions;
  }

  async deleteSession(sessionId: number): Promise<void> {
    const sessions = await this.getSessions();
    this.storage.value = sessions.filter(s => s.id !== sessionId);
  }

  async clearAllSessions(): Promise<void> {
    this.storage.value = [];
  }
}

class SettingsStorage {
  private storage;

  constructor() {
    this.storage = useWebExtensionStorage<AppSettings>('app-settings', {
      language: 'zh',
      theme: 'system',
    });
  }

  get settings() {
    return this.storage.value;
  }

  set settings(value: AppSettings) {
    this.storage.value = value;
  }
}

export const chatStorage = new ChatStorage();
export const settingsStorage = new SettingsStorage();

// 保留原有的 demo storage
export const storageDemo = useWebExtensionStorage('webext-demo', 'Storage Demo')

