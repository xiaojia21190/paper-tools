import { createApp } from 'vue'
import App from './Sidepanel.vue'
import { setupApp } from '~/logic/common-setup'
import '../styles'
import { ElementPlus } from '~/styles'

// 初始化 Solana 钱包
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { Connection } from '@solana/web3.js';

// 设置 Solana 网络连接
const connection = new Connection('https://api.mainnet-beta.solana.com');

const app = createApp(App)
setupApp(app)
app.use(ElementPlus)
app.mount('#app')
