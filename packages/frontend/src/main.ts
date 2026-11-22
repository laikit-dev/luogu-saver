import { createApp } from 'vue';
import './styles/global.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/inter/wght-italic.css';
import '@harmonyos-sans-sc/Regular.css';
import '@harmonyos-sans-sc/Medium.css';
import '@harmonyos-sans-sc/Semibold.css';
import '@harmonyos-sans-sc/Bold.css';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/jetbrains-mono/wght-italic.css';
import App from './App.vue';
import { initReadingFont } from './composables/useReadingFont.ts';

import router from './routers';

initReadingFont();

const app = createApp(App);
app.use(router);
app.mount('#app');
