import { createApp } from 'vue'
import App from './App.vue'
import { i18n } from './i18n'
// vue-sonner v2 ships its toast styling as a separate stylesheet; without it the
// Toaster renders as bare text lines (the "ugly queue pop-up").
import 'vue-sonner/style.css'
import './style.css'

createApp(App).use(i18n).mount('#app')
