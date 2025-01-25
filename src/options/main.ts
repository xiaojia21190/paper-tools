import { createApp } from 'vue'
import App from './Options.vue'
import { setupApp } from '~/logic/common-setup'
import '../styles'
import { ElementPlus } from '~/styles'

const app = createApp(App)
setupApp(app)
app.use(ElementPlus)
app.mount('#app')
