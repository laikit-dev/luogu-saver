import { createApp } from 'vue';
import './styles/global.css';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/plus-jakarta-sans/wght-italic.css';
import '@fontsource-variable/noto-sans-sc';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/jetbrains-mono/wght-italic.css';
import App from './App.vue';
import { initCodeFont } from './composables/useCodeFont.ts';
import { initCodeTheme } from './composables/useCodeTheme.ts';
import { initMotionPreference } from './composables/useMotionPreference.ts';
import { initReadingFont } from './composables/useReadingFont.ts';

import router from './routers';

initCodeFont();
initCodeTheme();
initMotionPreference();
initReadingFont();

const app = createApp(App);
app.use(router);
app.mount('#app');
