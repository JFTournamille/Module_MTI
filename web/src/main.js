import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './assets/scenario.css'

createApp(App).use(createPinia()).mount('#app')
