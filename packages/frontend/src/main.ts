import { createApp } from 'vue';
import './styles/global.css';
import '@fontsource-variable/noto-sans-sc';
import App from './App.vue';

import router from './routers';

const app = createApp(App);
app.use(router);
app.mount('#app');
